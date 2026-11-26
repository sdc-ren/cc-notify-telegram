import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectTopics, runTopics } from '../src/topics.mjs';

const msg = (threadId, text, extra = {}) => ({
  update_id: Math.random(),
  message: { chat: { id: -100 }, message_thread_id: threadId, text, ...extra },
});

test('collectTopics: gom theo topic, lấy tên topic, bỏ chat khác và tin không có topic', () => {
  const topics = collectTopics(
    [
      msg(7, 'hi bot', { reply_to_message: { forum_topic_created: { name: 'Claude' } } }),
      msg(3, 'cũ'),
      msg(3, 'mới'),
      { update_id: 9, message: { chat: { id: -999 }, message_thread_id: 5, text: 'chat khác' } },
      { update_id: 10, message: { chat: { id: -100 }, text: 'không có topic' } },
    ],
    '-100'
  );
  assert.deepEqual(topics, [
    { threadId: 3, name: '', sample: 'mới' },
    { threadId: 7, name: 'Claude', sample: 'hi bot' },
  ]);
});

test('runTopics: đọc 100 update gần nhất không xác nhận, đánh dấu topic đang dùng', async () => {
  const calls = [];
  const lines = [];
  const tg = {
    getUpdates: async (params) => {
      calls.push(params);
      return [msg(7, 'hi bot')];
    },
  };
  const ok = await runTopics({ log: (l) => lines.push(l), tg, cfg: { botToken: 'T', chatId: '-100', threadId: 7 } });
  assert.equal(ok, true);
  assert.deepEqual(calls, [{ offset: -100, timeout: 0 }]);
  assert.match(lines.join('\n'), /threadId 7 .*← đang dùng/);
});

test('runTopics: chưa thấy topic nào thì hướng dẫn mention bot', async () => {
  const lines = [];
  const tg = { getUpdates: async () => [] };
  await runTopics({ log: (l) => lines.push(l), tg, cfg: { botToken: 'T', chatId: '-100' } });
  assert.match(lines.join('\n'), /mention bot/);
});
