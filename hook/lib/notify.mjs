// EVENT notify — forward Notification (permission / idle) khi remote bật.

import { homedir } from 'node:os';
import { buildTag, projectName, strings } from './strings.mjs';
import { fallbackBody } from './stop.mjs';
import { sweepSessionPending } from './ask.mjs';

// Message của Notification kiểu "cần duyệt plan" (nhận diện để KHÔNG lọc nhầm khi chống trùng).
const PLAN_MESSAGE_RE = /\bplan\b/i;

// Quyết định có bỏ qua một Notification để tránh TRÙNG với tin do PermissionRequest hook gửi.
// Khi remote-perm bật, mọi hộp thoại xin-quyền (Bash/Edit…) đã được hook `perm` gửi kèm nút →
// tin `permission_prompt` của Notification chỉ là bản sao nghèo hơn ⇒ bỏ. NHƯNG chừa plan:
// ExitPlanMode KHÔNG qua hook `perm`, nên tin plan phải được giữ (2 lớp: message chứa "plan").
export function shouldSkipNotification(notificationType, message, cfg) {
  return (
    cfg.remotePermission === true &&
    notificationType === 'permission_prompt' &&
    !PLAN_MESSAGE_RE.test(String(message || ''))
  );
}

export async function runNotify(payload, cfg, tg, env) {
  if (!cfg.remote) return;
  if (cfg.providerId === 'codex' && payload.type === 'agent-turn-complete') {
    const project = projectName(payload, env);
    const tag = buildTag({ providerId: cfg.providerId, project, sessionId: payload.session_id });
    const body =
      fallbackBody(payload.last_assistant_message || '') ||
      (Array.isArray(payload.input_messages) && payload.input_messages.length
        ? `"${payload.input_messages.join(' ').slice(0, 120)}"\n${strings(cfg).doneFallback}`
        : strings(cfg).donePlain);
    await tg.sendMessage(`✅ ${tag}\n${body}`, { providerId: cfg.providerId });
    return;
  }
  // Claude đang rảnh chờ người dùng (idle) thì không thể còn hộp thoại quyền/plan nào đang chờ:
  // dọn tin nút còn sót (người dùng đã hủy tại máy — hook Stop không chạy khi bấm hủy).
  if (payload.notification_type === 'idle_prompt') {
    await sweepSessionPending(payload.session_id, cfg, tg, homedir(), { kinds: ['perm', 'plan'] }).catch(() => {});
  }
  const message = payload.message;
  if (!message || typeof message !== 'string') return;
  if (shouldSkipNotification(payload.notification_type, message, cfg)) return;
  const tag = buildTag({
    providerId: cfg.providerId,
    project: projectName(payload, env),
    sessionId: payload.session_id,
  });
  await tg.sendMessage(`${strings(cfg).notifyPrefix} ${tag} ${message}`, { providerId: cfg.providerId });
}
