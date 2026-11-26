// State trên đĩa: pending/inbox, lock poller, offset getUpdates, session-allow, dọn rác.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCK_STALE_MS, MAX_SESSION_ALLOW_MIN, PENDING_TTL_MS, stateDir } from './config.mjs';

export function pendingKey(sessionId, questions) {
  const texts = (questions || []).map((q) => q?.question || '');
  return createHash('sha1')
    .update(`${sessionId || ''}\n${JSON.stringify(texts)}`)
    .digest('hex')
    .slice(0, 16);
}

const STATE_SUBDIRS = ['pending', 'inbox', 'session-allow'];

export function ensureStateDirs(home) {
  const dir = stateDir(home);
  for (const sub of STATE_SUBDIRS) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

export function pendingPath(dir, key) {
  return join(dir, 'pending', `${key}.json`);
}

export function inboxPath(dir, messageId) {
  return join(dir, 'inbox', `${messageId}.json`);
}

export function listPending(dir) {
  const out = [];
  let files = [];
  try {
    files = readdirSync(join(dir, 'pending'));
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push({ file: join(dir, 'pending', f), ...JSON.parse(readFileSync(join(dir, 'pending', f), 'utf8')) });
    } catch {
      // file dở dang → bỏ qua vòng này
    }
  }
  return out;
}

export function tryAcquireLock(lockFile) {
  try {
    writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      const age = Date.now() - statSync(lockFile).mtimeMs;
      if (age > LOCK_STALE_MS) {
        unlinkSync(lockFile);
        writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
        return true;
      }
    } catch {
      // race với process khác → thua, thử lại vòng sau
    }
    return false;
  }
}

export function touchLock(lockFile) {
  try {
    const now = new Date();
    utimesSync(lockFile, now, now);
  } catch {
    // mất lock file → vòng sau acquire lại
  }
}

export function releaseLock(lockFile, held) {
  if (!held) return;
  try {
    unlinkSync(lockFile);
  } catch {
    // đã bị takeover — không sao
  }
}

export function readOffset(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'offset.json'), 'utf8')).offset || 0;
  } catch {
    return 0;
  }
}

export function writeOffset(dir, offset) {
  try {
    writeFileSync(join(dir, 'offset.json'), JSON.stringify({ offset }));
  } catch {
    // mất offset chỉ tốn thêm 1 lần đọc lại backlog
  }
}

// Dọn file pending/inbox/session-allow quá hạn (session chết không kịp dọn).
export function gcStateDir(dir, now = Date.now()) {
  for (const sub of STATE_SUBDIRS) {
    let files = [];
    try {
      files = readdirSync(join(dir, sub));
    } catch {
      continue;
    }
    for (const f of files) {
      const p = join(dir, sub, f);
      try {
        if (now - statSync(p).mtimeMs > PENDING_TTL_MS) unlinkSync(p);
      } catch {
        // đã bị xoá bởi process khác
      }
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sessionAllowPath(dir, sessionId) {
  const safe = createHash('sha1').update(String(sessionId || '')).digest('hex').slice(0, 16);
  return join(dir, 'session-allow', `${safe}.json`);
}

// "Cho phép tất cả trong session này" — CÓ HẠN (trần MAX_SESSION_ALLOW_MIN), không bao giờ
// ghi permission rule ra settings.json: hết hạn là tự hỏi lại.
export function writeSessionAllow(dir, sessionId, ttlMin, now = Date.now()) {
  const expiresAt = now + Math.max(1, Number(ttlMin) || 30) * 60_000;
  writeFileSync(sessionAllowPath(dir, sessionId), JSON.stringify({ sessionId, expiresAt }));
  return expiresAt;
}

export function readSessionAllow(dir, sessionId, now = Date.now()) {
  try {
    const { expiresAt } = JSON.parse(readFileSync(sessionAllowPath(dir, sessionId), 'utf8'));
    return expiresAt > now ? expiresAt : 0;
  } catch {
    return 0;
  }
}
