// `away <phút> [--skip]` | `away off` — chỉ báo DONE/🛑/notify khi vắng máy (macOS).

import { homedir } from 'node:os';

import { readConfig, writeConfig } from './config.mjs';

export function runAway(arg, flags = {}, { log = console.log, home = homedir(), platform = process.platform } = {}) {
  const cfg = readConfig(home);
  if (!cfg) {
    log('Chưa có config — chạy: npx -y github:sdc-ren/cc-notify-telegram init');
    return false;
  }
  const value = String(arg ?? '').trim().toLowerCase();
  if (value === 'off' || value === '0') {
    const { awayMinutes, whenPresent, ...rest } = cfg;
    writeConfig(rest, home);
    log('✅ Đã tắt chế độ vắng máy — mọi tin báo gửi như bình thường.');
    return true;
  }
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    log('Cách dùng: away <số phút> [--skip]  |  away off');
    log('  vd: away 5        — vừa dùng máy trong 5 phút thì tin báo gửi không chuông');
    log('      away 5 --skip — … thì không gửi tin báo');
    return false;
  }
  writeConfig({ ...cfg, awayMinutes: minutes, whenPresent: flags.skip ? 'skip' : 'silent' }, home);
  const action = flags.skip ? 'KHÔNG gửi' : 'gửi KHÔNG chuông';
  log(`✅ Bật chế độ vắng máy: dùng máy trong ${minutes} phút gần đây thì tin DONE/🛑/notify ${action}.`);
  log('   Câu hỏi, xin quyền, duyệt plan vẫn gửi bình thường.');
  if (platform !== 'darwin') log('⚠️  Chỉ hoạt động trên macOS — máy này sẽ gửi như bình thường.');
  return true;
}
