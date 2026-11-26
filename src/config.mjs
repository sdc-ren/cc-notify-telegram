// Đọc/ghi config (chứa bot token → chmod 600 trên Unix).
// Đường dẫn: ~/.config/ai-notify-telegram/config.json (giữ tên cũ để không làm hỏng máy đã cài).
// Đường dẫn cũ ~/.claude/cc-notify-telegram.json vẫn được đọc.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { configThreadId, isSwitchOn } from '../hook/lib/config.mjs';

export function configPath(home = homedir()) {
  return join(home, '.config', 'ai-notify-telegram', 'config.json');
}

export function legacyConfigPath(home = homedir()) {
  return join(home, '.claude', 'cc-notify-telegram.json');
}

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
  for (const file of [configPath(home), legacyConfigPath(home)]) {
    try {
      return normalizeConfig(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      // thử đường dẫn tiếp theo
    }
  }
  return null;
}

export function writeConfig(cfg, home = homedir()) {
  const file = configPath(home);
  mkdirSync(join(home, '.config', 'ai-notify-telegram'), { recursive: true });
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
