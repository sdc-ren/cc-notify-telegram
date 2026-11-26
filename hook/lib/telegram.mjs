// Telegram API client (fetch built-in, timeout 30s, cho phép inject để test).

import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

export const TELEGRAM_API_TIMEOUT_MS = 30_000;
export const CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;

// Node thử IPv6 rồi IPv4 (Happy Eyeballs), mỗi lần mặc định chỉ ~250ms. Mạng có IPv6 hỏng mà
// IPv4 chậm thì cả hai lần đều bị cắt → "fetch failed" dù curl vẫn vào được. Nới mỗi lần lên 2s.
// Chỉ ảnh hưởng tiến trình hook/CLI này.
try {
  setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
} catch {
  // Node quá cũ không có API này — giữ mặc định.
}

// Gắn loại lỗi để nơi gọi (status, init) báo đúng nguyên nhân:
//   kind 'network' — không tới được api.telegram.org (timeout, DNS, mạng/VPN/proxy)
//   kind 'api'     — Telegram trả lời ok:false (status = error_code, vd 401 token sai)
function tagError(err, kind, status) {
  err.kind = kind;
  if (status != null) err.status = status;
  return err;
}

export function networkErrorDetail(err) {
  const code = err?.cause?.code || err?.code;
  return typeof code === 'string' && !String(err?.message || '').includes(code) ? ` (${code})` : '';
}

// Lỗi xảy ra trước khi request tới được Telegram → thử lại không thể gửi trùng tin.
const CONNECT_PHASE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export function isConnectPhaseError(err) {
  if (err?.name === 'TimeoutError') return false;
  const code = err?.cause?.code || err?.code;
  if (CONNECT_PHASE_CODES.has(code)) return true;
  // Happy Eyeballs hết mọi địa chỉ: AggregateError gom lỗi từng lần thử kết nối (kể cả
  // ECONNRESET của IPv6 hỏng) — vẫn là pha kết nối. ECONNRESET đứng riêng thì không chắc nên bỏ qua.
  const nested = err?.cause?.errors;
  return err?.cause?.name === 'AggregateError' || (Array.isArray(nested) && nested.length > 0);
}

export function isTokenError(err) {
  return err?.kind === 'api' && (err.status === 401 || err.status === 404);
}

export function makeTelegram(cfg, fetchFn = fetch) {
  const base = `https://api.telegram.org/bot${cfg.botToken}`;
  async function call(method, params, timeoutMs = TELEGRAM_API_TIMEOUT_MS) {
    const request = () =>
      fetchFn(`${base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    let res;
    try {
      try {
        res = await request();
      } catch (err) {
        // Kết nối đầu tiên hay rớt khi IPv6 hỏng (xem trên) — thử lại đúng 1 lần.
        if (!isConnectPhaseError(err)) throw err;
        res = await request();
      }
    } catch (err) {
      if (err?.name === 'TimeoutError' || String(err?.message || '').includes('aborted due to timeout')) {
        throw tagError(new Error(`telegram ${method} timed out after ${Math.round(timeoutMs / 1000)}s`), 'network');
      }
      throw tagError(err, 'network');
    }
    const data = await res.json();
    if (!data.ok) {
      const migrate = data.parameters?.migrate_to_chat_id;
      throw tagError(
        new Error(
          `telegram ${method} failed: ${data.description || res.status}${migrate ? ` (migrate_to_chat_id: ${migrate})` : ''}`
        ),
        'api',
        data.error_code ?? res.status
      );
    }
    return data.result;
  }
  return {
    sendMessage: async (text, extra = {}) => {
      const threadId = extra.message_thread_id ?? cfg.threadId;
      const params = {
        chat_id: cfg.chatId,
        text,
        ...(cfg.silent ? { disable_notification: true } : {}),
        ...(threadId != null && threadId !== '' ? { message_thread_id: Number(threadId) } : {}),
        ...extra,
      };
      try {
        return await call('sendMessage', params);
      } catch (err) {
        if (String(err.message || '').includes('message_thread_id') && params.message_thread_id != null) {
          delete params.message_thread_id;
          return call('sendMessage', params);
        }
        throw err;
      }
    },
    // editMessageText KHÔNG kèm reply_markup ⇒ Telegram gỡ luôn bàn phím nút của tin đó,
    // nên tin đã chốt không thể bị bấm lại.
    editMessageText: (messageId, text) =>
      call('editMessageText', { chat_id: cfg.chatId, message_id: messageId, text }),
    // Gỡ bàn phím nút mà không đụng nội dung tin (dùng cho tin đã đóng).
    clearKeyboard: (messageId) =>
      call('editMessageReplyMarkup', { chat_id: cfg.chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    answerCallbackQuery: (callbackQueryId, extra = {}) =>
      call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...extra }),
    getUpdates: (params) =>
      call(
        'getUpdates',
        { allowed_updates: ['message', 'callback_query'], ...params },
        ((params.timeout || 0) + 10) * 1000
      ),
    getMe: () => call('getMe', {}),
  };
}
