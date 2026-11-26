import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isSwitchOn, loadConfig } from '../hook/notify-telegram.mjs';
import { configPath, readConfig, writeConfig } from '../src/config.mjs';
import { runRemote } from '../src/remote.mjs';
import { parseArgs } from '../bin/cli.mjs';

function writeRaw(home, data) {
  mkdirSync(join(home, '.config', 'ai-notify-telegram'), { recursive: true });
  writeFileSync(configPath(home), JSON.stringify(data));
}

function fakeFetch(calls, { failFirst = false } = {}) {
  return async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (failFirst && calls.length === 1) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
      throw err;
    }
    return { json: async () => ({ ok: true, result: { message_id: calls.length } }) };
  };
}

async function withFetch(fetchImpl, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('isSwitchOn: boolean, và object cũ = global bật VÀ claude không bị tắt tường minh', () => {
  assert.equal(isSwitchOn(true), true);
  assert.equal(isSwitchOn(false), false);
  assert.equal(isSwitchOn(undefined), false);
  assert.equal(isSwitchOn({ global: true, providers: { claude: true } }), true);
  assert.equal(isSwitchOn({ global: true, providers: { codex: true } }), true);
  assert.equal(isSwitchOn({ global: true }), true);
  assert.equal(isSwitchOn({ global: true, providers: { claude: false, codex: true } }), false);
  assert.equal(isSwitchOn({ global: false, providers: { claude: true } }), false);
});

test('loadConfig: file ở đường dẫn legacy với remote boolean vẫn đọc được', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-legacy-cfg-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'cc-notify-telegram.json'),
    JSON.stringify({ botToken: 'T', chatId: '-1', remote: true, remotePermission: true })
  );

  const cfg = loadConfig({ env: {}, home });
  assert.equal(cfg.botToken, 'T');
  assert.equal(cfg.remote, true);
  assert.equal(cfg.remotePermission, true);
  assert.equal(readConfig(home).remote, true);
});

test('loadConfig: config dạng object cũ (multi-provider) ra đúng công tắc cho Claude', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-obj-cfg-'));
  writeRaw(home, {
    botToken: 'T',
    chatId: '-1',
    enabledProviders: ['claude', 'codex'],
    remote: { global: true, providers: { claude: true, codex: false, antigravity: false } },
    remotePermission: { global: true, providers: { claude: false, codex: true } },
  });

  const cfg = loadConfig({ env: {}, home });
  assert.equal(cfg.remote, true);
  assert.equal(cfg.remotePermission, false);
  assert.equal(loadConfig({ env: { CC_NOTIFY_REMOTE_PERM: '1' }, home }).remotePermission, true);
});

test('loadConfig: providerThreads.claude được dùng làm topic, ưu tiên hơn threadId', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-thread-cfg-'));
  writeRaw(home, { botToken: 'T', chatId: '-1', threadId: 3, providerThreads: { claude: 5, codex: 6 } });
  assert.equal(loadConfig({ env: {}, home }).threadId, 5);

  writeRaw(home, { botToken: 'T', chatId: '-1', threadId: 3, providerThreads: { codex: 6 } });
  assert.equal(loadConfig({ env: {}, home }).threadId, 3);
  assert.equal(loadConfig({ env: { TELEGRAM_THREAD_ID: '9' }, home }).threadId, '9');
});

test('readConfig/writeConfig: chuyển config cũ sang dạng boolean + threadId, bỏ key multi-provider', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-migrate-cfg-'));
  writeRaw(home, {
    botToken: 'T',
    chatId: '-1',
    lang: 'en',
    allowedUserIds: ['1'],
    providerThreads: { claude: 5, codex: 6 },
    enabledProviders: ['claude', 'codex'],
    remote: { global: true, providers: { claude: true } },
    remotePermission: { global: false, providers: { claude: true } },
  });

  writeConfig(readConfig(home), home);
  assert.deepEqual(JSON.parse(readFileSync(configPath(home), 'utf8')), {
    botToken: 'T',
    chatId: '-1',
    lang: 'en',
    allowedUserIds: ['1'],
    threadId: 5,
    remote: true,
    remotePermission: false,
  });
});

test('runRemote: on/off ghi boolean, đổi luôn config object cũ', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-toggle-'));
  writeRaw(home, { remote: { global: false, providers: { claude: true } }, remotePermission: false });
  const logs = [];

  assert.equal(await runRemote('on', { home, log: (line) => logs.push(line) }), true);
  let raw = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.equal(raw.remote, true);
  assert.equal(loadConfig({ env: {}, home }).remote, true);

  assert.equal(await runRemote('off', { home, log: () => {} }), true);
  raw = JSON.parse(readFileSync(configPath(home), 'utf8'));
  assert.equal(raw.remote, false);
  assert.equal(loadConfig({ env: {}, home }).remote, false);
});

test('runRemote: mode sai → in cách dùng, không ghi gì', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-bad-mode-'));
  writeConfig({ remote: false }, home);
  const logs = [];

  assert.equal(await runRemote('claude', { home, log: (line) => logs.push(line) }), false);
  assert.match(logs.join('\n'), /remote on\|off/);
  assert.equal(readConfig(home).remote, false);
});

test('runRemote remote-perm: cảnh báo khi thiếu allowedUserIds hoặc Remote Ask đang tắt', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-perm-warn-'));
  writeConfig({ remote: false, remotePermission: false }, home);
  const logs = [];

  assert.equal(await runRemote('on', { home, log: (line) => logs.push(line), key: 'remotePermission' }), true);
  assert.equal(readConfig(home).remotePermission, true);
  assert.match(logs.join('\n'), /allowedUserIds/);
  assert.match(logs.join('\n'), /Remote Ask đang TẮT/);
});

test('runRemote: gửi một tin báo trạng thái vào topic của config', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-topic-route-'));
  writeRaw(home, { botToken: 'T', chatId: '-100', providerThreads: { claude: 5, codex: 6 }, remote: false });
  const calls = [];

  await withFetch(fakeFetch(calls), async () => {
    assert.equal(await runRemote('on', { home, log: () => {}, cwd: '/repo/app' }), true);
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].message_thread_id, 5);
  assert.equal(calls[0].text, '📱 Remote Ask BẬT (từ app)');
});

test('runRemote: retry lỗi fetch failed tạm thời khi gửi tin báo trạng thái', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-topic-route-retry-'));
  writeConfig({ botToken: 'T', chatId: '-100', threadId: 5, remote: false }, home);
  const calls = [];

  await withFetch(fakeFetch(calls, { failFirst: true }), async () => {
    assert.equal(await runRemote('on', { home, log: () => {}, cwd: '/repo/app' }), true);
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((body) => body.message_thread_id), [5, 5]);
});

test('parseArgs: --providers cũ vẫn ăn giá trị (bị bỏ qua) để không lẫn vào positional', () => {
  const flags = parseArgs(['init', '--providers', 'claude,codex', '--yes']);
  assert.deepEqual(flags._, ['init']);
  assert.equal(flags.yes, true);
});
