// EVENT ask / ask-done — Remote Ask 2 chiều.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { normalizeProviderId, providerDisplayName, stateDir } from './config.mjs';
import { buildTag, projectName, strings } from './strings.mjs';
import { ensureStateDirs, gcStateDir, listPending, pendingKey, pendingPath } from './state.mjs';
import { isLocalKeyword, waitForReply } from './poller.mjs';

// Full câu hỏi + FULL nhãn/mô tả mọi lựa chọn — KHÔNG cắt (chunkMessage lo phần dài).
export function buildAskMessage(questions, { project, suffix, str, providerId }) {
  const tag = buildTag({ providerId, project, suffix });
  const out = [str.askHeader(tag, providerId ? providerDisplayName(providerId) : undefined), ''];
  questions.forEach((q, qi) => {
    const multi = q.multiSelect ? ` ${str.askMulti}` : '';
    out.push(`${qi + 1}. ${q.question}${multi}`);
    (q.options || []).forEach((opt, oi) => {
      const letter = String.fromCharCode(65 + oi);
      const desc = opt.description ? ` — ${opt.description}` : '';
      out.push(`   ${letter}. ${opt.label}${desc}`);
    });
    out.push(''); // dòng trống ngăn cách giữa các câu cho dễ đọc
  });
  out.push(str.askFooter);
  return out.join('\n');
}

// Telegram giới hạn 4096 ký tự/tin. Câu hỏi dài → tách theo ranh giới dòng thành nhiều tin
// (mỗi tin ≤ limit); dòng đơn siêu dài thì hard-split theo codepoint. KHÔNG bao giờ cắt mất chữ.
export function chunkMessage(text, limit = 4000) {
  const chunks = [];
  let cur = '';
  const flush = () => {
    if (cur) chunks.push(cur);
    cur = '';
  };
  for (const line of text.split('\n')) {
    const cps = Array.from(line);
    const parts =
      cps.length > limit
        ? Array.from({ length: Math.ceil(cps.length / limit) }, (_, i) =>
            cps.slice(i * limit, (i + 1) * limit).join('')
          )
        : [line];
    for (const part of parts) {
      const candidate = cur ? `${cur}\n${part}` : part;
      if (Array.from(candidate).length > limit) {
        flush();
        cur = part;
      } else {
        cur = candidate;
      }
    }
  }
  flush();
  return chunks.length ? chunks : [''];
}

// Diễn giải reply dạng token ("1A", "2b", "A" khi 1 câu) thành nhãn option; text tự do → null.
export function resolveAnswerTokens(raw, questions) {
  const parts = (raw || '').trim().split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return null;
  const resolved = [];
  for (const part of parts) {
    const m = part.match(/^(\d*)([A-Za-z])$/);
    if (!m) return null;
    const qIndex = m[1] ? Number(m[1]) - 1 : questions.length === 1 ? 0 : -1;
    const oIndex = m[2].toUpperCase().charCodeAt(0) - 65;
    const question = questions[qIndex];
    const option = question?.options?.[oIndex];
    if (!question || !option) return null;
    resolved.push(`Câu ${qIndex + 1} "${question.question}" → "${option.label}"`);
  }
  return resolved;
}

export function buildDenyReason(replyText, questions, str) {
  const lines = [str.answerPrefix(replyText)];
  const resolved = resolveAnswerTokens(replyText, questions);
  if (resolved) lines.push(str.answerResolved(resolved));
  return lines.join('\n');
}

export function denyOutput(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

export function formatAskOutput(providerId, reason) {
  const provider = normalizeProviderId(providerId);
  if (provider === 'antigravity') return JSON.stringify({ decision: 'deny', reason });
  // Codex CLI notifications do not expose a stable simple hook output contract for Ask.
  // Keep Claude-compatible output as the safe default until a concrete app-server bridge is used.
  return denyOutput(reason);
}

export async function promptTelegramAsk({ payload, cfg, tg, env, home = homedir(), questions, text }) {
  if (!cfg.remote) return { type: 'remote-off' };
  if (!Array.isArray(questions) || questions.length === 0) return { type: 'invalid' };

  const dir = ensureStateDirs(home);
  gcStateDir(dir);

  const messageIds = [];
  for (const chunk of chunkMessage(text)) {
    let sent;
    try {
      sent = await tg.sendMessage(chunk, { providerId: cfg.providerId });
    } catch {
      break;
    }
    if (!sent?.message_id) break;
    messageIds.push(sent.message_id);
  }
  if (!messageIds.length) return { type: 'send-failed' };

  const anchorId = messageIds[messageIds.length - 1];
  const key = pendingKey(payload.session_id, questions);
  writeFileSync(
    pendingPath(dir, key),
    JSON.stringify({ messageId: anchorId, messageIds, sessionId: payload.session_id || '', sentAt: Date.now() })
  );

  const deadline = Date.now() + cfg.remoteAskTimeoutSec * 1000;
  const outcome = await waitForReply({ tg, cfg, dir, ownMessageIds: messageIds, deadline, env, home });
  return { type: 'ok', outcome, anchorId, key, dir, pendingFile: pendingPath(dir, key) };
}

export async function runAsk(payload, cfg, tg, env, home = homedir()) {
  if (!cfg.remote) return null;
  const questions = payload.tool_input?.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const str = strings(cfg);
  const text = buildAskMessage(questions, {
    project: projectName(payload, env),
    suffix: String(payload.session_id || '').slice(-4),
    str,
    providerId: cfg.providerId,
  });

  const prompt = await promptTelegramAsk({ payload, cfg, tg, env, home, questions, text });
  if (prompt.type !== 'ok') return null;
  const { outcome, anchorId, key, dir } = prompt;

  if (outcome.type === 'reply' && !isLocalKeyword(outcome.text)) {
    await tg.editMessageText(anchorId, str.answeredTg(outcome.text)).catch(() => {});
    try {
      unlinkSync(pendingPath(dir, key));
    } catch {
      // đã bị GC
    }
    return formatAskOutput(cfg.providerId, buildDenyReason(outcome.text, questions, str));
  }

  // local / remote-off / timeout → giữ pending cho ask-done chốt sổ khi user bấm tại máy.
  // Chỉ sửa tin neo thành ghi chú ngắn (KHÔNG nhồi lại full text — có thể vượt 4096).
  await tg.editMessageText(anchorId, outcome.type === 'timeout' ? str.timedOut : str.movedLocal).catch(() => {});
  return null;
}

// tool_response của AskUserQuestion có thể đổi shape theo version → trích phòng thủ.
export function extractLocalAnswers(toolResponse) {
  const answers = toolResponse?.answers ?? toolResponse;
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    const parts = Object.entries(answers)
      .filter(([, v]) => typeof v === 'string' && v)
      .map(([q, v]) => `"${v}"`);
    if (parts.length) return parts.join(', ');
  }
  if (typeof answers === 'string' && answers) return answers;
  try {
    const s = JSON.stringify(toolResponse);
    if (s && s !== '{}' && s !== 'null') return Array.from(s).slice(0, 200).join('');
  } catch {
    // không stringify được
  }
  return '';
}

export async function runAskDone(payload, cfg, tg, home = homedir()) {
  const questions = payload.tool_input?.questions;
  if (!Array.isArray(questions)) return;
  const dir = stateDir(home);
  const file = pendingPath(dir, pendingKey(payload.session_id, questions));
  if (!existsSync(file)) return; // remote off, hoặc đã trả lời qua Telegram
  let pending = null;
  try {
    pending = JSON.parse(readFileSync(file, 'utf8'));
    unlinkSync(file);
  } catch {
    return;
  }
  const str = strings(cfg);
  const answers = extractLocalAnswers(payload.tool_response);
  await tg.editMessageText(pending.messageId, str.answeredLocal(answers || '…'));
}

// Stop sweep: câu hỏi bị Esc (PostToolUse không bắn) → đóng tin cho khỏi treo mồ côi.
export async function sweepSessionPending(sessionId, cfg, tg, home = homedir(), { kinds } = {}) {
  if (!sessionId) return;
  const dir = stateDir(home);
  for (const p of listPending(dir)) {
    if (p.sessionId !== sessionId) continue;
    if (kinds && !kinds.includes(p.kind)) continue;
    try {
      unlinkSync(p.file);
    } catch {
      continue; // process khác vừa xử lý
    }
    const str = strings(cfg);
    const closedText =
      p.kind === 'plan' ? str.planClosedLocal : p.kind === 'perm' ? str.permClosed : str.closedUnanswered;
    await tg.editMessageText(p.messageId, closedText).catch(() => {});
  }
}

//
// PermissionRequest hook CHỈ bắn khi hộp thoại quyền sắp hiện (tool đã được allow-rule
// duyệt sẵn thì không bắn) ⇒ không cần lọc gì thêm để tránh spam.
//
// Schema (đã đối chiếu zod trong binary Claude Code 2.1.149):
//   in : { session_id, transcript_path, cwd, permission_mode?, hook_event_name,
//          tool_name, tool_input, permission_suggestions? }
//   out: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision:
//            { behavior:'allow', updatedInput?, updatedPermissions? }
//          | { behavior:'deny', message?, interrupt? } } }
// Không in gì = im lặng KHÔNG phải đồng ý — hộp thoại vẫn hiện tại máy.
