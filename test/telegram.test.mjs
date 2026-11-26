import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONNECT_ATTEMPT_TIMEOUT_MS,
  isTokenError,
  makeTelegram,
  networkErrorDetail,
  TELEGRAM_API_TIMEOUT_MS,
} from '../hook/notify-telegram.mjs';

function fakeFetch(responses, calls) {
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
    const next = responses.shift();
    return {
      json: async () => next,
      status: next.status || 200,
    };
  };
}

test('makeTelegram.sendMessage: gửi vào topic threadId, kèm silent', async () => {
  const calls = [];
  const tg = makeTelegram(
    { botToken: 'T', chatId: '-100', threadId: 34, silent: true },
    fakeFetch([{ ok: true, result: { message_id: 1 } }], calls)
  );

  await tg.sendMessage('hello');
  assert.equal(calls[0].body.message_thread_id, 34);
  assert.equal(calls[0].body.disable_notification, true);
});

test('makeTelegram.sendMessage: explicit message_thread_id override threadId', async () => {
  const calls = [];
  const tg = makeTelegram(
    { botToken: 'T', chatId: '-100', threadId: 1 },
    fakeFetch([{ ok: true, result: { message_id: 1 } }], calls)
  );

  await tg.sendMessage('hello', { message_thread_id: 99 });
  assert.equal(calls[0].body.message_thread_id, 99);
});

test('makeTelegram.sendMessage: không có threadId thì không gửi message_thread_id', async () => {
  const calls = [];
  const tg = makeTelegram({ botToken: 'T', chatId: '-100' }, fakeFetch([{ ok: true, result: { message_id: 1 } }], calls));

  await tg.sendMessage('hello');
  assert.equal(calls[0].body.message_thread_id, undefined);
});

test('makeTelegram.sendMessage: lỗi message_thread_id thì retry không kèm topic', async () => {
  const calls = [];
  const tg = makeTelegram(
    { botToken: 'T', chatId: '-100', threadId: 34, silent: true },
    fakeFetch(
      [
        { ok: false, description: 'Bad Request: message_thread_id_invalid' },
        { ok: true, result: { message_id: 2 } },
      ],
      calls
    )
  );

  const sent = await tg.sendMessage('hello');
  assert.equal(sent.message_id, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.message_thread_id, 34);
  assert.equal(calls[1].body.message_thread_id, undefined);
  assert.equal(calls[1].body.disable_notification, true);
});

test('makeTelegram.sendMessage: lỗi không liên quan thread thì không retry', async () => {
  const calls = [];
  const tg = makeTelegram(
    { botToken: 'T', chatId: '-100', threadId: 34 },
    fakeFetch([{ ok: false, description: 'Unauthorized' }], calls)
  );

  await assert.rejects(() => tg.sendMessage('hello'), /Unauthorized/);
  assert.equal(calls.length, 1);
});

test('makeTelegram.sendMessage: dùng timeout mặc định 30s và báo lỗi timeout rõ', async () => {
  const originalTimeout = AbortSignal.timeout;
  const timeouts = [];
  AbortSignal.timeout = (ms) => {
    timeouts.push(ms);
    return originalTimeout(ms);
  };
  try {
    const tg = makeTelegram({ botToken: 'T', chatId: '-100' }, async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });

    await assert.rejects(() => tg.sendMessage('hello'), /telegram sendMessage timed out after 30s/);
    assert.deepEqual(timeouts, [TELEGRAM_API_TIMEOUT_MS]);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test('makeTelegram.sendMessage: lỗi group upgraded hiển thị migrate_to_chat_id', async () => {
  const calls = [];
  const tg = makeTelegram(
    { botToken: 'T', chatId: '-123' },
    fakeFetch(
      [
        {
          ok: false,
          description: 'Bad Request: group chat was upgraded to a supergroup chat',
          parameters: { migrate_to_chat_id: -1003760710918 },
        },
      ],
      calls
    )
  );

  await assert.rejects(() => tg.sendMessage('hello'), /migrate_to_chat_id: -1003760710918/);
});

test('makeTelegram: lỗi mạng gắn kind=network, giữ nguyên message gốc', async () => {
  const tg = makeTelegram({ botToken: 'T', chatId: '-100' }, async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
    throw err;
  });
  const err = await tg.getMe().catch((e) => e);
  assert.equal(err.kind, 'network');
  assert.equal(err.message, 'fetch failed');
  assert.equal(networkErrorDetail(err), ' (UND_ERR_CONNECT_TIMEOUT)');
  assert.equal(isTokenError(err), false);
});

test('makeTelegram: 401 từ Telegram là lỗi token', async () => {
  const calls = [];
  const tg = makeTelegram(
    { botToken: 'T', chatId: '-100' },
    fakeFetch([{ ok: false, error_code: 401, description: 'Unauthorized' }], calls)
  );
  const err = await tg.getMe().catch((e) => e);
  assert.equal(err.kind, 'api');
  assert.equal(err.status, 401);
  assert.equal(isTokenError(err), true);
  assert.match(err.message, /telegram getMe failed: Unauthorized/);
});

test('makeTelegram: lỗi API khác (400) không bị coi là lỗi token', async () => {
  const calls = [];
  const tg = makeTelegram(
    { botToken: 'T', chatId: '-100' },
    fakeFetch([{ ok: false, error_code: 400, description: 'Bad Request: chat not found' }], calls)
  );
  const err = await tg.sendMessage('x').catch((e) => e);
  assert.equal(err.kind, 'api');
  assert.equal(isTokenError(err), false);
});

test('nạp telegram.mjs nới thời gian mỗi lần thử kết nối lên 2s', async () => {
  const net = await import('node:net');
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), CONNECT_ATTEMPT_TIMEOUT_MS);
});

test('makeTelegram: lỗi lúc kết nối thì thử lại đúng 1 lần', async () => {
  let n = 0;
  const tg = makeTelegram({ botToken: 'T', chatId: '-100' }, async () => {
    n++;
    if (n === 1) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
      throw err;
    }
    return { status: 200, json: async () => ({ ok: true, result: { username: 'bot' } }) };
  });
  assert.deepEqual(await tg.getMe(), { username: 'bot' });
  assert.equal(n, 2);
});

test('makeTelegram: lỗi sau khi đã gửi request (socket đóng giữa chừng) không thử lại', async () => {
  let n = 0;
  const tg = makeTelegram({ botToken: 'T', chatId: '-100' }, async () => {
    n++;
    const err = new TypeError('fetch failed');
    err.cause = { code: 'UND_ERR_SOCKET' };
    throw err;
  });
  const err = await tg.sendMessage('x').catch((e) => e);
  assert.equal(err.kind, 'network');
  assert.equal(n, 1);
});

test('makeTelegram: hết timeout tổng thì không thử lại', async () => {
  let n = 0;
  const tg = makeTelegram({ botToken: 'T', chatId: '-100' }, async () => {
    n++;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  await assert.rejects(() => tg.getMe(), /timed out/);
  assert.equal(n, 1);
});
