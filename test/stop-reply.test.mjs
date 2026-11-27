import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyUpdate, isUserAway, lastWrapUp, loadConfig, runStop, stopKeyboard, strings } from '../hook/notify-telegram.mjs';

const line = (obj) => JSON.stringify(obj);
const userPrompt = (text) => line({ type: 'user', message: { content: text } });
const wrapUp = (input, extra = {}) =>
  line({ type: 'assistant', ...extra, message: { content: [{ type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input }] } });

test('lastWrapUp: lấy hộp bước tiếp theo của lượt hiện tại', () => {
  const lines = [
    userPrompt('làm đi'),
    wrapUp({ recap: 'Đã soạn xong.', ask: 'Đăng comment?', actions: [{ label: 'Đăng như vậy' }, { label: 'Cần sửa' }, { action: 'commit' }] }),
  ];
  assert.deepEqual(lastWrapUp(lines), {
    recap: 'Đã soạn xong.',
    ask: 'Đăng comment?',
    choices: ['Đăng như vậy', 'Cần sửa', 'commit'],
  });
});

test('lastWrapUp: bỏ wrap_up của lượt trước và của subagent', () => {
  assert.equal(lastWrapUp([wrapUp({ recap: 'cũ', actions: [{ label: 'A' }] }), userPrompt('tiếp')]), null);
  assert.equal(lastWrapUp([userPrompt('x'), wrapUp({ recap: 'sub' }, { isSidechain: true })]), null);
  assert.equal(lastWrapUp([]), null);
});

test('stopKeyboard: mỗi lựa chọn một hàng + nút để máy', () => {
  const kb = stopKeyboard('k1', ['A', 'B'], strings({ lang: 'vi' }));
  assert.deepEqual(kb.inline_keyboard.flat().map((b) => b.callback_data), ['0:k1', '1:k1', 'l:k1']);
});

test('classifyUpdate: nút lựa chọn dạng chữ số', () => {
  const ctx = { chatId: 7, pending: [{ messageId: 101, kind: 'stop', sentAt: Date.now() }] };
  const v = classifyUpdate(
    { callback_query: { id: 'c', data: '1:k', from: { id: 111 }, message: { chat: { id: 7 }, message_id: 101 } } },
    ctx
  );
  assert.equal(v.kind, 'callback');
  assert.equal(v.action, '1');
});

test('isUserAway: chỉ true khi away bật và đo được đã rời máy đủ lâu', () => {
  assert.equal(isUserAway({ awayMinutes: 0 }, { idleSeconds: () => 9999 }), false);
  assert.equal(isUserAway({ awayMinutes: 5 }, { idleSeconds: () => null }), false);
  assert.equal(isUserAway({ awayMinutes: 5 }, { idleSeconds: () => 60 }), false);
  assert.equal(isUserAway({ awayMinutes: 5 }, { idleSeconds: () => 301 }), true);
});

// --- runStop end-to-end với Telegram giả ---

const ESCALATE = 'Soạn xong.\n🛑 Chờ anh duyệt comment.\n<!-- CC_NOTIFY_ESCALATE -->';

function stopHarness({ idle = 600, last = ESCALATE, cfgExtra = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'stop-'));
  mkdirSync(join(home, '.config', 'ai-notify-telegram'), { recursive: true });
  writeFileSync(
    join(home, '.config', 'ai-notify-telegram', 'config.json'),
    JSON.stringify({ botToken: 't', chatId: '7', allowedUserIds: ['111'], remote: true, awayMinutes: 5, remoteAskTimeoutSec: 3, ...cfgExtra })
  );
  const transcript = join(home, 't.jsonl');
  writeFileSync(
    transcript,
    [userPrompt('đăng comment'), wrapUp({ recap: 'Đã soạn.', ask: 'Đăng?', actions: [{ label: 'Đăng như vậy' }, { label: 'Cần sửa' }] })].join('\n')
  );
  const cfg = loadConfig({ env: {}, home });
  const sent = [];
  const edits = [];
  const idleRef = { value: idle };
  const tg = {
    sendMessage: async (text, opts) => {
      sent.push({ text, opts });
      return { message_id: 100 + sent.length };
    },
    editMessageText: async (id, text) => edits.push({ id, text }),
    answerCallbackQuery: async () => {},
    getUpdates: async () => [],
  };
  const payload = { session_id: 'sess-abcd', cwd: '/x/proj', transcript_path: transcript, last_assistant_message: last };
  const run = () => runStop(payload, cfg, tg, {}, { home, deps: { idleSeconds: () => idleRef.value } });
  return { cfg, tg, sent, edits, idleRef, run, payloadTranscript: transcript };
}

const cb = (data, fromId = 111) => ({
  update_id: 1,
  callback_query: { id: 'c1', data, from: { id: fromId, first_name: 'Sơn' }, message: { chat: { id: 7 }, message_id: 101 } },
});
const keyOf = (h) => h.sent[0].opts.reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];

test('runStop: vắng máy + bấm nút → block kèm lựa chọn cho Claude làm tiếp', async () => {
  const h = stopHarness();
  h.tg.getUpdates = async () => [cb(`0:${keyOf(h)}`)];
  const out = JSON.parse(await h.run());
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /"Đăng như vậy"/);
  assert.match(h.sent[0].text, /🛑 Chờ anh duyệt comment\./);
  assert.match(h.sent[0].text, /❓ Đăng\?/);
  assert.match(h.edits.at(-1).text, /Đã gửi cho Claude \(Sơn\): "Đăng như vậy"/);
});

test('runStop: reply tự do của người trong allowlist → block kèm nguyên văn', async () => {
  const h = stopHarness();
  h.tg.getUpdates = async () => [
    {
      update_id: 1,
      message: {
        chat: { id: 7, type: 'supergroup' },
        text: 'sửa câu đầu rồi đăng',
        date: Math.floor(Date.now() / 1000),
        from: { id: 111, first_name: 'Sơn' },
        reply_to_message: { message_id: 101 },
      },
    },
  ];
  const out = JSON.parse(await h.run());
  assert.match(out.reason, /"sửa câu đầu rồi đăng"/);
});

test('runStop: người ngoài allowlist bấm nút → không ăn, hết giờ thì nhả về máy', async () => {
  const h = stopHarness();
  let calls = 0;
  h.tg.getUpdates = async () => (calls++ === 0 ? [cb(`0:${keyOf(h)}`, 999)] : []);
  assert.equal(await h.run(), null);
  assert.match(h.edits.at(-1).text, /Hết giờ chờ/);
});

test('runStop: người dùng về lại máy giữa chừng → nhả lượt', async () => {
  const h = stopHarness();
  h.tg.getUpdates = async () => {
    h.idleRef.value = 2;
    return [];
  };
  assert.equal(await h.run(), null);
  assert.match(h.edits.at(-1).text, /trả lời tại máy/);
});

test('runStop: đang ở máy → chỉ gửi tin 🛑 như cũ, không nút, không chờ', async () => {
  const h = stopHarness({ idle: 10 });
  assert.equal(await h.run(), null);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].opts?.reply_markup, undefined);
});

test('runStop: tin DONE không bao giờ chờ', async () => {
  const h = stopHarness({ last: 'xong\n<!-- CC_NOTIFY_DONE: a | b -->' });
  assert.equal(await h.run(), null);
  assert.equal(h.sent[0].opts?.reply_markup, undefined);
});

// --- ✅ khi lượt vừa giao việc chạy nền ---

const toolUse = (name, input, id = 'tu1') => line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, text) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

test('startedBackgroundWork: Workflow / Agent chạy nền trong lượt này', async () => {
  const { startedBackgroundWork } = await import('../hook/notify-telegram.mjs');
  assert.equal(startedBackgroundWork([userPrompt('build'), toolUse('Workflow', {}), toolResult('tu1', 'Workflow launched in background. Task ID: x')]), true);
  assert.equal(startedBackgroundWork([userPrompt('x'), toolUse('Agent', { run_in_background: true })]), true);
  assert.equal(startedBackgroundWork([userPrompt('x'), toolUse('Agent', {}), toolResult('tu1', 'Async agent launched and running in the background')]), true);
  // Agent chạy xong ngay trong lượt, Bash chạy nền (dev server) → không tính
  assert.equal(startedBackgroundWork([userPrompt('x'), toolUse('Agent', {}), toolResult('tu1', 'Found 3 files')]), false);
  assert.equal(startedBackgroundWork([userPrompt('x'), toolUse('Bash', { command: 'npm run dev', run_in_background: true })]), false);
  // Việc nền xong → Claude được gọi lại bằng <task-notification> = lượt mới
  assert.equal(startedBackgroundWork([userPrompt('x'), toolUse('Workflow', {}), userPrompt('<task-notification>done</task-notification>')]), false);
});

test('runStop: ✅ trong lượt vừa chạy Workflow nền → không gửi; 🛑 vẫn gửi', async () => {
  const done = stopHarness({ idle: 10, last: 'đang chạy\n<!-- CC_NOTIFY_DONE: không — run đang chạy nền, chưa xong -->' });
  const transcript = done.payloadTranscript;
  writeFileSync(transcript, [userPrompt('build'), toolUse('Workflow', {})].join('\n'));
  assert.equal(await done.run(), null);
  assert.equal(done.sent.length, 0);

  const esc = stopHarness({ idle: 10 });
  writeFileSync(esc.payloadTranscript, [userPrompt('build'), toolUse('Workflow', {})].join('\n'));
  await esc.run();
  assert.equal(esc.sent.length, 1);
});
