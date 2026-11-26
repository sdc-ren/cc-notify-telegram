// Đường dẫn, marker, đọc config.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MARKER_DONE = 'CC_NOTIFY_DONE';

export const MARKER_ESCALATE = 'CC_NOTIFY_ESCALATE';

export const POLL_LONG_SEC = 20; // long-poll getUpdates mỗi vòng

export const LOCK_STALE_MS = 60_000; // heartbeat cũ hơn ngưỡng này = poller chết → takeover

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // dọn rác file pending/inbox mồ côi

const MAX_ASK_TIMEOUT_SEC = 1770; // phải < timeout 1830s của hook entry trong settings

export const MAX_SESSION_ALLOW_MIN = 8 * 60; // trần "cho phép tất cả trong session" — không để mở vô hạn

export function claudeDir(home = homedir()) {
  return join(home, '.claude');
}

export function configDir(home = homedir()) {
  return join(home, '.config', 'ai-notify-telegram');
}

export function configFile(home = homedir()) {
  return join(configDir(home), 'config.json');
}

export function legacyConfigFile(home = homedir()) {
  return join(claudeDir(home), 'cc-notify-telegram.json');
}

export function stateDir(home = homedir()) {
  return join(configDir(home), 'state');
}

export function legacyStateDir(home = homedir()) {
  return join(claudeDir(home), 'cc-notify-telegram');
}

// Nội dung thô của file config (đường dẫn mới, rồi tới đường dẫn cũ); null nếu không đọc được.
export function readRawConfig(home = homedir()) {
  for (const file of [configFile(home), legacyConfigFile(home)]) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // thử đường dẫn tiếp theo
    }
  }
  return null;
}

// Công tắc `remote` / `remotePermission`: boolean (dạng hiện tại) hoặc object
// { global, providers: { claude, ... } } do bản multi-provider cũ ghi ra. Với dạng object:
// bật = global bật VÀ claude không bị tắt tường minh.
export function isSwitchOn(value) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.global === true && value.providers?.claude !== false;
  }
  return false;
}

// Topic: bản multi-provider cũ có thể lưu topic riêng của Claude ở providerThreads.claude.
export function configThreadId(file) {
  const legacy = file?.providerThreads?.claude;
  if (legacy != null && legacy !== '') return legacy;
  return file?.threadId;
}

export function loadConfig({ env = process.env, home = homedir() } = {}) {
  const file = readRawConfig(home) ?? {};
  const timeout = Number(file.remoteAskTimeoutSec);
  const ttl = Number(file.sessionAllowTtlMin);
  const envBool = (envValue, fallback) =>
    envValue != null ? ['1', 'true', 'on'].includes(String(envValue).toLowerCase()) : fallback;
  return {
    botToken: env.TELEGRAM_BOT_TOKEN || file.botToken || '',
    chatId: env.TELEGRAM_CHAT_ID || file.chatId || '',
    threadId: env.TELEGRAM_THREAD_ID || configThreadId(file) || undefined,
    lang: file.lang === 'en' ? 'en' : 'vi',
    silent: file.silent === true,
    // 'summary' (mặc định): chỉ gửi các bước chính của plan · 'full': nguyên văn.
    planDetail: String(env.CC_NOTIFY_PLAN_DETAIL ?? file.planDetail ?? '').toLowerCase() === 'full' ? 'full' : 'summary',
    // Env CC_NOTIFY_REMOTE=1/0 override cho từng session.
    remote: envBool(env.CC_NOTIFY_REMOTE, isSwitchOn(file.remote)),
    remotePermission: envBool(env.CC_NOTIFY_REMOTE_PERM, isSwitchOn(file.remotePermission)),
    // So sánh dạng chuỗi: config có thể ghi số hoặc chuỗi, from.id của Telegram luôn là số.
    allowedUserIds: (Array.isArray(file.allowedUserIds) ? file.allowedUserIds : [])
      .map((id) => String(id).trim())
      .filter(Boolean),
    sessionAllowTtlMin: Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, MAX_SESSION_ALLOW_MIN) : 30,
    remoteAskTimeoutSec:
      Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, MAX_ASK_TIMEOUT_SEC) : 900,
  };
}

export function hasCredentials(cfg) {
  return Boolean(cfg.botToken && cfg.chatId);
}
