// Cài/gỡ hook runtime trong ~/.claude/hooks/:
//   cc-notify-telegram.mjs   shim nhỏ — đường dẫn mà settings của các Agent trỏ tới (giữ nguyên như bản cũ)
//   cc-notify-telegram/      bản sao thư mục hook/ của gói (notify-telegram.mjs + lib/)

import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_SOURCE_DIR = fileURLToPath(new URL('../hook/', import.meta.url));
export const RUNTIME_DIR_NAME = 'cc-notify-telegram';

export const SHIM = `#!/usr/bin/env node
// Do cc-notify-telegram init sinh ra — đừng sửa tay. Runtime nằm trong ./${RUNTIME_DIR_NAME}/
import { runCli } from './${RUNTIME_DIR_NAME}/notify-telegram.mjs';

runCli();
`;

export function runtimeDir(hookFile) {
  return join(dirname(hookFile), RUNTIME_DIR_NAME);
}

// Copy lại toàn bộ (xoá bản cũ trước để không sót module đã bị bỏ), rồi ghi shim.
export function installHookRuntime(hookFile, { sourceDir = HOOK_SOURCE_DIR } = {}) {
  const dir = runtimeDir(hookFile);
  mkdirSync(dirname(hookFile), { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  cpSync(sourceDir, dir, { recursive: true });
  writeFileSync(hookFile, SHIM);
  if (process.platform !== 'win32') chmodSync(hookFile, 0o755);
  return dir;
}

export function removeHookRuntime(hookFile) {
  const removed = [];
  if (existsSync(hookFile)) {
    rmSync(hookFile, { force: true });
    removed.push(hookFile);
  }
  const dir = runtimeDir(hookFile);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

export function isHookRuntimeInstalled(hookFile) {
  return existsSync(hookFile) && existsSync(join(runtimeDir(hookFile), 'notify-telegram.mjs'));
}

// Dấu vân tay nội dung một thư mục runtime (đường dẫn tương đối + nội dung từng file .mjs).
// Không phụ thuộc số version: đổi bất kỳ dòng nào trong hook/ là khác.
export function runtimeFingerprint(dir) {
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(dir);
  const hash = createHash('sha256');
  for (const file of files.map((f) => relative(dir, f).split(sep).join('/')).sort()) {
    hash.update(file).update('\0').update(readFileSync(join(dir, file))).update('\0');
  }
  return hash.digest('hex');
}

// true khi runtime đã cài khác bản hook/ đi kèm CLI đang chạy (cần chạy lại init).
export function isHookRuntimeStale(hookFile, { sourceDir = HOOK_SOURCE_DIR } = {}) {
  return runtimeFingerprint(runtimeDir(hookFile)) !== runtimeFingerprint(sourceDir);
}
