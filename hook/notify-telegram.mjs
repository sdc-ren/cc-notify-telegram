#!/usr/bin/env node
// cc-notify-telegram — Claude Code hook runtime (self-contained, zero-dependency).
//
// Installer copy file này + thư mục lib/ vào ~/.claude/hooks/cc-notify-telegram/, rồi ghi shim
// ~/.claude/hooks/cc-notify-telegram.mjs gọi runCli() (đường dẫn hook trong settings giữ nguyên).
// Phục vụ 5 hook event (arg đầu tiên quyết định event):
//   stop      Stop hook              → báo Telegram khi tin cuối chứa marker CC_NOTIFY_DONE/ESCALATE
//   ask       PreToolUse hook        → Remote Ask: gửi AskUserQuestion qua Telegram, chờ reply
//   ask-done  PostToolUse hook       → chốt sổ tin câu hỏi khi user trả lời tại máy
//   notify    Notification hook      → forward "cần permission / đang chờ input" khi remote bật
//   perm      PermissionRequest hook → Remote Permission: gửi yêu cầu quyền kèm nút bấm, chờ chọn
//
// Nguyên tắc an toàn: LUÔN exit 0, lỗi gì cũng im lặng — không bao giờ chặn Claude Code.
// Không output gì trên stdout = hành vi mặc định (UI hiện như thường).

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hasCredentials, loadConfig, normalizeProviderId, PROVIDERS } from './lib/config.mjs';
import { projectName, strings } from './lib/strings.mjs';
import { makeTelegram } from './lib/telegram.mjs';
import { runStop } from './lib/stop.mjs';
import { runAsk, runAskDone } from './lib/ask.mjs';
import { runPerm } from './lib/perm.mjs';
import { runNotify } from './lib/notify.mjs';

// Giữ API cũ: test, CLI và bridge import mọi thứ từ file này.
export * from './lib/config.mjs';
export * from './lib/strings.mjs';
export * from './lib/telegram.mjs';
export * from './lib/state.mjs';
export * from './lib/poller.mjs';
export * from './lib/stop.mjs';
export * from './lib/ask.mjs';
export * from './lib/plan.mjs';
export * from './lib/perm.mjs';
export * from './lib/notify.mjs';

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function parseRuntimeArgs(args, env = process.env) {
  if (PROVIDERS.includes(args[0])) {
    return { providerId: args[0], event: args[1] || 'stop' };
  }
  return {
    event: args[0] || 'stop',
    providerId: normalizeProviderId(args[1] || env.AI_NOTIFY_PROVIDER || env.CC_NOTIFY_PROVIDER || 'claude'),
  };
}

function normalizeRuntimePayload(raw, providerId, event, env = process.env) {
  const provider = normalizeProviderId(raw.provider || raw.providerId || providerId);
  const toolCall = raw.toolCall || {};
  const toolArgs = toolCall.args || raw.tool_input || raw.toolInput || {};
  const questions = Array.isArray(toolArgs.questions)
    ? toolArgs.questions.map((q) => ({
        ...q,
        multiSelect: q.multiSelect ?? q.is_multi_select,
      }))
    : raw.questions;
  const command = raw.command || raw.item?.command || raw.commandActions?.[0]?.command;
  const sessionId = raw.session_id || raw.sessionId || raw.conversationId || raw.threadId || raw.turnId || '';
  return {
    ...raw,
    provider,
    session_id: sessionId,
    turn_id: raw.turn_id || raw.turnId || raw['turn-id'],
    transcript_path: raw.transcript_path || raw.transcriptPath,
    cwd: raw.cwd || raw.cwdPath || raw.workspacePaths?.[0] || process.cwd(),
    tool_name: raw.tool_name || raw.toolName || toolCall.name || (command ? 'Command' : undefined),
    tool_input: {
      ...(command ? { command, cwd: raw.cwd, reason: raw.reason } : {}),
      ...toolArgs,
      ...(questions ? { questions } : {}),
    },
    tool_response: raw.tool_response || raw.toolResponse,
    message: raw.message || raw.reason || raw.notification?.message,
    notification_type: raw.notification_type || raw.notificationType,
    type: raw.type,
    input_messages: raw.input_messages || raw.inputMessages || raw['input-messages'],
    last_assistant_message: raw.last_assistant_message || raw.lastAssistantMessage || raw['last-assistant-message'],
    _normalizedProvider: provider,
    _normalizedEvent: event,
    _project: projectName(raw, env),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseRuntimeArgs(args);
  let cfg = loadConfig({ providerId: parsed.providerId });

  if (args.includes('--test')) {
    if (hasCredentials(cfg)) await makeTelegram(cfg).sendMessage(strings(cfg).testMessage);
    return null;
  }
  if (!hasCredentials(cfg)) return null;

  let payload = {};
  const stdin = await readStdin();
  const argvPayload = args.find((arg, index) => index > 1 && String(arg).trim().startsWith('{'));
  try {
    payload = JSON.parse(stdin || argvPayload || '{}');
  } catch {
    return null;
  }
  const providerId = normalizeProviderId(payload.provider || payload.providerId || parsed.providerId);
  cfg = loadConfig({ providerId });
  cfg.providerId = providerId;
  payload = normalizeRuntimePayload(payload, providerId, parsed.event, process.env);
  const tg = makeTelegram(cfg);

  if (parsed.event === 'stop') return runStop(payload, cfg, tg, process.env).then(() => null);
  if (parsed.event === 'ask') return runAsk(payload, cfg, tg, process.env);
  if (parsed.event === 'ask-done') return runAskDone(payload, cfg, tg).then(() => null);
  if (parsed.event === 'notify') return runNotify(payload, cfg, tg, process.env).then(() => null);
  if (parsed.event === 'perm') return runPerm(payload, cfg, tg, process.env);
  return null;
}

// Chạy như hook: in output (nếu có) rồi LUÔN exit 0. Shim đã cài gọi hàm này.
export function runCli() {
  return main()
    .then((output) => {
      if (output) process.stdout.write(output + '\n');
      process.exit(0);
    })
    .catch(() => process.exit(0));
}

// realpath để guard vẫn đúng nếu file/thư mục được symlink (cùng lý do với bin/cli.mjs).
let isMain = false;
try {
  isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
} catch {
  isMain = false;
}
if (isMain) runCli();
