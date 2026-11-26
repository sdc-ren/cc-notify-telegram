// EVENT perm — Remote Permission bằng nút bấm Telegram.

import { unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { buildTag, projectName, strings } from './strings.mjs';
import { ensureStateDirs, gcStateDir, pendingKey, pendingPath, readSessionAllow, writeSessionAllow } from './state.mjs';
import { waitForReply } from './poller.mjs';
import { chunkMessage } from './ask.mjs';
import { runPlan } from './plan.mjs';

export function permOutput(behavior, { message, updatedInput, updatedPermissions } = {}) {
  const decision =
    behavior === 'deny'
      ? { behavior: 'deny', ...(message ? { message } : {}) }
      : {
          behavior: 'allow',
          ...(updatedInput ? { updatedInput } : {}),
          ...(updatedPermissions ? { updatedPermissions } : {}),
        };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
}

export const capText = (value, max) => {
  const cps = Array.from(String(value));
  return cps.length > max ? cps.slice(0, max).join('') + '…' : cps.join('');
};

// Render ĐÚNG thứ đang được xin quyền. Duyệt mù là rủi ro lớn nhất của tính năng này,
// nên nội dung gửi đi phải là nguyên văn (chỉ cap những field có thể dài vô hạn).
export function describePermission(toolName, toolInput) {
  const t = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const fenced = (value, max = 1500) => ['```', capText(value, max), '```'];
  const out = [];

  if (toolName === 'Bash' || toolName === 'PowerShell') {
    if (t.description) out.push(String(t.description));
    if (t.command) out.push(...fenced(t.command, 3000));
  } else if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    if (t.file_path) out.push(String(t.file_path));
    const body = t.new_string ?? t.content ?? t.new_source;
    if (body != null) out.push(...fenced(body));
  } else if (toolName === 'WebFetch') {
    if (t.url) out.push(String(t.url));
    if (t.prompt) out.push(capText(t.prompt, 400));
  } else if (toolName === 'WebSearch') {
    if (t.query) out.push(String(t.query));
  } else if (Object.keys(t).length) {
    try {
      out.push(...fenced(JSON.stringify(t, null, 2), 2000));
    } catch {
      out.push(...fenced(String(t)));
    }
  }
  return out.filter((line) => line !== '' && line != null).join('\n');
}

export function buildPermMessage({ toolName, toolInput, project, suffix, str }) {
  const tag = buildTag({ project, suffix });
  const detail = describePermission(toolName, toolInput);
  return [str.permHeader(tag), '', `🔧 ${toolName}`, detail || str.permNoDetail, '', str.permFooter].join('\n');
}

// --- Plan (ExitPlanMode): duyệt / góp ý qua Telegram ---

// callback_data giới hạn 64 byte của Telegram → prefix 1 ký tự + key 16 hex = 18 byte.
export function permKeyboard(key, str, ttlMin) {
  return {
    inline_keyboard: [
      [
        { text: str.btnAllow, callback_data: `a:${key}` },
        { text: str.btnDeny, callback_data: `d:${key}` },
      ],
      [
        { text: str.btnAllowSession(ttlMin), callback_data: `s:${key}` },
        { text: str.btnLocal, callback_data: `l:${key}` },
      ],
    ],
  };
}

const hhmm = (ts) => new Date(ts).toTimeString().slice(0, 5);

// Chạy `onClose` (best-effort, tối đa 4s) khi process bị tắt bằng tín hiệu rồi thoát. Trả về hàm gỡ.
export function closeOnSignal(onClose, { signals = ['SIGTERM', 'SIGINT', 'SIGHUP'], exit = (code) => process.exit(code) } = {}) {
  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    const timer = setTimeout(() => exit(0), 4000);
    Promise.resolve()
      .then(onClose)
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        exit(0);
      });
  };
  for (const s of signals) process.on(s, handler);
  return () => {
    for (const s of signals) process.off(s, handler);
  };
}

export async function promptTelegramPermission({
  payload,
  cfg,
  tg,
  env,
  home = homedir(),
  toolName,
  toolInput,
  project,
  suffix,
  kind = 'perm',
  text,
  keyboard,
}) {
  if (!cfg.remote || !cfg.remotePermission) return { type: 'remote-off' };
  if (!cfg.allowedUserIds.length) return { type: 'no-allowed-users' };
  if (!toolName || toolName === 'AskUserQuestion') return { type: 'invalid' };

  const dir = ensureStateDirs(home);
  gcStateDir(dir);

  const sessionId = payload.session_id || '';
  // Plan không bao giờ bị "cho phép tất cả" nuốt: duyệt plan luôn là quyết định riêng.
  if (kind === 'perm' && readSessionAllow(dir, sessionId)) return { type: 'session-allow', dir };

  const str = strings(cfg);
  const key = pendingKey(sessionId, [{ question: `${toolName}:${JSON.stringify(toolInput ?? null)}` }]);
  const chunks = chunkMessage(
    text ?? buildPermMessage({ toolName, toolInput, project, suffix, str })
  );

  // Bàn phím nút gắn vào tin CUỐI. Gửi thiếu dù chỉ 1 chunk là nhả về máy: duyệt khi mới
  // thấy một PHẦN của lệnh nguy hiểm hơn nhiều so với việc phải ra máy bấm.
  const messageIds = [];
  let sendFailed = false;
  for (let i = 0; i < chunks.length; i++) {
    const isAnchor = i === chunks.length - 1;
    try {
      const sent = await tg.sendMessage(
        chunks[i],
        isAnchor ? { reply_markup: keyboard || permKeyboard(key, str, cfg.sessionAllowTtlMin) } : {}
      );
      if (!sent?.message_id) throw new Error('no message_id');
      messageIds.push(sent.message_id);
    } catch {
      sendFailed = true;
      break;
    }
  }
  if (sendFailed || !messageIds.length) {
    if (messageIds.length) {
      await tg.editMessageText(messageIds[messageIds.length - 1], str.permSendFailed).catch(() => {});
    }
    return { type: 'send-failed' };
  }
  const anchorId = messageIds[messageIds.length - 1];

  writeFileSync(
    pendingPath(dir, key),
    JSON.stringify({
      kind,
      messageId: anchorId,
      messageIds,
      sessionId,
      toolName,
      sentAt: Date.now(),
    })
  );

  // Claude Code tắt hook đang chờ khi người dùng duyệt / hủy ngay tại máy → đóng tin Telegram
  // (gỡ nút) trước khi thoát, nếu không nút cứ treo và bấm vào không có phản hồi.
  const stopWatching = closeOnSignal(() => {
    try {
      unlinkSync(pendingPath(dir, key));
    } catch {
      // đã bị sweep
    }
    return tg.editMessageText(anchorId, kind === 'plan' ? str.planClosedLocal : str.permClosedLocal);
  });

  let outcome;
  try {
    outcome = await waitForReply({
      tg,
      cfg,
      dir,
      ownMessageIds: messageIds,
      deadline: Date.now() + cfg.remoteAskTimeoutSec * 1000,
      env,
      home,
      mode: 'perm',
    });
  } finally {
    stopWatching();
  }

  try {
    unlinkSync(pendingPath(dir, key));
  } catch {
    // đã bị GC/sweep
  }

  return { type: 'ok', outcome, anchorId, key, dir };
}

export async function runPerm(payload, cfg, tg, env, home = homedir()) {
  if (!cfg.remote || !cfg.remotePermission) return null;
  // FAIL-CLOSED: không khai báo ai được duyệt thì không hỏi từ xa, hộp thoại về máy.
  if (!cfg.allowedUserIds.length) return null;
  const toolName = payload.tool_name;
  if (!toolName) return null;
  // AskUserQuestion đã có Remote Ask (PreToolUse) lo — không bao giờ đưa vào luồng nút bấm.
  if (toolName === 'AskUserQuestion') return null;

  const str = strings(cfg);

  // Plan: có nội dung → gửi kèm nút Duyệt / Chưa ổn + cho reply góp ý. Không có nội dung → chỉ
  // BÁO rồi nhả về máy (không duyệt mù). Cả hai đều KHÔNG đụng session-allow.
  if (toolName === 'ExitPlanMode') return runPlan(payload, cfg, tg, env, home, str);

  const prompt = await promptTelegramPermission({
    payload,
    cfg,
    tg,
    env,
    home,
    toolName,
    toolInput: payload.tool_input,
    project: projectName(payload, env),
    suffix: String(payload.session_id || '').slice(-4),
  });
  if (prompt.type === 'session-allow') return permOutput('allow');
  if (prompt.type !== 'ok') return null;
  const { outcome, anchorId, dir } = prompt;

  if (outcome.type === 'callback' && outcome.action !== 'l') {
    const who = outcome.fromName ? ` (${outcome.fromName})` : '';
    if (outcome.action === 'd') {
      await tg.editMessageText(anchorId, str.permDenied(who)).catch(() => {});
      return permOutput('deny', { message: str.permDenyReason });
    }
    if (outcome.action === 's') {
      const until = writeSessionAllow(dir, payload.session_id, cfg.sessionAllowTtlMin);
      await tg.editMessageText(anchorId, str.permAllowedSession(who, hhmm(until))).catch(() => {});
    } else {
      await tg.editMessageText(anchorId, str.permAllowed(who)).catch(() => {});
    }
    return permOutput('allow');
  }

  // 'l' (để máy xử lý) / remote-off / timeout → im lặng ⇒ hộp thoại hiện tại máy.
  await tg
    .editMessageText(anchorId, outcome.type === 'timeout' ? str.permTimedOut : str.permMovedLocal)
    .catch(() => {});
  return null;
}
