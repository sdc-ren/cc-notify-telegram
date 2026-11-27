// Doctor: kiểm tra từng mắt xích của chuỗi notify và in ✓/✗ kèm cách sửa.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  configFile,
  hasCredentials,
  isTokenError,
  loadConfig,
  makeTelegram,
  networkErrorDetail,
} from '../hook/notify-telegram.mjs';
import { HOOK_ENTRIES, parseHookCommand } from './settings.mjs';
import { hasBlock } from './snippet.mjs';
import { installPaths } from './init.mjs';
import { isHookRuntimeInstalled, isHookRuntimeStale, runtimeDir } from './hook-runtime.mjs';

// Node mà launcher sẽ dùng (Node lúc cài, hoặc Node khác nó tìm được); null nếu không có.
export function launcherNode(launcherPath, recordedNode, run = execFileSync) {
  try {
    const out = run('/bin/sh', [launcherPath, '--which', recordedNode || ''], { encoding: 'utf8', timeout: 10000 });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

// Một dòng ✓/✗ cho Node của các hook (mọi hook dùng chung một command nên chỉ cần kiểm 1 lần).
export function nodeCheck(command, { exists = existsSync, whichNode = launcherNode } = {}) {
  const { launcherPath, nodePath } = parseHookCommand(command);
  if (!launcherPath) {
    const ok = Boolean(nodePath && exists(nodePath));
    return {
      ok,
      label: `Node của hook: ${nodePath || '?'}`,
      fix: 'node đã bị xoá/đổi version — chạy lại init',
    };
  }
  if (!exists(launcherPath)) {
    return { ok: false, label: `Thiếu ${launcherPath}`, fix: 'chạy lại init' };
  }
  const used = whichNode(launcherPath, nodePath);
  if (!used) {
    return { ok: false, label: 'Không tìm thấy Node >= 22 nào cho hook', fix: 'cài Node >= 22 rồi chạy lại init' };
  }
  if (used === nodePath) return { ok: true, label: `Node của hook: ${used}` };
  return {
    ok: true,
    label: `Node lúc cài (${nodePath}) không còn — hook đang dùng ${used}; nên chạy lại init`,
  };
}

export async function runStatus({ home = homedir(), log = console.log } = {}) {
  const paths = installPaths(home);
  const cfg = loadConfig({ home });
  const rows = [];
  const add = (ok, label, fix = '') => rows.push({ ok, label, fix });

  // Config
  const cfgFile = configFile(home);
  if (hasCredentials(cfg)) {
    add(true, `Config: ${cfgFile}`);
    if (process.platform !== 'win32' && existsSync(cfgFile)) {
      const mode = statSync(cfgFile).mode & 0o777;
      add(mode === 0o600, `Quyền config ${mode.toString(8)} (nên 600)`, 'chmod 600 file config');
    }
  } else {
    add(false, 'Config thiếu botToken/chatId', 'chạy: npx -y github:sdc-ren/cc-notify-telegram init');
  }

  // Token sống?
  if (hasCredentials(cfg)) {
    try {
      const me = await makeTelegram(cfg).getMe();
      add(true, `Bot @${me.username} — token hợp lệ`);
    } catch (err) {
      if (err.kind === 'network') {
        add(
          false,
          `Không kết nối được Telegram: ${err.message}${networkErrorDetail(err)}`,
          'lỗi mạng, KHÔNG phải token — kiểm tra mạng/VPN/proxy tới api.telegram.org rồi chạy lại'
        );
      } else if (isTokenError(err)) {
        add(false, `getMe lỗi: ${err.message}`, 'token sai hoặc đã bị thu hồi — lấy token mới từ @BotFather rồi chạy lại init');
      } else {
        add(false, `getMe lỗi: ${err.message}`, 'xem thông báo lỗi của Telegram ở trên');
      }
    }
  }

  // Hook file
  const hookInstalled = isHookRuntimeInstalled(paths.hookFile);
  add(hookInstalled, `Hook: ${paths.hookFile} + ${runtimeDir(paths.hookFile)}`, 'chạy lại init để copy hook');
  if (hookInstalled) {
    const stale = isHookRuntimeStale(paths.hookFile);
    add(
      !stale,
      stale ? 'Hook đã cài KHÁC bản CLI đang chạy' : 'Hook đã cài khớp bản CLI đang chạy',
      'chạy lại init để cập nhật hook'
    );
  }

  // Settings entries + Node mà hook sẽ chạy
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(paths.settingsFile, 'utf8'));
  } catch {
    add(false, `Không đọc được ${paths.settingsFile}`, 'chạy lại init');
  }
  let commandForNode = null;
  for (const spec of HOOK_ENTRIES) {
    const groups = settings?.hooks?.[spec.event] || [];
    const ours = groups.find((g) =>
      (g.hooks || []).some((h) => (h.command || '').includes('cc-notify-telegram.mjs'))
    );
    if (!ours) {
      add(false, `settings.json thiếu hook ${spec.event}`, 'chạy lại init');
      continue;
    }
    add(true, `Hook ${spec.event} đã đăng ký`);
    commandForNode ??= ours.hooks.find((h) => (h.command || '').includes('cc-notify-telegram.mjs'))?.command;
  }
  if (commandForNode) {
    const node = nodeCheck(commandForNode);
    add(node.ok, node.label, node.fix);
  }

  // CLAUDE.md snippet
  const claudeMd = existsSync(paths.claudeMdFile) ? readFileSync(paths.claudeMdFile, 'utf8') : '';
  add(
    hasBlock(claudeMd),
    'CLAUDE.md có hướng dẫn marker',
    'không có → Claude không phát marker, không có notify; chạy lại init'
  );

  // Remote mode
  add(true, `Remote Ask: ${cfg.remote ? `ON (chờ tối đa ${cfg.remoteAskTimeoutSec}s)` : 'off'}`);

  // Remote Permission — bật mà thiếu điều kiện thì hook im lặng (fail-closed), phải nói rõ.
  if (!cfg.remotePermission) {
    add(true, 'Remote Permission: off');
  } else if (!cfg.allowedUserIds.length) {
    add(false, 'Remote Permission: ON nhưng allowedUserIds RỖNG', 'không ai duyệt được — chạy lại init để thêm user ID');
  } else if (!cfg.remote) {
    add(false, `Remote Permission: ON (${cfg.allowedUserIds.length} user) nhưng Remote Ask đang off`, 'chạy: npx -y github:sdc-ren/cc-notify-telegram remote on');
  } else {
    add(true, `Remote Permission: ON — ${cfg.allowedUserIds.length} user được duyệt, "cho phép tất cả" tối đa ${cfg.sessionAllowTtlMin}′`);
  }

  log('📊 cc-notify-telegram — Claude Code');
  let allOk = true;
  for (const r of rows) {
    log(`${r.ok ? '✓' : '✗'} ${r.label}${!r.ok && r.fix ? `\n    ↳ ${r.fix}` : ''}`);
    if (!r.ok) allOk = false;
  }
  log('');
  log(allOk ? '✅ Mọi thứ sẵn sàng.' : '⚠️  Có mục cần sửa (xem ↳ ở trên).');
  return allOk;
}
