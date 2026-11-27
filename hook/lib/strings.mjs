// Chuỗi tin nhắn (vi/en) và tag [Project · Session].

import { basename } from 'node:path';

const STRINGS = {
  vi: {
    doneFallback: '— đã hoàn thành công việc',
    donePlain: 'đã hoàn thành công việc',
    escalateFallback: '🛑 Cần bạn xử lý',
    escalateSuffix: (project) => `— ${project}: mở Claude Code xem chi tiết`,
    askHeader: (tag) => `❓ ${tag} Claude đang hỏi:`,
    askFooter:
      '↩️ Reply tin này để trả lời (vd: "1A" / "1A, 2B" / mô tả tự do).\nReply "local" nếu muốn trả lời tại máy.',
    askMulti: '(chọn được nhiều)',
    answeredTg: (text) => `✅ Đã trả lời qua Telegram: "${text}"`,
    movedLocal: '🖥 Câu hỏi chuyển về máy — đang chờ tại terminal…',
    timedOut: '⏰ Hết giờ chờ trên Telegram — câu hỏi đang chờ tại máy.',
    answeredLocal: (text) => `🖥✅ Đã trả lời tại máy: ${text}`,
    closedUnanswered: '⛔ Câu hỏi đã đóng (lượt làm việc kết thúc, không có trả lời).',
    replyHint: (n) => `🔁 Đang có ${n} câu hỏi chờ — hãy REPLY vào đúng tin câu hỏi muốn trả lời.`,
    testMessage: '✅ Test từ cc-notify-telegram',
    answerPrefix: (text) => `Người dùng trả lời qua Telegram: "${text}"`,
    answerResolved: (parts) => `(Diễn giải lựa chọn: ${parts.join('; ')})`,
    notifyPrefix: '🔔',
    permHeader: (tag) => `🔐 ${tag} Claude xin quyền dùng:`,
    permFooter: '👇 Chọn bên dưới — chỉ tài khoản trong allowlist mới bấm được.',
    permNoDetail: '(không có chi tiết)',
    btnAllow: '✅ Cho phép',
    btnDeny: '⛔ Từ chối',
    btnAllowSession: (min) => `✅ Cho phép tất cả (${min}′)`,
    btnLocal: '🖥 Để máy xử lý',
    permAllowed: (who) => `✅ Đã cho phép${who}`,
    permAllowedSession: (who, until) =>
      `✅ Đã cho phép TẤT CẢ trong session này đến ${until}${who}`,
    permDenied: (who) => `⛔ Đã từ chối${who}`,
    permDenyReason: 'Người dùng đã TỪ CHỐI yêu cầu quyền này qua Telegram.',
    permTimedOut: '⏰ Hết giờ chờ trên Telegram — yêu cầu quyền đang chờ tại máy.',
    permMovedLocal: '🖥 Yêu cầu quyền chuyển về máy — đang chờ tại terminal…',
    permSendFailed: '⚠️ Không gửi được đầy đủ nội dung — yêu cầu quyền chuyển về máy.',
    permClosed: '⛔ Yêu cầu quyền đã đóng (lượt làm việc kết thúc).',
    permClosedLocal: '🖥 Yêu cầu quyền đã được xử lý tại máy hoặc đã hủy.',
    planClosedLocal: '🖥 Plan đã được xử lý tại máy hoặc đã hủy.',
    staleButton: 'Yêu cầu này đã đóng (xử lý tại máy hoặc đã hủy) — nút không còn tác dụng.',
    permNoRight: 'Bạn không có quyền duyệt yêu cầu này.',
    planNotice: (tag) =>
      `📋 ${tag} Claude Code có plan cần bạn duyệt — mở Claude Code để đọc và chọn (Accept / Revise / Reject).`,
    planHeader: (tag) => `📋 ${tag} Claude Code có plan cần bạn duyệt:`,
    planMore: (n) => `… +${n} bước nữa`,
    planFooter:
      '👇 Chọn bên dưới, hoặc REPLY tin này để góp ý / yêu cầu sửa plan — chỉ tài khoản trong allowlist mới thao tác được.',
    btnPlanApprove: '✅ Duyệt (hỏi từng bước)',
    btnPlanApproveEdits: '✅ Duyệt + tự sửa file',
    btnPlanReject: '✏️ Chưa ổn',
    planApproved: (who) => `✅ Đã duyệt plan${who} — Claude bắt đầu làm, mỗi thao tác sửa file vẫn hỏi.`,
    planApprovedEdits: (who) => `✅ Đã duyệt plan${who} — Claude tự sửa file, không hỏi từng lần.`,
    planRejected: (who) => `✏️ Đã yêu cầu sửa plan${who}.`,
    planFeedbackSent: (who, text) => `✏️ Đã gửi góp ý${who}: "${text}"`,
    planRejectReason:
      'Người dùng CHƯA DUYỆT plan này qua Telegram (không kèm góp ý). Hãy giữ nguyên plan mode, hỏi lại người dùng cần chỉnh gì rồi sửa plan.',
    stopFooter: (min) =>
      `👇 Chọn bên dưới hoặc REPLY tin này để trả lời Claude (chờ tối đa ${min} phút) — chỉ tài khoản trong allowlist mới thao tác được.`,
    stopAnswered: (who, text) => `✅ Đã gửi cho Claude${who}: "${text}"`,
    stopAnswerReason: (text) => `Người dùng trả lời qua Telegram: "${text}". Hãy tiếp tục theo câu trả lời này.`,
    stopMovedLocal: '🖥 Để trả lời tại máy.',
    stopTimedOut: '⏰ Hết giờ chờ trên Telegram — trả lời tại máy.',
    stopClosedLocal: '🖥 Đã xử lý tại máy.',
    planFeedbackReason: (text) =>
      `Người dùng xem plan qua Telegram và CHƯA DUYỆT, góp ý: "${text}". Hãy giữ nguyên plan mode, chỉnh plan theo góp ý rồi trình lại.`,
  },
  en: {
    doneFallback: '— task completed',
    donePlain: 'task completed',
    escalateFallback: '🛑 Needs your attention',
    escalateSuffix: (project) => `— ${project}: open Claude Code for details`,
    askHeader: (tag) => `❓ ${tag} Claude is asking:`,
    askFooter:
      '↩️ Reply to this message to answer (e.g. "1A" / "1A, 2B" / free text).\nReply "local" to answer at the machine.',
    askMulti: '(multiple choices allowed)',
    answeredTg: (text) => `✅ Answered via Telegram: "${text}"`,
    movedLocal: '🖥 Question moved to the machine — waiting at the terminal…',
    timedOut: '⏰ Telegram wait timed out — question is now waiting at the machine.',
    answeredLocal: (text) => `🖥✅ Answered at the machine: ${text}`,
    closedUnanswered: '⛔ Question closed (turn ended without an answer).',
    replyHint: (n) => `🔁 ${n} questions are pending — please REPLY to the exact question message.`,
    testMessage: '✅ Test from cc-notify-telegram',
    answerPrefix: (text) => `User answered via Telegram: "${text}"`,
    answerResolved: (parts) => `(Interpreted choices: ${parts.join('; ')})`,
    notifyPrefix: '🔔',
    permHeader: (tag) => `🔐 ${tag} Claude is requesting permission to use:`,
    permFooter: '👇 Choose below — only allowlisted accounts can act.',
    permNoDetail: '(no details)',
    btnAllow: '✅ Allow',
    btnDeny: '⛔ Deny',
    btnAllowSession: (min) => `✅ Allow all (${min}′)`,
    btnLocal: '🖥 Handle at the machine',
    permAllowed: (who) => `✅ Allowed${who}`,
    permAllowedSession: (who, until) => `✅ Allowed EVERYTHING in this session until ${until}${who}`,
    permDenied: (who) => `⛔ Denied${who}`,
    permDenyReason: 'The user DENIED this permission request via Telegram.',
    permTimedOut: '⏰ Telegram wait timed out — the request is now waiting at the machine.',
    permMovedLocal: '🖥 Permission request moved to the machine — waiting at the terminal…',
    permSendFailed: '⚠️ Could not send the full request — falling back to the machine.',
    permClosed: '⛔ Permission request closed (turn ended).',
    permClosedLocal: '🖥 Permission request was handled at the machine or cancelled.',
    planClosedLocal: '🖥 Plan was handled at the machine or cancelled.',
    staleButton: 'This request is closed (handled at the machine or cancelled) — the button no longer does anything.',
    permNoRight: 'You are not allowed to approve this request.',
    planNotice: (tag) =>
      `📋 ${tag} Claude Code has a plan to review — open Claude Code to read and choose (Accept / Revise / Reject).`,
    planHeader: (tag) => `📋 ${tag} Claude Code has a plan for you to review:`,
    planMore: (n) => `… +${n} more steps`,
    planFooter:
      '👇 Choose below, or REPLY to this message with feedback / requested changes — only allowlisted accounts can act.',
    btnPlanApprove: '✅ Approve (ask per edit)',
    btnPlanApproveEdits: '✅ Approve + auto-accept edits',
    btnPlanReject: '✏️ Not yet',
    planApproved: (who) => `✅ Plan approved${who} — Claude starts working, file edits still ask first.`,
    planApprovedEdits: (who) => `✅ Plan approved${who} — Claude edits files without asking each time.`,
    planRejected: (who) => `✏️ Asked for plan changes${who}.`,
    planFeedbackSent: (who, text) => `✏️ Feedback sent${who}: "${text}"`,
    planRejectReason:
      'The user did NOT approve this plan via Telegram (no feedback given). Stay in plan mode, ask the user what to change, then revise the plan.',
    stopFooter: (min) =>
      `👇 Choose below or REPLY to this message to answer Claude (waits up to ${min} min) — only allowlisted accounts can act.`,
    stopAnswered: (who, text) => `✅ Sent to Claude${who}: "${text}"`,
    stopAnswerReason: (text) => `The user answered via Telegram: "${text}". Continue based on this answer.`,
    stopMovedLocal: '🖥 Answer at the machine.',
    stopTimedOut: '⏰ Telegram wait timed out — answer at the machine.',
    stopClosedLocal: '🖥 Handled at the machine.',
    planFeedbackReason: (text) =>
      `The user reviewed the plan via Telegram and did NOT approve it. Feedback: "${text}". Stay in plan mode, revise the plan accordingly and present it again.`,
  },
};

export function strings(cfg) {
  return STRINGS[cfg.lang] || STRINGS.vi;
}

export function projectName(payload, env = process.env) {
  return basename(env.CLAUDE_PROJECT_DIR || payload.cwd || '') || 'project';
}

export function buildTag({ project = 'project', suffix = '', sessionId = '' }) {
  const tail = suffix || (sessionId ? String(sessionId).slice(-4) : '');
  const parts = [project];
  if (tail) parts.push(tail);
  return `[${parts.join(' · ')}]`;
}
