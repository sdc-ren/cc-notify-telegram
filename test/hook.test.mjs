import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildAskMessage,
  buildDenyReason,
  buildPermMessage,
  buildPlanMessage,
  buildPlanNotice,
  buildStopMessage,
  chunkMessage,
  classifyUpdate,
  closeOnSignal,
  buildPlanQuestionsMessage,
  condensePlan,
  extractOpenQuestions,
  denyOutput,
  describePermission,
  extractDoneSummary,
  extractLocalAnswers,
  fallbackBody,
  firstUserSnippet,
  gcStateDir,
  isLocalKeyword,
  lastAssistantText,
  loadConfig,
  pendingKey,
  permKeyboard,
  planApproveOutput,
  runPlan,
  planKeyboard,
  planTextOf,
  permOutput,
  readSessionAllow,
  resolveAnswerTokens,
  shouldSkipNotification,
  strings,
  summaryToBullets,
  tryAcquireLock,
  writeSessionAllow,
} from '../hook/notify-telegram.mjs';

const str = strings({ lang: 'vi' });

const jsonl = (...entries) => entries.map((e) => JSON.stringify(e));

const assistantLine = (text, extra = {}) => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
  ...extra,
});

// ---------------------------------------------------------------------------
// event stop — parse transcript
// ---------------------------------------------------------------------------

test('lastAssistantText: lấy text block CUỐI, bỏ sidechain', () => {
  const lines = jsonl(
    { type: 'user', message: { content: 'hi' } },
    assistantLine('tin subagent', { isSidechain: true }),
    assistantLine('tin đầu'),
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use' }, { type: 'text', text: 'tin cuối' }] },
    }
  );
  assert.equal(lastAssistantText(lines), 'tin cuối');
});

test('lastAssistantText: transcript rỗng/hỏng → chuỗi rỗng', () => {
  assert.equal(lastAssistantText([]), '');
  assert.equal(lastAssistantText(['not-json', '{"type":"user"}']), '');
});

test('firstUserSnippet: lấy yêu cầu ĐẦU, làm sạch tag, cắt 60 codepoint', () => {
  const long = 'â'.repeat(70); // ký tự ngoài ASCII — cắt phải theo codepoint
  const lines = jsonl(
    { type: 'user', isMeta: true, message: { content: 'meta bỏ qua' } },
    { type: 'user', message: { content: `<system-reminder>noise</system-reminder> <b>${long}</b>` } },
    { type: 'user', message: { content: 'yêu cầu sau' } }
  );
  const snippet = firstUserSnippet(lines);
  assert.equal(snippet, 'â'.repeat(60) + '…');
});

test('firstUserSnippet: content dạng array block', () => {
  const lines = jsonl({
    type: 'user',
    message: { content: [{ type: 'text', text: 'sửa  bug' }, { type: 'image' }] },
  });
  assert.equal(firstUserSnippet(lines), 'sửa bug');
});

test('extractDoneSummary + summaryToBullets', () => {
  const text = 'Xong việc!\n<!-- CC_NOTIFY_DONE: Sửa hook | merged #65 -->';
  assert.equal(extractDoneSummary(text), 'Sửa hook | merged #65');
  assert.equal(summaryToBullets('Sửa hook | merged #65'), '• Sửa hook\n• merged #65');
  assert.equal(extractDoneSummary('không có marker'), '');
});

test('fallbackBody: gỡ dòng marker + comment, trim dòng trống, cap 3800 codepoint', () => {
  const text = ['', 'Kết quả tốt <!-- note -->', '', '<!-- CC_NOTIFY_DONE -->', 'dòng cuối', ''].join('\n');
  assert.equal(fallbackBody(text), 'Kết quả tốt \n\ndòng cuối');
  const huge = 'ê'.repeat(3900);
  assert.equal(Array.from(fallbackBody(huge)).length, 3801); // 3800 + '…'
});

test('buildStopMessage: done có tóm tắt trong marker', () => {
  const msg = buildStopMessage({
    last: 'OK\n<!-- CC_NOTIFY_DONE: việc 1 | việc 2 -->',
    project: 'packflow',
    snippet: '',
    str,
  });
  assert.equal(msg, '✅ packflow\n• việc 1\n• việc 2');
});

test('buildStopMessage: escalate ưu tiên trước done, suffix generic', () => {
  const msg = buildStopMessage({
    last: '🛑 Cần bạn merge PR\n<!-- CC_NOTIFY_ESCALATE -->\n<!-- CC_NOTIFY_DONE: x -->',
    project: 'packflow',
    snippet: '',
    str,
  });
  assert.equal(msg, '🛑 Cần bạn merge PR\n— packflow: mở Claude Code xem chi tiết');
});

test('buildStopMessage: chuỗi fallback — body → snippet → plain', () => {
  const viaBody = buildStopMessage({
    last: 'Đã xong hết.\n<!-- CC_NOTIFY_DONE -->',
    project: 'p',
    snippet: 'yêu cầu',
    str,
  });
  assert.equal(viaBody, '✅ p\nĐã xong hết.');

  const viaSnippet = buildStopMessage({
    last: '<!-- CC_NOTIFY_DONE -->',
    project: 'p',
    snippet: 'yêu cầu',
    str,
  });
  assert.equal(viaSnippet, '✅ p · "yêu cầu"\n— đã hoàn thành công việc');

  const plain = buildStopMessage({ last: '<!-- CC_NOTIFY_DONE -->', project: 'p', snippet: '', str });
  assert.equal(plain, '✅ p — đã hoàn thành công việc');

  assert.equal(buildStopMessage({ last: 'không marker', project: 'p', snippet: '', str }), null);
});

// ---------------------------------------------------------------------------
// event ask — format câu hỏi + phân loại reply
// ---------------------------------------------------------------------------

const QUESTIONS = [
  {
    question: 'Chọn database?',
    multiSelect: false,
    options: [{ label: 'Postgres', description: 'quen thuộc' }, { label: 'SQLite' }],
  },
  {
    question: 'Deploy đâu?',
    multiSelect: true,
    options: [{ label: 'VPS' }, { label: 'Docker' }],
  },
];

test('buildAskMessage: tag session, đánh số câu/option, ghi chú multiSelect, footer', () => {
  const msg = buildAskMessage(QUESTIONS, { project: 'packflow', suffix: 'a1b2', str });
  assert.match(msg, /^❓ \[packflow · a1b2\] Claude đang hỏi:/);
  assert.match(msg, /1\. Chọn database\?\n   A\. Postgres — quen thuộc\n   B\. SQLite/);
  assert.match(msg, /2\. Deploy đâu\? \(chọn được nhiều\)/);
  assert.match(msg, /Reply "local"/);
});

test('buildAskMessage: GIỮ NGUYÊN mô tả dài, KHÔNG cắt (regression: bug cắt 80cp)', () => {
  const longDesc = 'Đây là mô tả rất chi tiết cần đọc đầy đủ. '.repeat(10); // ~420 codepoint
  const msg = buildAskMessage(
    [{ question: 'Q?', options: [{ label: 'X', description: longDesc }] }],
    { project: 'p', suffix: '', str }
  );
  assert.ok(msg.includes(longDesc), 'phải chứa full mô tả');
  assert.ok(!msg.includes('…'), 'không được có dấu cắt …');
});

test('chunkMessage: gộp theo dòng, mỗi chunk ≤ limit, ghép lại nguyên văn', () => {
  const text = Array.from({ length: 40 }, (_, i) => `dòng ${i} ${'x'.repeat(40)}`).join('\n');
  const chunks = chunkMessage(text, 300);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(Array.from(c).length <= 300);
  assert.equal(chunks.join('\n'), text);
});

test('chunkMessage: hard-split dòng đơn siêu dài (không mất ký tự)', () => {
  const huge = 'a'.repeat(1000);
  const chunks = chunkMessage(huge, 400);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(Array.from(c).length <= 400);
  assert.equal(chunks.join(''), huge);
});

test('chunkMessage: text ngắn → đúng 1 chunk', () => {
  assert.deepEqual(chunkMessage('ngắn gọn', 4000), ['ngắn gọn']);
});

test('classifyUpdate: group phải reply đúng tin câu hỏi', () => {
  const pending = [{ messageId: 10, sentAt: Date.now() }];
  const base = { chat: { id: -100, type: 'supergroup' }, text: '1A', date: Math.floor(Date.now() / 1000) };
  const ctx = { chatId: -100, pending };

  assert.equal(classifyUpdate({ message: { ...base, reply_to_message: { message_id: 10 } } }, ctx).kind, 'reply');
  assert.equal(classifyUpdate({ message: { ...base, reply_to_message: { message_id: 99 } } }, ctx).kind, 'ignore');
  assert.equal(classifyUpdate({ message: base }, ctx).kind, 'ignore'); // tin trần trong group
  assert.equal(
    classifyUpdate({ message: { ...base, chat: { id: -200, type: 'supergroup' }, reply_to_message: { message_id: 10 } } }, ctx).kind,
    'ignore' // sai chat
  );
});

test('classifyUpdate: private — 1 câu chờ nhận tin trần MỚI, nhiều câu bắt reply', () => {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const one = { chatId: 5, pending: [{ messageId: 10, sentAt: now }] };
  const fresh = { message: { chat: { id: 5, type: 'private' }, text: 'chọn 1', date: nowSec + 5 } };
  const stale = { message: { chat: { id: 5, type: 'private' }, text: 'tin cũ', date: nowSec - 3600 } };

  assert.deepEqual(classifyUpdate(fresh, one), {
    kind: 'reply',
    messageId: 10,
    text: 'chọn 1',
    fromId: undefined,
    fromName: '',
  });
  assert.equal(classifyUpdate(stale, one).kind, 'ignore'); // backlog cũ không được tính

  const two = { chatId: 5, pending: [{ messageId: 10, sentAt: now }, { messageId: 11, sentAt: now }] };
  assert.equal(classifyUpdate(fresh, two).kind, 'need-reply-hint');
  assert.equal(
    classifyUpdate({ message: { ...fresh.message, reply_to_message: { message_id: 11 } } }, two).messageId,
    11
  );
});

test('classifyUpdate: câu hỏi bị chunk (nhiều messageIds) — reply vào TIN NÀO cũng nhận', () => {
  const ctx = { chatId: 7, pending: [{ messageId: 30, messageIds: [28, 29, 30], sentAt: Date.now() }] };
  const base = { chat: { id: 7, type: 'supergroup' }, text: '2C', date: Math.floor(Date.now() / 1000) };
  // reply vào chunk giữa (29) vẫn khớp
  assert.deepEqual(classifyUpdate({ message: { ...base, reply_to_message: { message_id: 29 } } }, ctx), {
    kind: 'reply',
    messageId: 29,
    text: '2C',
    fromId: undefined,
    fromName: '',
  });
  // reply vào chunk đầu (28) cũng khớp
  assert.equal(classifyUpdate({ message: { ...base, reply_to_message: { message_id: 28 } } }, ctx).messageId, 28);
  // id ngoài nhóm → bỏ
  assert.equal(classifyUpdate({ message: { ...base, reply_to_message: { message_id: 99 } } }, ctx).kind, 'ignore');
});

test('resolveAnswerTokens: "1A, 2B", "A" khi 1 câu, text tự do → null', () => {
  assert.deepEqual(resolveAnswerTokens('1A, 2b', QUESTIONS), [
    'Câu 1 "Chọn database?" → "Postgres"',
    'Câu 2 "Deploy đâu?" → "Docker"',
  ]);
  assert.deepEqual(resolveAnswerTokens('B', [QUESTIONS[0]]), ['Câu 1 "Chọn database?" → "SQLite"']);
  assert.equal(resolveAnswerTokens('A', QUESTIONS), null); // 2 câu mà không ghi số câu
  assert.equal(resolveAnswerTokens('dùng Postgres đi', QUESTIONS), null);
  assert.equal(resolveAnswerTokens('9Z', QUESTIONS), null);
});

test('buildDenyReason: kèm diễn giải khi reply là token, chỉ nguyên văn khi text tự do', () => {
  const tokenized = buildDenyReason('1A', QUESTIONS, str);
  assert.match(tokenized, /^Người dùng trả lời qua Telegram: "1A"\n\(Diễn giải/);
  const free = buildDenyReason('thôi dùng SQLite', QUESTIONS, str);
  assert.equal(free, 'Người dùng trả lời qua Telegram: "thôi dùng SQLite"');
});

test('denyOutput: JSON đúng schema PreToolUse deny', () => {
  const out = JSON.parse(denyOutput('lý do'));
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'lý do',
    },
  });
});

test('isLocalKeyword', () => {
  assert.ok(isLocalKeyword('local'));
  assert.ok(isLocalKeyword('  LOCAL  '));
  assert.ok(!isLocalKeyword('locally'));
  assert.ok(!isLocalKeyword('1A'));
});

test('pendingKey: ổn định theo (session, câu hỏi), khác session → khác key', () => {
  const a = pendingKey('s1', QUESTIONS);
  assert.equal(a, pendingKey('s1', QUESTIONS));
  assert.notEqual(a, pendingKey('s2', QUESTIONS));
  assert.notEqual(a, pendingKey('s1', [QUESTIONS[0]]));
});

// ---------------------------------------------------------------------------
// event ask-done — trích đáp án từ tool_response (shape phòng thủ)
// ---------------------------------------------------------------------------

test('extractLocalAnswers: map answers, string, shape lạ', () => {
  assert.equal(extractLocalAnswers({ answers: { 'Chọn database?': 'Postgres' } }), '"Postgres"');
  assert.equal(extractLocalAnswers({ 'Q1?': 'A', 'Q2?': 'B' }), '"A", "B"');
  assert.equal(extractLocalAnswers('Postgres'), 'Postgres');
  assert.equal(extractLocalAnswers(null), '');
  assert.match(extractLocalAnswers({ weird: 1 }), /weird/); // fallback stringify
});

// ---------------------------------------------------------------------------
// state dir: lock takeover + GC
// ---------------------------------------------------------------------------

test('tryAcquireLock: lock mới không cướp được, lock stale (>60s) thì takeover', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccnt-'));
  const lock = join(dir, 'poll.lock');
  assert.ok(tryAcquireLock(lock), 'lấy được lock lần đầu');
  assert.ok(!tryAcquireLock(lock), 'lock đang sống — không cướp');
  const past = new Date(Date.now() - 120_000);
  utimesSync(lock, past, past); // giả lập poller chết (heartbeat cũ 2 phút)
  assert.ok(tryAcquireLock(lock), 'stale → takeover');
});

test('gcStateDir: xoá pending/inbox quá 24h, giữ file mới', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccnt-'));
  for (const sub of ['pending', 'inbox']) mkdirSync(join(dir, sub), { recursive: true });
  const oldFile = join(dir, 'pending', 'old.json');
  const newFile = join(dir, 'pending', 'new.json');
  writeFileSync(oldFile, '{}');
  writeFileSync(newFile, '{}');
  const past = new Date(Date.now() - 25 * 3600 * 1000);
  utimesSync(oldFile, past, past);
  gcStateDir(dir);
  assert.ok(!existsSync(oldFile));
  assert.ok(existsSync(newFile));
});

// ---------------------------------------------------------------------------
// loadConfig: default + env override + clamp timeout
// ---------------------------------------------------------------------------

test('loadConfig: đọc file, env override, clamp remoteAskTimeoutSec dưới trần 1770', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-home-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'cc-notify-telegram.json'),
    JSON.stringify({ botToken: 'T', chatId: '-1', remote: true, remoteAskTimeoutSec: 99999 })
  );
  const cfg = loadConfig({ home, env: {} });
  assert.equal(cfg.botToken, 'T');
  assert.equal(cfg.remote, true);
  assert.equal(cfg.remoteAskTimeoutSec, 1770);

  const overridden = loadConfig({ home, env: { TELEGRAM_CHAT_ID: '-42', CC_NOTIFY_REMOTE: 'off' } });
  assert.equal(overridden.chatId, '-42');
  assert.equal(overridden.remote, false);

  const empty = loadConfig({ home: mkdtempSync(join(tmpdir(), 'ccnt-e-')), env: {} });
  assert.equal(empty.botToken, '');
  assert.equal(empty.remoteAskTimeoutSec, 900);
});

// ---------------------------------------------------------------------------
// event perm — Remote Permission
// ---------------------------------------------------------------------------

test('describePermission: Bash gửi NGUYÊN VĂN description + command', () => {
  const out = describePermission('Bash', { description: 'Read ops block', command: 'grep -n "X" a.js | head -1' });
  assert.equal(out, 'Read ops block\n```\ngrep -n "X" a.js | head -1\n```');
});

test('describePermission: Edit/Write lấy file_path + nội dung mới; tool lạ → JSON', () => {
  assert.match(describePermission('Write', { file_path: '/tmp/a.txt', content: 'hello' }), /^\/tmp\/a\.txt\n```\nhello\n```$/);
  assert.match(describePermission('Edit', { file_path: '/tmp/b.txt', new_string: 'xyz' }), /\/tmp\/b\.txt[\s\S]*xyz/);
  assert.match(describePermission('mcp__foo__bar', { baz: 1 }), /"baz": 1/);
  assert.equal(describePermission('Whatever', {}), '');
  assert.equal(describePermission('Whatever', null), '');
});

test('describePermission: command siêu dài bị cap (không làm vỡ giới hạn Telegram)', () => {
  const out = describePermission('Bash', { command: 'x'.repeat(5000) });
  assert.ok(Array.from(out).length < 3100, `dài quá: ${Array.from(out).length}`);
  assert.ok(out.endsWith('…\n```'));
});

test('buildPermMessage: tag project·session, tên tool, footer; rỗng → permNoDetail', () => {
  const msg = buildPermMessage({ toolName: 'Bash', toolInput: { command: 'ls -la' }, project: 'proj', suffix: 'a1b2', str });
  assert.match(msg, /^🔐 \[proj · a1b2\] Claude xin quyền dùng:/);
  assert.match(msg, /🔧 Bash/);
  assert.match(msg, /ls -la/);
  assert.ok(msg.endsWith(str.permFooter));

  const bare = buildPermMessage({ toolName: 'Weird', toolInput: {}, project: 'p', suffix: '', str });
  assert.match(bare, /^🔐 \[p\]/);
  assert.match(bare, /\(không có chi tiết\)/);
});

test('permKeyboard: 4 nút, callback_data đúng prefix và KHÔNG vượt 64 byte của Telegram', () => {
  const kb = permKeyboard(pendingKey('sess-1', [{ question: 'q' }]), str, 30);
  const buttons = kb.inline_keyboard.flat();
  assert.equal(buttons.length, 4);
  assert.deepEqual(buttons.map((b) => b.callback_data.split(':')[0]), ['a', 'd', 's', 'l']);
  for (const b of buttons) {
    assert.ok(Buffer.byteLength(b.callback_data, 'utf8') <= 64, `callback_data quá dài: ${b.callback_data}`);
  }
  assert.match(buttons[2].text, /30′/);
});

test('permOutput: đúng schema PermissionRequest (allow / deny kèm message)', () => {
  assert.deepEqual(JSON.parse(permOutput('allow')), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  assert.deepEqual(JSON.parse(permOutput('deny', { message: 'nope' })), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'nope' } },
  });
  // deny không message → không có key thừa
  assert.deepEqual(JSON.parse(permOutput('deny')).hookSpecificOutput.decision, { behavior: 'deny' });
});

const callbackUpdate = (over = {}) => ({
  callback_query: {
    id: 'cb1',
    data: 'a:KEY1',
    from: { id: 777, first_name: 'Son' },
    message: { message_id: 10, chat: { id: -100 } },
    ...over,
  },
});

test('classifyUpdate: bấm nút hợp lệ → callback kèm fromId (để kiểm allowlist)', () => {
  const ctx = { chatId: '-100', pending: [{ kind: 'perm', messageId: 10, sentAt: 1 }] };
  assert.deepEqual(classifyUpdate(callbackUpdate(), ctx), {
    kind: 'callback',
    action: 'a',
    messageId: 10,
    fromId: 777,
    fromName: 'Son',
    callbackId: 'cb1',
  });
});

test('classifyUpdate: bấm nút sai chat / data lạ → ignore; nút của tin đã đóng → stale-callback', () => {
  const ctx = { chatId: '-100', pending: [{ kind: 'perm', messageId: 10, sentAt: 1 }] };
  const sameShape = (over) => classifyUpdate(callbackUpdate(over), ctx).kind;
  assert.equal(sameShape({ message: { message_id: 10, chat: { id: -999 } } }), 'ignore');
  // tin lạ (không còn pending) với data hợp lệ = nút của yêu cầu đã đóng → 'stale-callback'
  assert.equal(sameShape({ message: { message_id: 11, chat: { id: -100 } } }), 'stale-callback');
  assert.equal(sameShape({ data: 'zzz' }), 'ignore');
  assert.equal(sameShape({ data: '' }), 'ignore');
});

test('classifyUpdate: text reply KHÔNG bao giờ duyệt được pending kind=perm', () => {
  const ctx = { chatId: '-100', pending: [{ kind: 'perm', messageId: 10, sentAt: 1 }] };
  const reply = { message: { text: 'y', chat: { id: -100, type: 'group' }, reply_to_message: { message_id: 10 } } };
  assert.equal(classifyUpdate(reply, ctx).kind, 'ignore');
  // private chat 1 pending perm → tin trần cũng không tính là trả lời
  const bare = { message: { text: 'y', date: 9999999999, chat: { id: -100, type: 'private' } } };
  assert.equal(classifyUpdate(bare, ctx).kind, 'ignore');
});

test('session-allow: còn hạn trả expiresAt, hết hạn / chưa có trả 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccnt-sa-'));
  mkdirSync(join(dir, 'session-allow'), { recursive: true });
  const now = 1_000_000;
  assert.equal(readSessionAllow(dir, 'sess-A', now), 0);

  const expiresAt = writeSessionAllow(dir, 'sess-A', 30, now);
  assert.equal(expiresAt, now + 30 * 60_000);
  assert.equal(readSessionAllow(dir, 'sess-A', now + 60_000), expiresAt);
  assert.equal(readSessionAllow(dir, 'sess-A', expiresAt + 1), 0);
  // session khác không ăn ké
  assert.equal(readSessionAllow(dir, 'sess-B', now), 0);
});

test('gcStateDir: dọn cả session-allow quá 24h', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccnt-gc2-'));
  mkdirSync(join(dir, 'session-allow'), { recursive: true });
  const stale = join(dir, 'session-allow', 'old.json');
  writeFileSync(stale, '{}');
  const longAgo = new Date(Date.now() - 48 * 3600 * 1000);
  utimesSync(stale, longAgo, longAgo);
  gcStateDir(dir);
  assert.ok(!existsSync(stale));
});

test('loadConfig: remotePermission / allowedUserIds (ép chuỗi) / sessionAllowTtlMin clamp', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccnt-perm-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'cc-notify-telegram.json'),
    JSON.stringify({
      botToken: 'T',
      chatId: '-1',
      remotePermission: true,
      allowedUserIds: [777, ' 888 ', ''],
      sessionAllowTtlMin: 99999,
    })
  );
  const cfg = loadConfig({ home, env: {} });
  assert.equal(cfg.remotePermission, true);
  assert.deepEqual(cfg.allowedUserIds, ['777', '888']); // so khớp with String(from.id)
  assert.equal(cfg.sessionAllowTtlMin, 8 * 60);

  assert.equal(loadConfig({ home, env: { CC_NOTIFY_REMOTE_PERM: 'off' } }).remotePermission, false);
  assert.equal(loadConfig({ home, env: { CC_NOTIFY_REMOTE_PERM: '1' } }).remotePermission, true);

  // mặc định: TẮT và không ai được duyệt (fail-closed)
  const bare = loadConfig({ home: mkdtempSync(join(tmpdir(), 'ccnt-p2-')), env: {} });
  assert.equal(bare.remotePermission, false);
  assert.deepEqual(bare.allowedUserIds, []);
  assert.equal(bare.sessionAllowTtlMin, 30);
});

// ---------------------------------------------------------------------------
// event perm — plan notify-only + chống trùng Notification
// ---------------------------------------------------------------------------

test('buildPlanNotice: tag project·session, có 📋 + wording Accept/Revise/Reject', () => {
  const msg = buildPlanNotice({ project: 'proj', suffix: 'a1b2', str });
  assert.match(msg, /^📋 \[proj · a1b2\]/);
  assert.match(msg, /Accept \/ Revise \/ Reject/);
  // không suffix → tag chỉ có project
  assert.match(buildPlanNotice({ project: 'p', suffix: '', str }), /^📋 \[p\]/);
});

test('permOutput deny: kèm message lý do đúng schema { behavior:"deny", message }', () => {
  const denied = JSON.parse(permOutput('deny', { message: str.permDenyReason }));
  assert.equal(denied.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(denied.hookSpecificOutput.decision.message, str.permDenyReason);
});

test('shouldSkipNotification: bỏ permission_prompt khi remote-perm ON, nhưng CHỪA plan', () => {
  const on = { remotePermission: true };
  const off = { remotePermission: false };
  // Bash permission (remote-perm on) → bỏ để khỏi trùng nút bấm
  assert.equal(shouldSkipNotification('permission_prompt', 'Claude needs permission to run npm test', on), true);
  // Plan → GIỮ dù type permission_prompt (2 lớp: message chứa "plan")
  assert.equal(shouldSkipNotification('permission_prompt', 'Plan ready for review', on), false);
  // remote-perm OFF → giữ nguyên hành vi cũ, không bỏ gì
  assert.equal(shouldSkipNotification('permission_prompt', 'needs permission', off), false);
  // type khác permission_prompt (idle/agent chờ input) → luôn giữ
  assert.equal(shouldSkipNotification('idle_prompt', 'waiting for input', on), false);
  assert.equal(shouldSkipNotification('agent_needs_input', 'Plan ready for review', on), false);
});

// ---------------------------------------------------------------------------
// Plan (ExitPlanMode) qua Telegram
// ---------------------------------------------------------------------------

test('planTextOf: lấy tool_input.plan, rỗng / sai kiểu → chuỗi rỗng', () => {
  assert.equal(planTextOf({ plan: '  # Plan\n- a  ' }), '# Plan\n- a');
  assert.equal(planTextOf({ plan: '' }), '');
  assert.equal(planTextOf({ plan: 42 }), '');
  assert.equal(planTextOf(null), '');
  assert.equal(planTextOf({}), '');
});

test('buildPlanMessage detail=full: có tag, NGUYÊN VĂN plan và hướng dẫn reply', () => {
  const msg = buildPlanMessage({ plan: '# Plan\n- step 1', project: 'proj', suffix: 'a1b2', str, providerId: 'claude', detail: 'full' });
  assert.match(msg, /^📋 \[Claude · proj · a1b2\]/);
  assert.match(msg, /# Plan\n- step 1/);
  assert.match(msg, /REPLY/);
});

const LONG_PLAN = [
  '# Plan: Thêm báo cáo doanh thu',
  '',
  '## Context',
  'Cửa hàng cần xem doanh thu. Đây là đoạn bối cảnh dài không nên xuất hiện.',
  '',
  '## Cách làm',
  '1. Tạo bảng `daily_sales` trong `db/migrations/2026_add_sales.sql` (cột ngày, tổng tiền)',
  '2. Viết API `GET /api/reports/daily` ở `app/api/reports/route.ts`, trả về tổng theo ngày.',
  '3. **Thêm trang** `app/(admin)/reports/page.tsx` với biểu đồ [Recharts](https://recharts.org)',
  '   - chi tiết con không cần',
  '```js',
  '- không phải bước',
  '```',
  '4. Cập nhật tài liệu trong docs/ và README.md',
  '',
  '## File liên quan',
  '- app/api/reports/route.ts',
  '',
  '## Kiểm chứng',
  '- chạy npm test',
].join('\n');

test('condensePlan: chỉ giữ các bước chính, bỏ context/file/kiểm chứng, đường dẫn, markdown, mục con', () => {
  const { title, steps, total } = condensePlan(LONG_PLAN);
  assert.equal(title, 'Thêm báo cáo doanh thu');
  assert.deepEqual(steps, [
    'Tạo bảng daily_sales',
    'Viết API GET /api/reports/daily trả về tổng theo ngày',
    'Thêm trang với biểu đồ Recharts',
    'Cập nhật tài liệu',
  ]);
  assert.equal(total, 4);
});

test('condensePlan: giới hạn số bước và độ dài mỗi bước', () => {
  const plan = '## Steps\n' + Array.from({ length: 12 }, (_, i) => `- Việc ${i + 1} ${'rất dài '.repeat(30)}`).join('\n');
  const { steps, total } = condensePlan(plan, { maxSteps: 5, maxStepChars: 40 });
  assert.equal(steps.length, 5);
  assert.equal(total, 12);
  for (const s of steps) assert.ok(Array.from(s).length <= 41, s);
});

test('condensePlan: heading kiểu "### Bước 1: …" và plan không có cấu trúc', () => {
  const byHeading = condensePlan('# Plan: X\n### Bước 1: Dựng DB\nmô tả\n### Bước 2: Viết API\n');
  assert.deepEqual(byHeading.steps, ['Dựng DB', 'Viết API']);
  assert.deepEqual(condensePlan('Chỉ là một đoạn văn.').steps, []);
});

test('buildPlanMessage (mặc định summary): ngắn hơn bản đầy đủ, không còn đường dẫn/bối cảnh, KHÔNG bắt về máy xem', () => {
  const summary = buildPlanMessage({ plan: LONG_PLAN, project: 'shop', suffix: 'ab12', str, providerId: 'claude' });
  const full = buildPlanMessage({ plan: LONG_PLAN, project: 'shop', suffix: 'ab12', str, providerId: 'claude', detail: 'full' });
  assert.ok(summary.length < full.length / 2);
  assert.match(summary, /📌 Thêm báo cáo doanh thu/);
  assert.match(summary, /1\. Tạo bảng daily_sales/);
  assert.doesNotMatch(summary, /tại máy|at the machine/);
  assert.doesNotMatch(summary, /bối cảnh|route\.ts|\.sql|Kiểm chứng/);
});

test('buildPlanMessage summary: plan không có cấu trúc → fallback đoạn đầu đã làm sạch; quá 30 bước → "+N"', () => {
  const free = buildPlanMessage({ plan: 'Sửa **file** src/a/b/c.ts và thêm test.', project: 'p', suffix: '', str, providerId: 'claude' });
  assert.match(free, /Sửa và thêm test/);
  const many = '## Steps\n' + Array.from({ length: 33 }, (_, i) => `- Việc số ${i + 1}`).join('\n');
  assert.match(buildPlanMessage({ plan: many, project: 'p', suffix: '', str, providerId: 'claude' }), /… \+3 bước nữa/);
});

test('loadConfig: planDetail mặc định summary, "full" qua file hoặc env', () => {
  const home = mkdtempSync(join(tmpdir(), 'pd-'));
  mkdirSync(join(home, '.config', 'ai-notify-telegram'), { recursive: true });
  const write = (o) => writeFileSync(join(home, '.config', 'ai-notify-telegram', 'config.json'), JSON.stringify({ botToken: 't', chatId: '1', ...o }));
  write({});
  assert.equal(loadConfig({ env: {}, home }).planDetail, 'summary');
  write({ planDetail: 'full' });
  assert.equal(loadConfig({ env: {}, home }).planDetail, 'full');
  write({ planDetail: 'full' });
  assert.equal(loadConfig({ env: { CC_NOTIFY_PLAN_DETAIL: 'summary' }, home }).planDetail, 'summary');
  write({ planDetail: 'bậy' });
  assert.equal(loadConfig({ env: {}, home }).planDetail, 'summary');
});

test('planKeyboard: a/e/d/l, callback_data <= 64 byte, khớp regex classifyUpdate', () => {
  const key = pendingKey('sess', [{ question: 'ExitPlanMode:x' }]);
  const flat = planKeyboard(key, str).inline_keyboard.flat();
  assert.deepEqual(flat.map((b) => b.callback_data.split(':')[0]).sort(), ['a', 'd', 'e', 'l']);
  for (const b of flat) {
    assert.ok(Buffer.byteLength(b.callback_data) <= 64);
    const ctx = { chatId: 1, pending: [{ messageId: 5, kind: 'plan', sentAt: Date.now() }] };
    const verdict = classifyUpdate(
      { callback_query: { id: 'c', data: b.callback_data, from: { id: 9 }, message: { chat: { id: 1 }, message_id: 5 } } },
      ctx
    );
    assert.equal(verdict.kind, 'callback');
  }
});

test('planApproveOutput: allow + echo updatedInput + setMode session', () => {
  const input = { plan: '# P', planFilePath: '/x.md' };
  const out = JSON.parse(planApproveOutput(input, 'acceptEdits')).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PermissionRequest');
  assert.equal(out.decision.behavior, 'allow');
  assert.deepEqual(out.decision.updatedInput, input);
  assert.deepEqual(out.decision.updatedPermissions, [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]);
});

test('permOutput allow thường KHÔNG kèm updatedInput/updatedPermissions', () => {
  const d = JSON.parse(permOutput('allow')).hookSpecificOutput.decision;
  assert.deepEqual(d, { behavior: 'allow' });
});

test('classifyUpdate: text reply vào tin plan được nhận (kèm fromId để kiểm allowlist)', () => {
  const ctx = { chatId: 7, pending: [{ messageId: 30, kind: 'plan', sentAt: Date.now() }] };
  const msg = {
    chat: { id: 7, type: 'supergroup' },
    text: 'thêm bước test',
    date: Math.floor(Date.now() / 1000),
    from: { id: 111, first_name: 'Sơn' },
    reply_to_message: { message_id: 30 },
  };
  assert.deepEqual(classifyUpdate({ message: msg }, ctx), {
    kind: 'reply',
    messageId: 30,
    text: 'thêm bước test',
    fromId: 111,
    fromName: 'Sơn',
  });
});

// --- runPlan end-to-end với Telegram giả ---

function planHarness({ updates, plan = '# Plan\n- bước 1' }) {
  const home = mkdtempSync(join(tmpdir(), 'plan-'));
  mkdirSync(join(home, '.config', 'ai-notify-telegram'), { recursive: true });
  const cfgFile = {
    botToken: 't',
    chatId: '7',
    allowedUserIds: ['111'],
    remote: { global: true, providers: { claude: true } },
    remotePermission: { global: true, providers: { claude: true } },
    remoteAskTimeoutSec: 5,
  };
  writeFileSync(join(home, '.config', 'ai-notify-telegram', 'config.json'), JSON.stringify(cfgFile));
  const cfg = loadConfig({ env: {}, home, providerId: 'claude' });
  const sent = [];
  const edits = [];
  const queue = [...updates];
  const tg = {
    sendMessage: async (text, opts) => {
      sent.push({ text, opts });
      return { message_id: 100 + sent.length };
    },
    editMessageText: async (id, text) => edits.push({ id, text }),
    answerCallbackQuery: async () => {},
    getUpdates: async () => queue.splice(0, 1),
  };
  const payload = { session_id: 'sess-abcd', cwd: '/x/proj', tool_name: 'ExitPlanMode', tool_input: { plan, planFilePath: '/p.md' } };
  return { home, cfg, tg, sent, edits, payload, run: () => runPlan(payload, cfg, tg, {}, home, strings(cfg)) };
}

const cb = (id, data, fromId = 111) => ({
  update_id: id,
  callback_query: { id: `c${id}`, data, from: { id: fromId, first_name: 'Sơn' }, message: { chat: { id: 7 }, message_id: 101 } },
});
const keyOf = (h) => h.sent[0].opts.reply_markup.inline_keyboard.flat()[0].callback_data.split(':')[1];

test('runPlan: nút "Duyệt + tự sửa file" → allow + setMode acceptEdits', async () => {
  const h = planHarness({ updates: [] });
  h.tg.getUpdates = async () => [cb(1, `e:${keyOf(h)}`)];
  const out = JSON.parse(await h.run()).hookSpecificOutput.decision;
  assert.equal(out.behavior, 'allow');
  assert.equal(out.updatedPermissions[0].mode, 'acceptEdits');
  assert.deepEqual(out.updatedInput, h.payload.tool_input);
  assert.match(h.edits[0].text, /Đã duyệt plan/);
});

test('runPlan: reply của người trong allowlist → deny kèm góp ý nguyên văn', async () => {
  const h = planHarness({ updates: [] });
  h.tg.getUpdates = async () => [
    {
      update_id: 1,
      message: {
        chat: { id: 7, type: 'supergroup' },
        text: 'thêm bước viết test',
        date: Math.floor(Date.now() / 1000),
        from: { id: 111, first_name: 'Sơn' },
        reply_to_message: { message_id: 101 },
      },
    },
  ];
  const out = JSON.parse(await h.run()).hookSpecificOutput.decision;
  assert.equal(out.behavior, 'deny');
  assert.match(out.message, /thêm bước viết test/);
  assert.match(h.edits[0].text, /Đã gửi góp ý/);
});

test('runPlan: reply của người NGOÀI allowlist bị bỏ qua (hết giờ → nhả về máy)', async () => {
  const h = planHarness({ updates: [] });
  let first = true;
  h.tg.getUpdates = async () => {
    if (!first) return [];
    first = false;
    return [
      {
        update_id: 1,
        message: {
          chat: { id: 7, type: 'supergroup' },
          text: 'duyệt đi',
          date: Math.floor(Date.now() / 1000),
          from: { id: 999 },
          reply_to_message: { message_id: 101 },
        },
      },
    ];
  };
  h.cfg.remoteAskTimeoutSec = 1;
  assert.equal(await h.run(), null);
  assert.match(h.edits.at(-1).text, /Hết giờ/);
});

test('runPlan: nút "Chưa ổn" → deny; nút "Để máy xử lý" → null', async () => {
  const h = planHarness({ updates: [] });
  h.tg.getUpdates = async () => [cb(1, `d:${keyOf(h)}`)];
  assert.equal(JSON.parse(await h.run()).hookSpecificOutput.decision.behavior, 'deny');

  const h2 = planHarness({ updates: [] });
  h2.tg.getUpdates = async () => [cb(1, `l:${keyOf(h2)}`)];
  assert.equal(await h2.run(), null);
});

test('runPlan: không đọc được nội dung plan → chỉ báo, KHÔNG nút, nhả về máy', async () => {
  const h = planHarness({ updates: [], plan: '' });
  assert.equal(await h.run(), null);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].opts.reply_markup, undefined);
  assert.match(h.sent[0].text, /có plan cần bạn duyệt/);
});

// --- Tin Telegram không được treo nút khi người dùng xử lý tại máy ---

test('closeOnSignal: tín hiệu → chạy onClose rồi exit(0); gỡ handler thì không chạy nữa', async () => {
  let closed = 0;
  const exits = [];
  const baseline = process.listenerCount('SIGUSR2');
  const stop = closeOnSignal(async () => { closed++; }, { signals: ['SIGUSR2'], exit: (c) => exits.push(c) });
  process.emit('SIGUSR2');
  process.emit('SIGUSR2'); // bắn lần 2 không chạy lại
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, 1);
  assert.deepEqual(exits, [0]);
  stop();
  assert.equal(process.listenerCount('SIGUSR2'), baseline);
});

test('closeOnSignal: onClose lỗi vẫn exit(0)', async () => {
  const exits = [];
  const stop = closeOnSignal(async () => { throw new Error('mạng lỗi'); }, { signals: ['SIGUSR2'], exit: (c) => exits.push(c) });
  process.emit('SIGUSR2');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(exits, [0]);
  stop();
});

test('stale-callback: nút của plan đã đóng → tooltip báo + gỡ bàn phím (qua poller đang chạy)', async () => {
  const h = planHarness({ updates: [] });
  const answered = [];
  const cleared = [];
  let n = 0;
  h.tg.answerCallbackQuery = async (id, extra) => answered.push({ id, extra });
  h.tg.clearKeyboard = async (id) => cleared.push(id);
  h.tg.getUpdates = async () => {
    n++;
    // 1: bấm nút của tin 555 (không còn pending) · 2: bấm nút thật của plan đang chờ
    if (n === 1) return [{ update_id: 1, callback_query: { id: 'old', data: 'a:deadbeefdeadbeef', from: { id: 111 }, message: { chat: { id: 7 }, message_id: 555 } } }];
    return [cb(2, `l:${keyOf(h)}`)];
  };
  assert.equal(await h.run(), null);
  assert.match(answered[0].extra.text, /đã đóng/);
  assert.equal(answered[0].extra.show_alert, true);
  assert.deepEqual(cleared, [555]);
});

test('stale-callback: người ngoài allowlist bấm nút cũ → im lặng', async () => {
  const h = planHarness({ updates: [] });
  const answered = [];
  let n = 0;
  h.tg.answerCallbackQuery = async (id, extra) => answered.push({ id, extra });
  h.tg.clearKeyboard = async () => answered.push('cleared');
  h.tg.getUpdates = async () => {
    n++;
    if (n === 1) return [{ update_id: 1, callback_query: { id: 'x', data: 'a:deadbeefdeadbeef', from: { id: 999 }, message: { chat: { id: 7 }, message_id: 555 } } }];
    return [cb(2, `l:${keyOf(h)}`)];
  };
  await h.run();
  // chỉ còn lần bấm nút thật (tắt spinner, extra rỗng); không có tooltip cho người lạ, không gỡ bàn phím
  assert.ok(!answered.includes('cleared'));
  assert.ok(answered.every((a) => a.extra && !a.extra.show_alert));
});

// --- Câu hỏi mở + liệt kê đủ các bước, bỏ việc "sửa file nào" ---

const PLAN_WITH_QUESTIONS = [
  '# Plan: Báo cáo doanh thu',
  '## Các bước',
  '1. Dựng bảng doanh thu theo ngày',
  '2. Viết API trả về tổng theo ngày',
  '3. Làm trang biểu đồ',
  '',
  '## Câu hỏi mở',
  '1. Doanh thu tính theo giờ UTC hay giờ cửa hàng?',
  '   - A: UTC',
  '   - B: giờ cửa hàng',
  '2. Có cần xuất Excel không?',
  '',
  '## Phạm vi thay đổi',
  '- app/api/reports/route.ts',
  '- app/(admin)/reports/page.tsx',
].join('\n');

test('extractOpenQuestions: lấy NGUYÊN VĂN mục câu hỏi mở (kèm phương án con); không có / "Không có" → rỗng', () => {
  const q = extractOpenQuestions(PLAN_WITH_QUESTIONS);
  assert.match(q, /1\. Doanh thu tính theo giờ UTC hay giờ cửa hàng\?/);
  assert.match(q, /- A: UTC/);
  assert.match(q, /2\. Có cần xuất Excel không\?/);
  assert.doesNotMatch(q, /route\.ts|Các bước/);
  assert.equal(extractOpenQuestions(LONG_PLAN), '');
  assert.equal(extractOpenQuestions('# P\n## Open questions\nNone\n## Steps\n- a b c'), '');
  assert.equal(extractOpenQuestions('# P\n## Câu hỏi mở\n- Không có\n'), '');
});

test('condensePlan: câu hỏi mở và phạm vi thay đổi KHÔNG lọt vào các bước; bước chỉ-sửa-file bị bỏ', () => {
  const { steps } = condensePlan(PLAN_WITH_QUESTIONS);
  assert.deepEqual(steps, ['Dựng bảng doanh thu theo ngày', 'Viết API trả về tổng theo ngày', 'Làm trang biểu đồ']);
  const fileOnly = condensePlan('## Các bước\n1. Sửa `src/a.ts`\n2. Cập nhật `docs/guide.md`\n3. Thêm kiểm tra đầu vào cho form');
  assert.deepEqual(fileOnly.steps, ['Thêm kiểm tra đầu vào cho form']);
});

test('condensePlan: liệt kê HẾT các bước (không cắt ở 8)', () => {
  const plan = '## Các bước\n' + Array.from({ length: 15 }, (_, i) => `${i + 1}. Làm việc quan trọng số ${i + 1}`).join('\n');
  assert.equal(condensePlan(plan).steps.length, 15);
});

test('buildPlanQuestionsMessage: có tag, đủ câu hỏi, hướng dẫn reply', () => {
  const msg = buildPlanQuestionsMessage({ questions: extractOpenQuestions(PLAN_WITH_QUESTIONS), project: 'shop', suffix: 'ab12', str, providerId: 'claude' });
  assert.match(msg, /^❓ \[Claude · shop · ab12\]/);
  assert.match(msg, /- B: giờ cửa hàng/);
  assert.match(msg, /REPLY/);
});

test('runPlan có câu hỏi mở: reply → deny kèm câu trả lời nguyên văn; KHÔNG gửi bản tóm tắt bước', async () => {
  const h = planHarness({ updates: [], plan: PLAN_WITH_QUESTIONS });
  h.tg.getUpdates = async () => [
    {
      update_id: 1,
      message: { chat: { id: 7, type: 'supergroup' }, text: '1A, 2: không', date: Math.floor(Date.now() / 1000), from: { id: 111, first_name: 'Sơn' }, reply_to_message: { message_id: 101 } },
    },
  ];
  const out = JSON.parse(await h.run()).hookSpecificOutput.decision;
  assert.equal(out.behavior, 'deny');
  assert.match(out.message, /1A, 2: không/);
  assert.match(out.message, /BỎ mục câu hỏi mở/);
  assert.match(h.sent[0].text, /^❓/);
  assert.doesNotMatch(h.sent[0].text, /Dựng bảng doanh thu/);
  assert.deepEqual(h.sent[0].opts.reply_markup.inline_keyboard.flat().map((b) => b.callback_data.split(':')[0]).sort(), ['c', 'l']);
});

test('runPlan có câu hỏi mở: "Claude tự quyết" → deny; "Để máy xử lý" → null', async () => {
  const h = planHarness({ updates: [], plan: PLAN_WITH_QUESTIONS });
  h.tg.getUpdates = async () => [cb(1, `c:${keyOf(h)}`)];
  const out = JSON.parse(await h.run()).hookSpecificOutput.decision;
  assert.equal(out.behavior, 'deny');
  assert.match(out.message, /TỰ QUYẾT/);

  const h2 = planHarness({ updates: [], plan: PLAN_WITH_QUESTIONS });
  h2.tg.getUpdates = async () => [cb(1, `l:${keyOf(h2)}`)];
  assert.equal(await h2.run(), null);
});

test('runPlan: plan không còn câu hỏi mở → luồng duyệt bình thường (tóm tắt các bước + 4 nút)', async () => {
  const h = planHarness({ updates: [], plan: LONG_PLAN });
  h.tg.getUpdates = async () => [cb(1, `a:${keyOf(h)}`)];
  assert.equal(JSON.parse(await h.run()).hookSpecificOutput.decision.behavior, 'allow');
  assert.match(h.sent[0].text, /^📋/);
  assert.match(h.sent[0].text, /1\. Tạo bảng daily_sales/);
});

test('extractOpenQuestions: mục "Quyết định cần chốt" / "Decisions needed" cũng được hỏi; "quyết định thiết kế" thì không', () => {
  assert.match(extractOpenQuestions('# P\n## Các bước\n1. A b c\n## Quyết định cần chốt\n- Dùng Postgres hay SQLite?\n'), /Postgres hay SQLite/);
  assert.match(extractOpenQuestions('# P\n## Decisions needed\n1. Which auth provider?\n'), /Which auth provider/);
  assert.match(extractOpenQuestions('# P\n## TBD\n- retention period\n'), /retention period/);
  assert.equal(extractOpenQuestions('# P\n## Quyết định thiết kế\n- Đã chọn Postgres vì ổn định\n'), '');
  // và không lọt vào danh sách bước
  assert.deepEqual(condensePlan('## Các bước\n1. Làm việc một\n## Quyết định cần chốt\n- Dùng Postgres hay SQLite?\n').steps, ['Làm việc một']);
});
