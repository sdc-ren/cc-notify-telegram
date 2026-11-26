// Long-poll getUpdates và phân loại update cho các câu hỏi/nút đang chờ.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, POLL_LONG_SEC } from './config.mjs';
import { strings } from './strings.mjs';
import { inboxPath, listPending, readOffset, releaseLock, sleep, touchLock, tryAcquireLock, writeOffset } from './state.mjs';

export function isLocalKeyword(text) {
  return /^\s*local\s*$/i.test(text || '');
}

// Phân loại một update Telegram so với các câu hỏi đang chờ.
// ctx: { chatId, pending: [{messageId, sentAt(ms)}] }
// Group: BẮT BUỘC reply đúng tin câu hỏi. Private: 1 câu chờ thì tin trần cũng tính
// (nhưng phải MỚI hơn lúc gửi câu hỏi — chặn backlog getUpdates cũ), nhiều câu → nhắc reply.
// Một câu hỏi có thể trải trên nhiều tin (khi bị chunk) → reply vào TIN NÀO trong nhóm cũng nhận.
const idsOf = (p) => (Array.isArray(p.messageIds) && p.messageIds.length ? p.messageIds : [p.messageId]);

export function classifyUpdate(update, ctx) {
  // Bấm nút inline (Remote Permission). Callback query LUÔN tới bot bất kể privacy mode,
  // và kèm from.id không giả được → đây là kênh duy nhất kiểm tra được ai bấm.
  const cq = update?.callback_query;
  if (cq) {
    if (String(cq.message?.chat?.id) !== String(ctx.chatId)) return { kind: 'ignore' };
    const messageId = cq.message?.message_id;
    const action = String(cq.data || '').match(/^([adescl]):/)?.[1];
    if (messageId == null || !action) return { kind: 'ignore' };
    // Nút của một yêu cầu không còn chờ nữa (đã xử lý tại máy / hủy / hết hạn) → báo cho người bấm.
    if (!ctx.pending.flatMap(idsOf).includes(messageId)) {
      return { kind: 'stale-callback', messageId, callbackId: cq.id, fromId: cq.from?.id };
    }
    return {
      kind: 'callback',
      action,
      messageId,
      fromId: cq.from?.id,
      fromName: cq.from?.first_name || cq.from?.username || '',
      callbackId: cq.id,
    };
  }

  const msg = update?.message;
  if (!msg || typeof msg.text !== 'string') return { kind: 'ignore' };
  if (String(msg.chat?.id) !== String(ctx.chatId)) return { kind: 'ignore' };
  // Yêu cầu quyền CHỈ nhận qua nút bấm — text reply không bao giờ duyệt được permission,
  // nên chúng bị loại khỏi mọi phép so khớp dưới đây.
  const asks = ctx.pending.filter((p) => p.kind !== 'perm');
  const allIds = asks.flatMap(idsOf);
  const replyTo = msg.reply_to_message?.message_id;
  if (replyTo != null) {
    if (!allIds.includes(replyTo)) return { kind: 'ignore' };
    return { kind: 'reply', messageId: replyTo, text: msg.text.trim(), fromId: msg.from?.id, fromName: msg.from?.first_name || msg.from?.username || '' };
  }
  if (msg.chat?.type === 'private') {
    if (asks.length === 1) {
      const freshEnough = (msg.date || 0) * 1000 >= asks[0].sentAt - 2000;
      if (!freshEnough) return { kind: 'ignore' };
      const ids = idsOf(asks[0]);
      return {
        kind: 'reply',
        messageId: ids[ids.length - 1],
        text: msg.text.trim(),
        fromId: msg.from?.id,
        fromName: msg.from?.first_name || msg.from?.username || '',
      };
    }
    if (asks.length > 1) return { kind: 'need-reply-hint' };
  }
  return { kind: 'ignore' };
}

// --- pending/inbox/lock: phối hợp nhiều session qua filesystem ---

// Vòng chờ trả lời: poller trung tâm (giữ lock) long-poll getUpdates và phân phát
// reply/bấm nút vào inbox theo message_id; session không giữ lock chỉ watch inbox của mình.
// mode 'ask' = chờ text reply; mode 'perm' = chờ bấm nút inline.
export async function waitForReply({ tg, cfg, dir, ownMessageIds, deadline, env, home, mode = 'ask' }) {
  const lockFile = join(dir, 'poll.lock');
  let holdingLock = false;
  let lastHintAt = 0;
  try {
    while (Date.now() < deadline) {
      // Tắt cờ giữa chừng (user về máy) → nhả về UI local trong vài giây.
      // Đọc lại config MỖI vòng nên `remote off` / `remote-perm off` có hiệu lực ngay.
      const live = loadConfig({ env, home });
      if (!live.remote || (mode === 'perm' && !live.remotePermission)) return { type: 'remote-off' };

      // 1) inbox của mình có sẵn kết quả (poller khác phân phát)? — vào bất kỳ chunk nào
      for (const id of ownMessageIds) {
        const inboxFile = inboxPath(dir, id);
        if (!existsSync(inboxFile)) continue;
        let msg = null;
        try {
          msg = JSON.parse(readFileSync(inboxFile, 'utf8'));
          unlinkSync(inboxFile);
        } catch {
          // đọc dở → vòng sau
        }
        if (msg?.action) return { type: 'callback', action: msg.action, fromName: msg.fromName || '' };
        if (msg?.text != null) return { type: 'reply', text: msg.text, fromName: msg.fromName || '' };
      }

      // 2) trở thành poller trung tâm nếu chưa ai giữ lock
      if (!holdingLock) holdingLock = tryAcquireLock(lockFile);
      if (!holdingLock) {
        await sleep(700);
        continue;
      }

      touchLock(lockFile);
      let updates = [];
      try {
        // long-poll không dài quá thời gian còn lại — để timeout nhả đúng hạn
        const remainSec = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
        updates = await tg.getUpdates({ offset: readOffset(dir), timeout: Math.min(POLL_LONG_SEC, remainSec) });
      } catch {
        await sleep(2000); // mạng lỗi / 409 conflict tạm thời → thử lại
        continue;
      }
      if (updates.length) writeOffset(dir, updates.at(-1).update_id + 1);

      const pending = listPending(dir);
      for (const update of updates) {
        const verdict = classifyUpdate(update, { chatId: cfg.chatId, pending });
        if (verdict.kind === 'callback') {
          // Ai bấm cũng tới được bot → allowlist là hàng rào duy nhất. Kiểm ở đây (chứ không
          // trong classifyUpdate) để còn báo ngược cho người bấm biết vì sao không ăn.
          if (!live.allowedUserIds.includes(String(verdict.fromId))) {
            await tg
              .answerCallbackQuery(verdict.callbackId, { text: strings(cfg).permNoRight, show_alert: true })
              .catch(() => {});
            continue;
          }
          await tg.answerCallbackQuery(verdict.callbackId, {}).catch(() => {}); // tắt spinner
          if (ownMessageIds.includes(verdict.messageId)) {
            return { type: 'callback', action: verdict.action, fromName: verdict.fromName };
          }
          try {
            writeFileSync(
              inboxPath(dir, verdict.messageId),
              JSON.stringify({ action: verdict.action, fromName: verdict.fromName })
            );
          } catch {
            // session kia sẽ timeout → chấp nhận
          }
        } else if (verdict.kind === 'stale-callback') {
          // Chỉ người trong allowlist mới được "chạm" vào bot; còn lại im lặng.
          if (!live.allowedUserIds.includes(String(verdict.fromId))) continue;
          await tg
            .answerCallbackQuery(verdict.callbackId, { text: strings(cfg).staleButton, show_alert: true })
            .catch(() => {});
          await tg.clearKeyboard(verdict.messageId).catch(() => {});
        } else if (verdict.kind === 'reply') {
          // Reply vào tin PLAN là chỉ đạo thẳng cho agent → chỉ allowlist mới được góp ý.
          const target = pending.find((p) => idsOf(p).includes(verdict.messageId));
          if (target?.kind === 'plan' && !live.allowedUserIds.includes(String(verdict.fromId))) continue;
          if (ownMessageIds.includes(verdict.messageId)) {
            return { type: 'reply', text: verdict.text, fromName: verdict.fromName || '' };
          }
          try {
            writeFileSync(inboxPath(dir, verdict.messageId), JSON.stringify({ text: verdict.text, fromName: verdict.fromName || '' }));
          } catch {
            // session kia sẽ timeout → chấp nhận
          }
        } else if (verdict.kind === 'need-reply-hint' && Date.now() - lastHintAt > 60_000) {
          lastHintAt = Date.now();
          const askCount = pending.filter((p) => p.kind !== 'perm').length;
          await tg.sendMessage(strings(cfg).replyHint(askCount)).catch(() => {});
        }
      }
    }
    return { type: 'timeout' };
  } finally {
    releaseLock(lockFile, holdingLock);
  }
}
