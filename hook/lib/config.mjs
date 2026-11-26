// Đường dẫn, marker, đọc config + công tắc theo provider.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MARKER_DONE = 'CC_NOTIFY_DONE';

export const MARKER_ESCALATE = 'CC_NOTIFY_ESCALATE';

export const AI_MARKER_DONE = 'AI_NOTIFY_DONE';

export const AI_MARKER_ESCALATE = 'AI_NOTIFY_ESCALATE';

export const PROVIDERS = ['claude', 'codex', 'antigravity'];

const PROVIDER_DISPLAY = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

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

export function normalizeProviderId(value) {
  return PROVIDERS.includes(value) ? value : 'claude';
}

export function providerDisplayName(providerId = 'claude') {
  return PROVIDER_DISPLAY[normalizeProviderId(providerId)];
}

function boolOrDefault(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeProviderMap(value, fallback = false) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(PROVIDERS.map((id) => [id, boolOrDefault(input[id], fallback)]));
}

function normalizeToggle(value, fallback = false, { legacy = false } = {}) {
  if (typeof value === 'boolean') {
    if (legacy) return { global: value, providers: { claude: value, codex: false, antigravity: false } };
    return { global: value, providers: normalizeProviderMap(null, value) };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const global = boolOrDefault(value.global, fallback);
    return { global, providers: normalizeProviderMap(value.providers, global) };
  }
  return { global: fallback, providers: normalizeProviderMap(null, fallback) };
}

function normalizeEnabledProviders(value) {
  if (!Array.isArray(value)) return ['claude'];
  const ids = [...new Set(value.filter((id) => PROVIDERS.includes(id)))];
  return ids.length ? ids : ['claude'];
}

function readConfigFile(home) {
  try {
    return { data: JSON.parse(readFileSync(configFile(home), 'utf8')), legacy: false };
  } catch {
    try {
      return { data: JSON.parse(readFileSync(legacyConfigFile(home), 'utf8')), legacy: true };
    } catch {
      return { data: {}, legacy: false };
    }
  }
}

export function isProviderEnabled(cfg, providerId = 'claude') {
  return (cfg.enabledProviders || ['claude']).includes(normalizeProviderId(providerId));
}

export function isRemoteEnabled(cfg, providerId = 'claude') {
  const id = normalizeProviderId(providerId);
  if (!isProviderEnabled(cfg, id)) return false;
  const toggle = cfg.remoteConfig || normalizeToggle(cfg.remote, false);
  return toggle.global === true && toggle.providers[id] === true;
}

export function isRemotePermEnabled(cfg, providerId = 'claude') {
  const id = normalizeProviderId(providerId);
  if (!isProviderEnabled(cfg, id)) return false;
  const toggle = cfg.remotePermissionConfig || normalizeToggle(cfg.remotePermission, false);
  return toggle.global === true && toggle.providers[id] === true;
}

export function loadConfig({ env = process.env, home = homedir(), providerId = 'claude' } = {}) {
  const source = readConfigFile(home);
  const file = source.data;
  const timeout = Number(file.remoteAskTimeoutSec);
  const ttl = Number(file.sessionAllowTtlMin);
  const envBool = (envValue, fallback) =>
    envValue != null ? ['1', 'true', 'on'].includes(String(envValue).toLowerCase()) : fallback;
  const remoteConfig = normalizeToggle(file.remote, false, { legacy: source.legacy });
  const remotePermissionConfig = normalizeToggle(file.remotePermission, false, { legacy: source.legacy });
  if (env.CC_NOTIFY_REMOTE != null || env.AI_NOTIFY_REMOTE != null) {
    const enabled = envBool(env.AI_NOTIFY_REMOTE ?? env.CC_NOTIFY_REMOTE, remoteConfig.global);
    remoteConfig.global = enabled;
    remoteConfig.providers = normalizeProviderMap(null, enabled);
  }
  if (env.CC_NOTIFY_REMOTE_PERM != null || env.AI_NOTIFY_REMOTE_PERM != null) {
    const enabled = envBool(env.AI_NOTIFY_REMOTE_PERM ?? env.CC_NOTIFY_REMOTE_PERM, remotePermissionConfig.global);
    remotePermissionConfig.global = enabled;
    remotePermissionConfig.providers = normalizeProviderMap(null, enabled);
  }
  const cfg = {
    botToken: env.TELEGRAM_BOT_TOKEN || file.botToken || '',
    chatId: env.TELEGRAM_CHAT_ID || file.chatId || '',
    threadId: env.TELEGRAM_THREAD_ID || file.threadId || undefined,
    providerThreads: file.providerThreads && typeof file.providerThreads === 'object' ? file.providerThreads : {},
    enabledProviders: normalizeEnabledProviders(file.enabledProviders),
    lang: file.lang === 'en' ? 'en' : 'vi',
    silent: file.silent === true,
    // 'summary' (mặc định): chỉ gửi các bước chính của plan · 'full': nguyên văn.
    planDetail: String(env.CC_NOTIFY_PLAN_DETAIL ?? file.planDetail ?? '').toLowerCase() === 'full' ? 'full' : 'summary',
    remoteConfig,
    remotePermissionConfig,
    // So sánh dạng chuỗi: config có thể ghi số hoặc chuỗi, from.id của Telegram luôn là số.
    allowedUserIds: (Array.isArray(file.allowedUserIds) ? file.allowedUserIds : [])
      .map((id) => String(id).trim())
      .filter(Boolean),
    sessionAllowTtlMin: Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, MAX_SESSION_ALLOW_MIN) : 30,
    remoteAskTimeoutSec:
      Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, MAX_ASK_TIMEOUT_SEC) : 900,
  };
  cfg.remote = isRemoteEnabled(cfg, providerId);
  cfg.remotePermission = isRemotePermEnabled(cfg, providerId);
  return cfg;
}

export function hasCredentials(cfg) {
  return Boolean(cfg.botToken && cfg.chatId);
}
