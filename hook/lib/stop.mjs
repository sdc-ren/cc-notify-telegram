// EVENT stop — đọc tin cuối trong transcript, tách marker DONE/ESCALATE.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { MARKER_DONE, MARKER_ESCALATE } from './config.mjs';
import { buildTag, projectName, strings } from './strings.mjs';
import { sweepSessionPending } from './ask.mjs';
import { isUserAway, sendAwayAware, userIdleSeconds } from './presence.mjs';
import { ensureStateDirs, gcStateDir, pendingKey, pendingPath } from './state.mjs';
import { isLocalKeyword, waitForReply } from './poller.mjs';
import { closeOnSignal } from './perm.mjs';

export function parseJsonl(lines) {
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // dòng hỏng (file đang được ghi dở) → bỏ qua như jq -s vẫn chạy tiếp
    }
  }
  return out;
}

// Tin nhắn text CUỐI của assistant trong 80 dòng cuối transcript (bỏ sidechain/subagent).
export function lastAssistantText(lines) {
  const texts = [];
  for (const entry of parseJsonl(lines.slice(-80))) {
    if (entry?.type !== 'assistant' || entry.isSidechain === true) continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    }
  }
  return texts.at(-1) ?? '';
}

// "Tên session" = yêu cầu ĐẦU TIÊN của user trong 200 dòng đầu, làm sạch tag, cắt 60 codepoint.
export function firstUserSnippet(lines) {
  const candidates = [];
  for (const entry of parseJsonl(lines.slice(0, 200))) {
    if (entry?.type !== 'user' || entry.isSidechain === true || entry.isMeta === true) continue;
    const content = entry.message?.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      text = content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join(' ');
    }
    if (text) candidates.push(text);
  }
  const raw = candidates[0] ?? '';
  const cleaned = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = Array.from(cleaned);
  return cps.length > 60 ? cps.slice(0, 60).join('') + '…' : cleaned;
}

// Tóm tắt nhúng trong marker: <!-- CC_NOTIFY_DONE: ý 1 | ý 2 --> (dòng đầu tiên khớp).
export function extractDoneSummary(text) {
  for (const line of text.split('\n')) {
    const m = line.match(new RegExp(`.*${MARKER_DONE}:\\s*(.*\\S)\\s*-->.*`));
    if (m) return m[1];
  }
  return '';
}

export function summaryToBullets(summary) {
  return summary
    .split('|')
    .map((part) => `• ${part.trim()}`)
    .join('\n');
}

// Fallback khi marker không kèm tóm tắt: forward tin cuối, gỡ marker/comment, trim dòng trống.
export function fallbackBody(text) {
  let lines = text
    .split('\n')
    .filter((l) => !l.includes(MARKER_DONE) && !l.includes(MARKER_ESCALATE))
    .map((l) => l.replace(/<!--[^>]*-->/g, ''));
  let start = -1;
  let end = -1;
  lines.forEach((l, i) => {
    if (/\S/.test(l)) {
      if (start === -1) start = i;
      end = i;
    }
  });
  if (start === -1) return '';
  let body = lines.slice(start, end + 1).join('\n');
  const cps = Array.from(body);
  if (cps.length > 3800) body = cps.slice(0, 3800).join('') + '…';
  return body;
}

export function extractEscalateLine(text, str) {
  const line = text.split('\n').find((l) => l.includes('🛑'));
  const cleaned = line ? line.replace(/<!--.*-->/g, '').trim() : '';
  return cleaned || str.escalateFallback;
}

// Quyết định nội dung gửi cho event stop; trả null nếu không có marker (không gửi gì).
export function buildStopMessage({ last, project, snippet, str }) {
  if (last.includes(MARKER_ESCALATE)) {
    return `${extractEscalateLine(last, str)}\n${str.escalateSuffix(project)}`;
  }
  if (!last.includes(MARKER_DONE)) return null;

  const summary = extractDoneSummary(last);
  if (summary) return `✅ ${project}\n${summaryToBullets(summary)}`;

  const body = fallbackBody(last);
  if (body) return `✅ ${project}\n${body}`;
  if (snippet) return `✅ ${project} · "${snippet}"\n${str.doneFallback}`;
  return `✅ ${project} — ${str.donePlain}`;
}

// Hộp "bước tiếp theo" của app desktop (tool mcp__ccd_turn__wrap_up) trong lượt hiện tại:
// { recap, ask, choices[] }. Không có (CLI, hoặc lượt chưa gọi) → null.
const MAX_CHOICES = 6;

function isRealUserPrompt(entry) {
  if (entry?.type !== 'user' || entry.isSidechain === true || entry.isMeta === true) return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return content.trim() !== '';
  return Array.isArray(content) && content.some((b) => b?.type === 'text');
}

export function lastWrapUp(lines) {
  let found = null;
  for (const entry of parseJsonl(lines.slice(-300))) {
    if (isRealUserPrompt(entry)) {
      found = null; // wrap_up của lượt trước không còn giá trị
      continue;
    }
    if (entry?.type !== 'assistant' || entry.isSidechain === true) continue;
    for (const block of entry.message?.content || []) {
      if (block?.type !== 'tool_use' || !/(^|__)wrap_up$/.test(String(block.name || ''))) continue;
      const input = block.input || {};
      const choices = (Array.isArray(input.actions) ? input.actions : [])
        .map((a) => String(a?.label || a?.action || '').trim())
        .filter(Boolean)
        .slice(0, MAX_CHOICES);
      found = { recap: String(input.recap || '').trim(), ask: String(input.ask || '').trim(), choices };
    }
  }
  return found;
}

// callback_data: chữ số = lựa chọn thứ n, `l` = để máy xử lý.
export function stopKeyboard(key, choices, str) {
  return {
    inline_keyboard: [
      ...choices.map((label, i) => [{ text: label, callback_data: `${i}:${key}` }]),
      [{ text: str.btnLocal, callback_data: `l:${key}` }],
    ],
  };
}

export function buildStopAskMessage({ escalateLine, tag, wrapUp, str, waitMin }) {
  const out = [escalateLine, tag];
  if (wrapUp?.recap) out.push('', wrapUp.recap);
  if (wrapUp?.ask) out.push('', `❓ ${wrapUp.ask}`);
  out.push('', str.stopFooter(waitMin));
  return out.join('\n');
}

export function stopBlockOutput(reason) {
  return JSON.stringify({ decision: 'block', reason });
}

const capText = (text, max) => (Array.from(text).length > max ? Array.from(text).slice(0, max).join('') + '…' : text);

// Đang vắng máy + Remote bật → gửi tin 🛑 kèm nút, giữ lượt lại chờ trả lời rồi đưa câu trả lời
// cho Claude làm tiếp (Stop hook `decision: block`). Trả null nếu không chờ được / không ai trả lời.
export async function promptStopReply({ payload, cfg, tg, env, home = homedir(), last, lines, deps = {} }) {
  const str = strings(cfg);
  const project = projectName(payload, env);
  const suffix = String(payload.session_id || '').slice(-4);
  const wrapUp = lastWrapUp(lines);
  const text = buildStopAskMessage({
    escalateLine: extractEscalateLine(last, str),
    tag: buildTag({ project, suffix }),
    wrapUp,
    str,
    waitMin: Math.round(cfg.remoteAskTimeoutSec / 60),
  });

  const dir = ensureStateDirs(home);
  gcStateDir(dir);
  const key = pendingKey(payload.session_id, [{ question: `Stop:${last}` }]);
  const choices = wrapUp?.choices || [];
  let sent;
  try {
    sent = await tg.sendMessage(capText(text, 3900), { reply_markup: stopKeyboard(key, choices, str) });
  } catch {
    return { type: 'send-failed' };
  }
  if (!sent?.message_id) return { type: 'send-failed' };
  const anchorId = sent.message_id;
  const shown = capText(text, 3500);
  const settle = (status) => tg.editMessageText(anchorId, `${shown}\n\n${status}`).catch(() => {});

  writeFileSync(
    pendingPath(dir, key),
    JSON.stringify({ kind: 'stop', messageId: anchorId, messageIds: [anchorId], sessionId: payload.session_id || '', sentAt: Date.now() })
  );
  const dropPending = () => {
    try {
      unlinkSync(pendingPath(dir, key));
    } catch {
      // đã bị sweep
    }
  };
  // Người dùng Esc / gõ tại máy → Claude Code tắt hook → đóng tin, gỡ nút.
  const stopWatching = closeOnSignal(() => {
    dropPending();
    return settle(str.stopClosedLocal);
  });

  const idleSeconds = deps.idleSeconds || userIdleSeconds;
  let outcome;
  try {
    outcome = await waitForReply({
      tg,
      cfg,
      dir,
      ownMessageIds: [anchorId],
      deadline: Date.now() + cfg.remoteAskTimeoutSec * 1000,
      env,
      home,
      // Người dùng về lại máy (vừa đụng phím/chuột) → nhả lượt để trả lời tại máy.
      abortIf: () => {
        const idle = idleSeconds();
        return idle != null && idle < 30;
      },
    });
  } finally {
    stopWatching();
    dropPending();
  }

  const who = outcome.fromName ? ` (${outcome.fromName})` : '';
  let answer = null;
  if (outcome.type === 'callback' && /^\d$/.test(outcome.action)) answer = choices[Number(outcome.action)] ?? null;
  if (outcome.type === 'reply' && outcome.text && !isLocalKeyword(outcome.text)) answer = outcome.text;
  if (answer) {
    await settle(str.stopAnswered(who, capText(answer, 300)));
    return { type: 'answer', output: stopBlockOutput(str.stopAnswerReason(answer)) };
  }
  await settle(outcome.type === 'timeout' ? str.stopTimedOut : str.stopMovedLocal);
  return { type: outcome.type };
}

// Có nên giữ lượt chờ trả lời từ Telegram không: chỉ tin 🛑, Remote bật, có allowlist, và
// đo được là người dùng đang vắng máy.
export function shouldWaitForReply(last, cfg, deps) {
  if (!last.includes(MARKER_ESCALATE)) return false;
  if (!cfg.remote || !cfg.allowedUserIds?.length) return false;
  return isUserAway(cfg, deps);
}

export async function runStop(payload, cfg, tg, env, { home = homedir(), deps } = {}) {
  const transcript = payload.transcript_path;
  const hasTranscript = transcript && existsSync(transcript);
  const lines = hasTranscript ? readFileSync(transcript, 'utf8').split('\n').filter(Boolean) : [];
  const str = strings(cfg);
  const last = payload.last_assistant_message || lastAssistantText(lines);
  const message = buildStopMessage({ last, project: projectName(payload, env), snippet: firstUserSnippet(lines), str });
  // Quét pending mồ côi của session này (user Esc câu hỏi → PostToolUse không bắn).
  await sweepSessionPending(payload.session_id, cfg, tg, home).catch(() => {});
  if (!message) return null;
  if (shouldWaitForReply(last, cfg, deps)) {
    const res = await promptStopReply({ payload, cfg, tg, env, home, last, lines, deps }).catch(() => ({ type: 'error' }));
    if (res.type === 'answer') return res.output;
    if (res.type !== 'send-failed' && res.type !== 'error') return null; // tin đã gửi (kèm trạng thái)
  }
  await sendAwayAware(tg, cfg, message, deps);
  return null;
}
