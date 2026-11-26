// Liệt kê topic (message_thread_id) của group mà bot vừa thấy — để điền `threadId`.
// Bot chỉ thấy tin mention/reply nó (privacy mode), nên trước đó hãy mention bot một lần
// trong từng topic.

import { hasCredentials, loadConfig, makeTelegram } from '../hook/notify-telegram.mjs';

// Gom các topic khác nhau trong `updates` thuộc `chatId`: { threadId, name, sample }.
export function collectTopics(updates, chatId) {
  const topics = new Map();
  for (const update of updates || []) {
    const msg = update.message || update.callback_query?.message;
    if (!msg || String(msg.chat?.id) !== String(chatId) || msg.message_thread_id == null) continue;
    const threadId = msg.message_thread_id;
    const topic = topics.get(threadId) || { threadId, name: '', sample: '' };
    // Tin đầu topic (hoặc tin được reply) mang forum_topic_created → tên topic.
    const name = msg.forum_topic_created?.name || msg.reply_to_message?.forum_topic_created?.name;
    if (name) topic.name = name;
    if (msg.text) topic.sample = msg.text;
    topics.set(threadId, topic);
  }
  return [...topics.values()].sort((a, b) => a.threadId - b.threadId);
}

export async function runTopics({ log = console.log, tg, cfg = loadConfig() } = {}) {
  if (!hasCredentials(cfg)) {
    log('Chưa có config — chạy: npx -y github:sdc-ren/cc-notify-telegram init');
    return false;
  }
  // offset âm: chỉ đọc 100 update gần nhất, không xác nhận (không làm mất update của hook đang chờ).
  const updates = await (tg || makeTelegram(cfg)).getUpdates({ offset: -100, timeout: 0 });
  const topics = collectTopics(updates, cfg.chatId);
  if (!topics.length) {
    log('Chưa thấy topic nào. Vào từng topic, mention bot một tin (vd "@tên_bot hi"), rồi chạy lại.');
    return true;
  }
  log(`Topic bot thấy gần đây trong chat ${cfg.chatId}:`);
  for (const t of topics) {
    const label = t.name ? `"${t.name}"` : t.sample ? `tin gần nhất: "${t.sample.slice(0, 50)}"` : '';
    const current = String(cfg.threadId ?? '') === String(t.threadId) ? '  ← đang dùng' : '';
    log(`  threadId ${t.threadId}  ${label}${current}`);
  }
  log('\nĐặt topic nhận tin: thêm "threadId": <số> vào ~/.config/ai-notify-telegram/config.json');
  log('(hoặc chạy lại init với --thread-id <số>).');
  return true;
}
