// Ghi config cho CLI (chứa bot token → chmod 600 trên Unix). Đường dẫn và cách đọc dùng chung
// với hook runtime trong hook/lib/config.mjs — chỉ một nơi định nghĩa.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { configDir, configFile, configThreadId, isSwitchOn, readRawConfig } from '../hook/lib/config.mjs';

// Đưa config về dạng hiện tại: `remote` / `remotePermission` là boolean, topic nằm ở `threadId`.
// Config do bản multi-provider cũ ghi (object { global, providers }, providerThreads,
// enabledProviders) được chuyển đổi tại đây và bỏ các key không còn dùng.
export function normalizeConfig(cfg = {}) {
  const { providerThreads, enabledProviders, ...rest } = cfg;
  const threadId = configThreadId(cfg);
  delete rest.threadId;
  return {
    ...rest,
    ...(threadId != null && threadId !== '' ? { threadId } : {}),
    remote: isSwitchOn(cfg.remote),
    remotePermission: isSwitchOn(cfg.remotePermission),
  };
}

export function readConfig(home = homedir()) {
  const raw = readRawConfig(home);
  return raw ? normalizeConfig(raw) : null;
}

export function writeConfig(cfg, home = homedir()) {
  const file = configFile(home);
  mkdirSync(configDir(home), { recursive: true });
  writeFileSync(file, JSON.stringify(normalizeConfig(cfg), null, 2) + '\n');
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  return file;
}

// Migrate setup cũ (bash hook): ~/.claude/hooks/telegram.conf dạng shell KEY=value.
export function readLegacyConf(home = homedir()) {
  const file = join(home, '.claude', 'hooks', 'telegram.conf');
  if (!existsSync(file)) return null;
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)\s*=\s*("?)(.*?)\2\s*$/);
    if (m) out[m[1] === 'TELEGRAM_BOT_TOKEN' ? 'botToken' : 'chatId'] = m[3];
  }
  return out.botToken || out.chatId ? out : null;
}
