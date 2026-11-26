import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installHookRuntime,
  isHookRuntimeInstalled,
  isHookRuntimeStale,
  removeHookRuntime,
  runtimeDir,
  runtimeFingerprint,
  SHIM,
} from '../src/hook-runtime.mjs';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'cc-notify-runtime-'));
}

test('installHookRuntime: ghi shim và copy hook/ + lib/', () => {
  const home = tempHome();
  try {
    const hookFile = join(home, '.claude', 'hooks', 'cc-notify-telegram.mjs');
    const dir = installHookRuntime(hookFile);
    assert.equal(dir, runtimeDir(hookFile));
    assert.equal(readFileSync(hookFile, 'utf8'), SHIM);
    assert.ok(existsSync(join(dir, 'notify-telegram.mjs')));
    assert.ok(readdirSync(join(dir, 'lib')).includes('config.mjs'));
    assert.ok(isHookRuntimeInstalled(hookFile));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('installHookRuntime: cài lại xoá module cũ không còn trong gói', () => {
  const home = tempHome();
  try {
    const hookFile = join(home, 'hooks', 'cc-notify-telegram.mjs');
    const stale = join(runtimeDir(hookFile), 'lib', 'removed-module.mjs');
    mkdirSync(join(runtimeDir(hookFile), 'lib'), { recursive: true });
    writeFileSync(stale, '// cũ');
    installHookRuntime(hookFile);
    assert.equal(existsSync(stale), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('shim đã cài nạp được runtime và exit 0 khi chưa có config', () => {
  const home = tempHome();
  try {
    const hookFile = join(home, '.claude', 'hooks', 'cc-notify-telegram.mjs');
    installHookRuntime(hookFile);
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) delete env[key];
    const res = spawnSync(process.execPath, [hookFile, 'stop'], { input: '{}', env, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, '');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('shim chịu được arg provider thừa (`stop claude`) của bản cài cũ', () => {
  const home = tempHome();
  try {
    const hookFile = join(home, '.claude', 'hooks', 'cc-notify-telegram.mjs');
    installHookRuntime(hookFile);
    mkdirSync(join(home, '.config', 'ai-notify-telegram'), { recursive: true });
    writeFileSync(
      join(home, '.config', 'ai-notify-telegram', 'config.json'),
      JSON.stringify({ botToken: 'T', chatId: '-1', remote: false })
    );
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'CC_NOTIFY_REMOTE']) delete env[key];
    for (const event of ['stop', 'ask', 'perm']) {
      const res = spawnSync(process.execPath, [hookFile, event, 'claude'], {
        input: JSON.stringify({ session_id: 's1', cwd: home, last_assistant_message: 'no marker' }),
        env,
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, '');
      assert.equal(res.stderr, '');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('removeHookRuntime: xoá shim lẫn thư mục runtime', () => {
  const home = tempHome();
  try {
    const hookFile = join(home, 'hooks', 'cc-notify-telegram.mjs');
    installHookRuntime(hookFile);
    const removed = removeHookRuntime(hookFile);
    assert.deepEqual(removed, [hookFile, runtimeDir(hookFile)]);
    assert.equal(existsSync(hookFile), false);
    assert.equal(existsSync(runtimeDir(hookFile)), false);
    assert.equal(isHookRuntimeInstalled(hookFile), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('isHookRuntimeStale: vừa cài thì khớp; sửa một file runtime thì báo cũ', () => {
  const home = tempHome();
  try {
    const hookFile = join(home, 'hooks', 'cc-notify-telegram.mjs');
    installHookRuntime(hookFile);
    assert.equal(isHookRuntimeStale(hookFile), false);
    const file = join(runtimeDir(hookFile), 'lib', 'config.mjs');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n// sửa\n');
    assert.equal(isHookRuntimeStale(hookFile), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('runtimeFingerprint: null khi chưa có thư mục, không phụ thuộc thứ tự đọc', () => {
  const home = tempHome();
  try {
    assert.equal(runtimeFingerprint(join(home, 'missing')), null);
    const a = join(home, 'a');
    const b = join(home, 'b');
    mkdirSync(join(a, 'lib'), { recursive: true });
    mkdirSync(join(b, 'lib'), { recursive: true });
    writeFileSync(join(a, 'x.mjs'), '1');
    writeFileSync(join(a, 'lib', 'y.mjs'), '2');
    writeFileSync(join(b, 'lib', 'y.mjs'), '2');
    writeFileSync(join(b, 'x.mjs'), '1');
    writeFileSync(join(b, 'notes.txt'), 'bỏ qua');
    assert.equal(runtimeFingerprint(a), runtimeFingerprint(b));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
