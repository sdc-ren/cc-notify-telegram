// Telegram API client (fetch built-in, timeout 30s, cho phép inject để test).
export const TELEGRAM_API_TIMEOUT_MS = 30_000;

export function makeTelegram(cfg, fetchFn = fetch) {
  const base = `https://api.telegram.org/bot${cfg.botToken}`;
  async function call(method, params, timeoutMs = TELEGRAM_API_TIMEOUT_MS) {
    let res;
    try {
      res = await fetchFn(`${base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || String(err?.message || '').includes('aborted due to timeout')) {
        throw new Error(`telegram ${method} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw err;
    }
    const data = await res.json();
    if (!data.ok) {
      const migrate = data.parameters?.migrate_to_chat_id;
      throw new Error(
        `telegram ${method} failed: ${data.description || res.status}${migrate ? ` (migrate_to_chat_id: ${migrate})` : ''}`
      );
    }
    return data.result;
  }
  return {
    sendMessage: async (text, extra = {}) => {
      const provider = extra.providerId ?? cfg.providerId;
      const threadId = extra.message_thread_id ?? cfg.providerThreads?.[provider] ?? cfg.threadId;
      const params = {
        chat_id: cfg.chatId,
        text,
        ...(cfg.silent ? { disable_notification: true } : {}),
        ...(threadId != null && threadId !== '' ? { message_thread_id: Number(threadId) } : {}),
        ...extra,
      };
      delete params.providerId;
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
