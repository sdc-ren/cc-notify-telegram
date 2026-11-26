// EVENT notify — forward Notification (vd plan chờ duyệt, xin quyền khi remote-perm tắt) khi remote bật.

import { homedir } from 'node:os';
import { buildTag, projectName, strings } from './strings.mjs';
import { sweepSessionPending } from './ask.mjs';
import { sendAwayAware } from './presence.mjs';

// Message của Notification kiểu "cần duyệt plan" (nhận diện để KHÔNG lọc nhầm khi chống trùng).
const PLAN_MESSAGE_RE = /\bplan\b/i;

// Quyết định có bỏ qua một Notification.
// - `idle_prompt` ("Claude đang chờ input"): luôn bỏ. Nó bắn sau ~60s đứng yên, kể cả khi agent
//   chỉ đang chờ việc nền chạy xong → báo thừa. Việc xong / cần người dùng đã có tin DONE/🛑.
// - Khi remote-perm bật, mọi hộp thoại xin-quyền (Bash/Edit…) đã được hook `perm` gửi kèm nút →
//   tin `permission_prompt` chỉ là bản sao nghèo hơn ⇒ bỏ. NHƯNG chừa plan: ExitPlanMode KHÔNG
//   qua hook `perm`, nên tin plan phải được giữ (2 lớp: message chứa "plan").
export function shouldSkipNotification(notificationType, message, cfg) {
  if (notificationType === 'idle_prompt') return true;
  return (
    cfg.remotePermission === true &&
    notificationType === 'permission_prompt' &&
    !PLAN_MESSAGE_RE.test(String(message || ''))
  );
}

export async function runNotify(payload, cfg, tg, env) {
  if (!cfg.remote) return;
  // Claude đang rảnh chờ người dùng (idle) thì không thể còn hộp thoại quyền/plan nào đang chờ:
  // dọn tin nút còn sót (người dùng đã hủy tại máy — hook Stop không chạy khi bấm hủy).
  // Bản thân tin idle không được chuyển lên Telegram (xem shouldSkipNotification).
  if (payload.notification_type === 'idle_prompt') {
    await sweepSessionPending(payload.session_id, cfg, tg, homedir(), { kinds: ['perm', 'plan'] }).catch(() => {});
  }
  const message = payload.message;
  if (!message || typeof message !== 'string') return;
  if (shouldSkipNotification(payload.notification_type, message, cfg)) return;
  const tag = buildTag({ project: projectName(payload, env), sessionId: payload.session_id });
  await sendAwayAware(tg, cfg, `${strings(cfg).notifyPrefix} ${tag} ${message}`);
}
