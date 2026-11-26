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
import { hasCredentials, loadConfig } from './lib/config.mjs';
import { strings } from './lib/strings.mjs';
import { makeTelegram } from './lib/telegram.mjs';
import { runStop } from './lib/stop.mjs';
import { runAsk, runAskDone } from './lib/ask.mjs';
import { runPerm } from './lib/perm.mjs';
import { runNotify } from './lib/notify.mjs';

// Giữ API cũ: test và CLI import mọi thứ từ file này.
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

async function main() {
  // Lệnh hook: `node cc-notify-telegram.mjs <event>`; arg thừa phía sau (vd `claude` do bản
  // multi-provider cũ ghi vào settings.json) bị bỏ qua.
  const args = process.argv.slice(2);
  const event = args[0] || 'stop';
  const cfg = loadConfig();

  if (args.includes('--test')) {
    if (hasCredentials(cfg)) await makeTelegram(cfg).sendMessage(strings(cfg).testMessage);
    return null;
  }
  if (!hasCredentials(cfg)) return null;

  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || '{}');
  } catch {
    return null;
  }
  const tg = makeTelegram(cfg);

  if (event === 'stop') return runStop(payload, cfg, tg, process.env).then(() => null);
  if (event === 'ask') return runAsk(payload, cfg, tg, process.env);
  if (event === 'ask-done') return runAskDone(payload, cfg, tg).then(() => null);
  if (event === 'notify') return runNotify(payload, cfg, tg, process.env).then(() => null);
  if (event === 'perm') return runPerm(payload, cfg, tg, process.env);
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
