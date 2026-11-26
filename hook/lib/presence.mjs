// "Chỉ báo khi vắng máy": người dùng vừa đụng bàn phím/chuột trong `awayMinutes` phút gần đây
// thì coi là đang ngồi ở máy → tin DONE/🛑/notify gửi im lặng (hoặc bỏ hẳn nếu whenPresent=skip).
// Chỉ macOS (đọc HIDIdleTime qua ioreg). Đọc không được → coi như vắng, gửi bình thường.

import { execFileSync } from 'node:child_process';

// Số giây kể từ lần cuối người dùng đụng bàn phím/chuột; null nếu không đọc được.
export function parseHidIdleSeconds(ioregOutput) {
  const m = String(ioregOutput || '').match(/"HIDIdleTime"\s*=\s*(\d+)/);
  return m ? Number(m[1]) / 1e9 : null;
}

export function userIdleSeconds({ platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'darwin') return null;
  try {
    const out = run('ioreg', ['-c', 'IOHIDSystem', '-d', '4', '-r', '-k', 'HIDIdleTime'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseHidIdleSeconds(out);
  } catch {
    return null;
  }
}

// 'send' (bình thường) | 'silent' (gửi không chuông) | 'skip' (không gửi).
export function presenceDelivery(cfg, { idleSeconds = userIdleSeconds } = {}) {
  const minutes = Number(cfg.awayMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'send';
  const idle = idleSeconds();
  if (idle == null || idle >= minutes * 60) return 'send';
  return cfg.whenPresent === 'skip' ? 'skip' : 'silent';
}

// Gửi một tin "thông báo" (DONE/🛑/notify) theo chế độ vắng máy.
export async function sendAwayAware(tg, cfg, text, deps) {
  const delivery = presenceDelivery(cfg, deps);
  if (delivery === 'skip') return null;
  return tg.sendMessage(text, delivery === 'silent' ? { disable_notification: true } : {});
}
