import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hookCommand, mergeSettings, parseHookCommand } from '../src/settings.mjs';
import { nodeCheck } from '../src/status.mjs';

const LAUNCHER = fileURLToPath(new URL('../hook/node-launcher.sh', import.meta.url));
const posix = process.platform !== 'win32';

test('hookCommand / parseHookCommand: dạng launcher và dạng gọi thẳng node', () => {
  const viaLauncher = hookCommand('/n/node', '/h/cc-notify-telegram.mjs', 'stop', '/h/cc-notify-telegram/node-launcher.sh');
  assert.equal(viaLauncher, '"/bin/sh" "/h/cc-notify-telegram/node-launcher.sh" "/n/node" "/h/cc-notify-telegram.mjs" stop');
  assert.deepEqual(parseHookCommand(viaLauncher), { launcherPath: '/h/cc-notify-telegram/node-launcher.sh', nodePath: '/n/node' });
  assert.deepEqual(parseHookCommand('"/n/node" "/h/cc-notify-telegram.mjs" stop'), { launcherPath: null, nodePath: '/n/node' });
});

test('mergeSettings: có launcherPath thì mọi hook chạy qua launcher', () => {
  const s = mergeSettings({}, { nodePath: '/n/node', hookPath: '/h/cc-notify-telegram.mjs', launcherPath: '/h/l/node-launcher.sh' });
  for (const groups of Object.values(s.hooks)) {
    assert.match(groups[0].hooks[0].command, /^"\/bin\/sh" "\/h\/l\/node-launcher.sh" "\/n\/node" /);
  }
});

test('nodeCheck: báo đúng từng trường hợp', () => {
  const cmd = '"/bin/sh" "/l/node-launcher.sh" "/old/node" "/h/cc-notify-telegram.mjs" stop';
  const exists = () => true;
  assert.equal(nodeCheck(cmd, { exists, whichNode: () => '/old/node' }).ok, true);
  const moved = nodeCheck(cmd, { exists, whichNode: () => '/new/node' });
  assert.equal(moved.ok, true);
  assert.match(moved.label, /không còn — hook đang dùng \/new\/node/);
  assert.equal(nodeCheck(cmd, { exists, whichNode: () => null }).ok, false);
  assert.equal(nodeCheck(cmd, { exists: () => false }).ok, false);
  // command kiểu cũ (gọi thẳng node)
  assert.equal(nodeCheck('"/gone/node" "/h/cc-notify-telegram.mjs" stop', { exists: () => false }).ok, false);
});

// Node giả: `-e` (kiểm version) luôn đạt; chạy thật thì in ra tên mình + đối số.
function fakeNode(dir, name = 'node') {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\necho "${name} $*"\n`);
  chmodSync(file, 0o755);
  return file;
}

const runLauncher = (args, env) =>
  execFileSync('/bin/sh', [LAUNCHER, ...args], { encoding: 'utf8', env: { HOME: env.HOME, PATH: env.PATH } }).trim();

test('launcher: Node lúc cài còn → dùng nó, chuyển nguyên đối số', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-'));
  const recorded = fakeNode(dir, 'recorded-node');
  assert.equal(runLauncher([recorded, '/h/hook.mjs', 'stop'], { HOME: dir, PATH: '/usr/bin:/bin' }), 'recorded-node /h/hook.mjs stop');
  assert.equal(runLauncher(['--which', recorded], { HOME: dir, PATH: '/usr/bin:/bin' }), recorded);
});

test('launcher: Node lúc cài đã mất → tìm Node khác (PATH, rồi nvm mới nhất)', { skip: !posix }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-'));
  const binDir = mkdtempSync(join(tmpdir(), 'launcher-bin-'));
  const onPath = fakeNode(binDir);
  assert.equal(runLauncher(['--which', join(dir, 'gone/node')], { HOME: dir, PATH: `${binDir}:/usr/bin:/bin` }), onPath);
  assert.equal(runLauncher([join(dir, 'gone/node'), '/h/hook.mjs', 'ask'], { HOME: dir, PATH: `${binDir}:/usr/bin:/bin` }), 'node /h/hook.mjs ask');
});
