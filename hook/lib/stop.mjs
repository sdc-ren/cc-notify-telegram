// EVENT stop — đọc tin cuối trong transcript, tách marker DONE/ESCALATE.

import { existsSync, readFileSync } from 'node:fs';
import { MARKER_DONE, MARKER_ESCALATE } from './config.mjs';
import { projectName, strings } from './strings.mjs';
import { sweepSessionPending } from './ask.mjs';
import { sendAwayAware } from './presence.mjs';

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

export async function runStop(payload, cfg, tg, env) {
  const transcript = payload.transcript_path;
  const hasTranscript = transcript && existsSync(transcript);
  const lines = hasTranscript ? readFileSync(transcript, 'utf8').split('\n').filter(Boolean) : [];
  const str = strings(cfg);
  const last = payload.last_assistant_message || lastAssistantText(lines);
  const message = buildStopMessage({ last, project: projectName(payload, env), snippet: firstUserSnippet(lines), str });
  // Quét pending mồ côi của session này (user Esc câu hỏi → PostToolUse không bắn).
  await sweepSessionPending(payload.session_id, cfg, tg).catch(() => {});
  if (message) await sendAwayAware(tg, cfg, message);
}
