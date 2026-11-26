// Duyệt plan (ExitPlanMode): rút gọn plan thành các bước chính, nút duyệt.

import { buildTag, projectName } from './strings.mjs';
import { pendingKey } from './state.mjs';
import { capText, permOutput, promptTelegramPermission } from './perm.mjs';

// Nội dung plan nằm ở tool_input.plan. Không có (hoặc rỗng) thì KHÔNG dựng nút — duyệt mù là
// điều tránh nhất — chỉ báo "có plan" rồi nhả về máy.
export function planTextOf(toolInput) {
  const plan = toolInput && typeof toolInput === 'object' ? toolInput.plan : '';
  return typeof plan === 'string' ? plan.trim() : '';
}

// --- Tóm tắt plan: điện thoại chỉ cần các bước chính, không cần bối cảnh / file / kiểm chứng ---

// Mục "các bước" (ưu tiên) · mục BỎ HẲN khỏi tin Telegram: bối cảnh, phạm vi/danh sách file thay đổi,
// kiểm chứng, rủi ro… (việc sửa file nào đã thuộc phạm vi thay đổi, không cần báo từng cái).
const PLAN_STEP_HEADING = /bước|cách làm|step|implementation|approach|thực hiện|kế hoạch|tasks?/i;

const PLAN_SKIP_HEADING =
  /context|bối cảnh|file|phạm vi|scope|thay đổi|changes?|critical|kiểm chứng|verif|test|out of scope|rủi ro|risk|ghi chú|note|lưu ý|why|vì sao|tóm tắt|summary|câu hỏi|question|quyết định|decision/i;

const PLAN_FILE_EXT = 'mjs|cjs|js|jsx|ts|tsx|json|md|py|sh|yml|yaml|css|html|toml|sql|vue|go|rs|java|rb|php|lock|env';

// Đường dẫn file/thư mục (có đuôi file, bắt đầu ~/ ./ ../, thư mục kết thúc /, hoặc >= 2 cấp).
// Route API kiểu /api/reports/daily (không đuôi file) được GIỮ vì mang nghĩa của bước.
const PLAN_PATH_TOKEN = new RegExp(
  `^(?:[~.]{1,2}/\\S*|\\S*/\\S*\\.(?:${PLAN_FILE_EXT})|[\\w.-]+\\.(?:${PLAN_FILE_EXT})|[\\w.-]+(?:/[\\w.-]+)*/|[\\w.-]+(?:/[\\w.-]+){2,})(?::\\d+)?[,.;:)]*$`,
  'i'
);

// Giới từ đứng ngay trước đường dẫn bị bỏ ("ở app/x.ts", "in src/") cũng bỏ theo để câu không treo.
const PLAN_DANGLING_WORD = /^(?:ở|trong|tại|vào|trên|file|tệp|thư mục|in|at|into|to|from|on|under)$/i;

const PLAN_TRAILING_CONJ = /^(?:và|hoặc|với|cùng|and|or|with)$/i;

// Làm sạch một bước: bỏ markdown, ngoặc phụ, đường dẫn; giữ câu đầu, cắt ở `maxChars`.
// `fileOnly` = bước chỉ là "sửa file X" (bỏ đường dẫn xong gần như không còn nội dung).
function cleanPlanStepInfo(raw, maxChars) {
  const s = String(raw)
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link markdown → chỉ giữ chữ
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[`*]+/g, '')
    .replace(/\([^()]*\)/g, ''); // ngoặc đơn thường chỉ là chi tiết phụ
  const kept = [];
  let hadPath = false;
  for (const tok of s.split(/\s+/)) {
    if (!tok) continue;
    if (PLAN_PATH_TOKEN.test(tok)) {
      hadPath = true;
      if (kept.length && PLAN_DANGLING_WORD.test(kept.at(-1))) kept.pop();
      continue;
    }
    kept.push(tok);
  }
  while (kept.length && (PLAN_DANGLING_WORD.test(kept.at(-1)) || PLAN_TRAILING_CONJ.test(kept.at(-1)))) kept.pop();
  let text = kept
    .join(' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[,;:]\s*$/, '')
    .trim();
  text = text.split(/[.;]\s/)[0].replace(/[.;]$/, '').trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const fileOnly = hadPath && words < 3;
  if (Array.from(text).length > maxChars) {
    text = Array.from(text).slice(0, maxChars).join('').replace(/\s+\S*$/, '') + '…';
  }
  return { text, fileOnly: fileOnly || words < 2 };
}

const cleanPlanStep = (raw, maxChars) => cleanPlanStepInfo(raw, maxChars).text;

// Tách plan markdown thành tiêu đề + các mục (heading, các dòng thô, các mục danh sách cấp 1).
function parsePlanSections(plan) {
  const sections = [{ heading: '', level: 0, items: [], lines: [] }];
  let title = '';
  let inFence = false;
  for (const line of String(plan || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      sections.at(-1).lines.push(line);
      continue;
    }
    if (inFence) {
      sections.at(-1).lines.push(line);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      if (level === 1 && !title) {
        title = text.replace(/^plan\s*[:\-–—]\s*/i, '');
        continue;
      }
      // "### Bước 1: …" / "### 1. …" bản thân là một bước
      if (level >= 2 && /^(\d+[.)]|step\s*\d+|bước\s*\d+)/i.test(text)) {
        const stepText = text.replace(/^(\d+[.)]\s*|step\s*\d+\s*[:.\-–—]?\s*|bước\s*\d+\s*[:.\-–—]?\s*)/i, '');
        sections.push({ heading: '', level, items: [stepText], lines: [], numbered: true });
        continue;
      }
      sections.push({ heading: text, level, items: [], lines: [] });
      continue;
    }
    sections.at(-1).lines.push(line);
    const item = line.match(/^ {0,1}(?:\d+[.)]|[-*+])\s+(.*\S)\s*$/);
    if (item) sections.at(-1).items.push(item[1]);
  }
  return { title, sections };
}

// plan markdown dài → { title, steps[], total }: TẤT CẢ các bước chính (ngắn), không đường dẫn
// file, không việc "sửa file nào" (thuộc phạm vi thay đổi). Câu hỏi mở không thuộc tin này: snippet
// CLAUDE.md bắt Claude hỏi bằng AskUserQuestion TRƯỚC khi trình plan.
export function condensePlan(plan, { maxSteps = 30, maxStepChars = 120 } = {}) {
  const { title, sections } = parsePlanSections(plan);
  const isSkipped = (s) => PLAN_SKIP_HEADING.test(s.heading) && !PLAN_STEP_HEADING.test(s.heading);
  const withItems = sections.filter((s) => s.items.length);
  const stepSections = withItems.filter((s) => PLAN_STEP_HEADING.test(s.heading));
  const numbered = withItems.filter((s) => s.numbered);
  const chosen = stepSections.length
    ? stepSections
    : numbered.length
      ? numbered
      : withItems.some((s) => !isSkipped(s))
        ? withItems.filter((s) => !isSkipped(s))
        : withItems;

  const all = chosen
    .flatMap((s) => s.items)
    .map((it) => cleanPlanStepInfo(it, maxStepChars))
    .filter((info) => info.text && !info.fileOnly)
    .map((info) => info.text);
  return { title: cleanPlanStep(title, 90), steps: all.slice(0, maxSteps), total: all.length };
}

export function buildPlanMessage({ plan, project, suffix, str, detail = 'summary' }) {
  const header = str.planHeader(buildTag({ project, suffix }));
  if (detail === 'full') return [header, '', plan, '', str.planFooter].join('\n');

  const { title, steps, total } = condensePlan(plan);
  let body;
  if (steps.length) {
    body = steps.map((s, i) => `${i + 1}. ${s}`);
    if (total > steps.length) body.push(str.planMore(total - steps.length));
  } else {
    // Không nhận ra cấu trúc → 600 ký tự đầu, đã bỏ markdown/đường dẫn.
    body = [cleanPlanStep(String(plan).replace(/\s+/g, ' '), 600)];
  }
  return [header, '', ...(title ? [`📌 ${title}`, ''] : []), ...body, '', str.planFooter].join('\n');
}

// `a` = duyệt, vẫn hỏi từng lần sửa file · `e` = duyệt + tự sửa file · `d` = chưa ổn · `l` = để máy.
export function planKeyboard(key, str) {
  return {
    inline_keyboard: [
      [{ text: str.btnPlanApprove, callback_data: `a:${key}` }],
      [{ text: str.btnPlanApproveEdits, callback_data: `e:${key}` }],
      [
        { text: str.btnPlanReject, callback_data: `d:${key}` },
        { text: str.btnLocal, callback_data: `l:${key}` },
      ],
    ],
  };
}

// Duyệt plan = allow + thoát plan mode. Phải echo lại tool_input (updatedInput), nếu không
// Claude Code bỏ qua quyết định allow và hộp thoại vẫn hiện.
export function planApproveOutput(toolInput, mode) {
  return permOutput('allow', {
    updatedInput: toolInput && typeof toolInput === 'object' ? toolInput : {},
    updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }],
  });
}

// Tin báo gọn khi có plan nhưng KHÔNG đọc được nội dung (không nút, nhả về máy để duyệt).
export function buildPlanNotice({ project, suffix, str }) {
  return str.planNotice(buildTag({ project, suffix }));
}

export async function runPlan(payload, cfg, tg, env, home, str) {
  const project = projectName(payload, env);
  const suffix = String(payload.session_id || '').slice(-4);
  const plan = planTextOf(payload.tool_input);

  if (!plan) {
    await tg.sendMessage(buildPlanNotice({ project, suffix, str })).catch(() => {});
    return null;
  }

  const key = pendingKey(payload.session_id, [{ question: `ExitPlanMode:${plan}` }]);
  const prompt = await promptTelegramPermission({
    payload,
    cfg,
    tg,
    env,
    home,
    toolName: 'ExitPlanMode',
    toolInput: payload.tool_input,
    project,
    suffix,
    kind: 'plan',
    text: buildPlanMessage({ plan, project, suffix, str, detail: cfg.planDetail }),
    keyboard: planKeyboard(key, str),
  });
  if (prompt.type !== 'ok') return null;
  const { outcome, anchorId } = prompt;
  const who = outcome.fromName ? ` (${outcome.fromName})` : '';

  if (outcome.type === 'callback' && (outcome.action === 'a' || outcome.action === 'e')) {
    const edits = outcome.action === 'e';
    await tg.editMessageText(anchorId, edits ? str.planApprovedEdits(who) : str.planApproved(who)).catch(() => {});
    return planApproveOutput(payload.tool_input, edits ? 'acceptEdits' : 'default');
  }
  if (outcome.type === 'callback' && outcome.action === 'd') {
    await tg.editMessageText(anchorId, str.planRejected(who)).catch(() => {});
    return permOutput('deny', { message: str.planRejectReason });
  }
  if (outcome.type === 'reply' && outcome.text && outcome.text.toLowerCase() !== 'local') {
    await tg.editMessageText(anchorId, str.planFeedbackSent(who, capText(outcome.text, 300))).catch(() => {});
    return permOutput('deny', { message: str.planFeedbackReason(outcome.text) });
  }

  // 'l' / reply "local" / remote-off / timeout → im lặng ⇒ hộp thoại plan hiện tại máy.
  await tg
    .editMessageText(anchorId, outcome.type === 'timeout' ? str.permTimedOut : str.permMovedLocal)
    .catch(() => {});
  return null;
}
