import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { configFile, loadConfig } from '../hook/lib/config.mjs';
import { parseHidIdleSeconds, presenceDelivery, sendAwayAware, userIdleSeconds } from '../hook/lib/presence.mjs';
import { runAway } from '../src/away.mjs';

test('parseHidIdleSeconds: đọc nano giây từ ioreg', () => {
  assert.equal(parseHidIdleSeconds('  |   "HIDIdleTime" = 98474913041\n'), 98.474913041);
  assert.equal(parseHidIdleSeconds('không có'), null);
});

test('userIdleSeconds: chỉ macOS; lệnh lỗi → null', () => {
  assert.equal(userIdleSeconds({ platform: 'linux', run: () => '"HIDIdleTime" = 1' }), null);
  assert.equal(userIdleSeconds({ platform: 'darwin', run: () => '"HIDIdleTime" = 2000000000' }), 2);
  assert.equal(userIdleSeconds({ platform: 'darwin', run: () => { throw new Error('x'); } }), null);
});

test('presenceDelivery: tắt / vắng / có mặt / không đọc được', () => {
  const at = (s) => ({ idleSeconds: () => s });
  assert.equal(presenceDelivery({ awayMinutes: 0 }, at(1)), 'send');
  assert.equal(presenceDelivery({ awayMinutes: 5 }, at(301)), 'send');
  assert.equal(presenceDelivery({ awayMinutes: 5 }, at(10)), 'silent');
  assert.equal(presenceDelivery({ awayMinutes: 5, whenPresent: 'skip' }, at(10)), 'skip');
  assert.equal(presenceDelivery({ awayMinutes: 5 }, at(null)), 'send');
});

test('sendAwayAware: silent → disable_notification; skip → không gửi', async () => {
  const sent = [];
  const tg = { sendMessage: async (text, extra) => sent.push({ text, extra }) };
  await sendAwayAware(tg, { awayMinutes: 5 }, 'a', { idleSeconds: () => 1 });
  await sendAwayAware(tg, { awayMinutes: 5, whenPresent: 'skip' }, 'b', { idleSeconds: () => 1 });
  await sendAwayAware(tg, { awayMinutes: 0 }, 'c', { idleSeconds: () => 1 });
  assert.deepEqual(sent, [
    { text: 'a', extra: { disable_notification: true } },
    { text: 'c', extra: {} },
  ]);
});

test('runAway: bật / --skip / off ghi đúng config và loadConfig đọc được', () => {
  const home = mkdtempSync(join(tmpdir(), 'cc-notify-away-'));
  try {
    const file = configFile(home);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ botToken: 'T', chatId: '-1' }));
    const log = () => {};
    assert.equal(runAway('5', {}, { log, home, platform: 'darwin' }), true);
    let cfg = loadConfig({ home, env: {} });
    assert.equal(cfg.awayMinutes, 5);
    assert.equal(cfg.whenPresent, 'silent');
    runAway('3', { skip: true }, { log, home, platform: 'darwin' });
    assert.equal(loadConfig({ home, env: {} }).whenPresent, 'skip');
    runAway('off', {}, { log, home, platform: 'darwin' });
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(raw.awayMinutes, undefined);
    assert.equal(raw.botToken, 'T');
    assert.equal(loadConfig({ home, env: {} }).awayMinutes, 0);
    assert.equal(runAway('abc', {}, { log, home, platform: 'darwin' }), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
