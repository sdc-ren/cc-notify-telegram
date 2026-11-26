// Bật/tắt Remote Ask (`remote`) và Remote Permission (`remotePermission`):
// ghi cờ vào config + báo trạng thái lên Telegram.

import { homedir } from 'node:os';
import { basename } from 'node:path';

import { hasCredentials, loadConfig, makeTelegram } from '../hook/notify-telegram.mjs';
import { readConfig, writeConfig } from './config.mjs';

const MODES = {
  remote: {
    usage: 'Cách dùng: cc-notify-telegram remote on|off',
    on: '📱 Remote Ask BẬT — câu hỏi của Claude sẽ gửi qua Telegram (câu hỏi đang treo sẽ nhả về máy khi tắt).',
    off: '🖥 Remote Ask TẮT — câu hỏi hiện tại máy như bình thường.',
    onTg: (project) => `📱 Remote Ask BẬT (từ ${project})`,
    offTg: (project) => `🖥 Remote Ask TẮT (từ ${project})`,
  },
  remotePermission: {
    usage: 'Cách dùng: cc-notify-telegram remote-perm on|off',
    on: '🔐 Remote Permission BẬT — yêu cầu quyền sẽ gửi kèm nút bấm qua Telegram.',
    off: '🖥 Remote Permission TẮT — hộp thoại quyền hiện tại máy như bình thường.',
    onTg: (project) => `🔐 Remote Permission BẬT (từ ${project})`,
    offTg: (project) => `🖥 Remote Permission TẮT (từ ${project})`,
  },
};

function isTransientSendError(err) {
  const text = `${err?.message || ''} ${err?.cause?.code || ''}`;
  return /fetch failed|timed out|UND_ERR_CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(tg, text, { attempts = 2, delayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await tg.sendMessage(text);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isTransientSendError(err)) break;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

export async function runRemote(
  mode,
  { home = homedir(), log = console.log, cwd = process.cwd(), key = 'remote' } = {}
) {
  const texts = MODES[key];
  if (mode !== 'on' && mode !== 'off') {
    log(texts.usage);
    return false;
  }
  const config = readConfig(home);
  if (!config) {
    log('Chưa có config — chạy: npx -y github:sdc-ren/cc-notify-telegram init');
    return false;
  }
  const enabling = mode === 'on';
  config[key] = enabling;
  writeConfig(config, home);
  log(enabling ? texts.on : texts.off);

  // Remote Permission vô dụng nếu thiếu 2 điều kiện này — nói ngay thay vì để user chờ mãi.
  if (key === 'remotePermission' && enabling) {
    if (!(config.allowedUserIds || []).length) {
      log('⚠️  Chưa có allowedUserIds — KHÔNG ai duyệt được từ xa (fail-closed).');
      log('    Chạy `npx -y github:sdc-ren/cc-notify-telegram init` để dò/thêm user ID được phép duyệt.');
    }
    if (config.remote !== true) {
      log('⚠️  Remote Ask đang TẮT — bật luôn bằng `npx -y github:sdc-ren/cc-notify-telegram remote on`.');
    }
  }

  const cfg = loadConfig({ home });
  if (hasCredentials(cfg)) {
    const project = basename(cwd);
    await sendWithRetry(makeTelegram(cfg), enabling ? texts.onTg(project) : texts.offTg(project)).catch((err) =>
      log(`⚠️  Không gửi được tin báo trạng thái: ${err.message || err} — cờ vẫn đã lưu.`)
    );
  }
  return true;
}
