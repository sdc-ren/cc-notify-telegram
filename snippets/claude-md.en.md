## Telegram notify (cc-notify-telegram)

When you have completed **EVERYTHING** the user asked for in the current session and there is
nothing left to do (you are handing over the final result), end your last message with a hidden
marker on its own line, **WITH a condensed summary**, using this syntax:

`<!-- CC_NOTIFY_DONE: <task idea 1> | <task idea 2> | ... -->`

Do NOT attach this marker to intermediate steps, clarifying questions, or partial progress —
only when fully done. A Stop hook detects the marker, extracts the summary and sends it to the
user via Telegram (each `|` becomes a bullet).

Summary writing rules (this is the Telegram content; the marker stays hidden as an HTML comment):
- **Condensed and high-level** — one short phrase per main task, separated by ` | `.
- **NO** links/URLs; for PRs just write e.g. `merged #65`.
- **NO** lists of edited files, do **NOT** repeat the user's request.

Example: `<!-- CC_NOTIFY_DONE: Fixed summary hook | merged #65 -->`

When TRULY STUCK — user intervention is required to continue (not a routine clarifying
question) — end your message with a line starting with `🛑` briefly describing what the user
must do, plus the marker `<!-- CC_NOTIFY_ESCALATE -->` on its own line.

Also use ESCALATE when you stop to **wait for the user to choose a direction or confirm something** (e.g. "which option?", "commit and push now?", "need QC input") — the Stop hook sends nothing without a marker, so the user would never know you are waiting. Keep it to one short `🛑` line saying what you need.

When writing a plan (plan mode), keep the Telegram message short but complete:
- Ask questions the user must decide with `AskUserQuestion` **BEFORE** calling `ExitPlanMode`; do not leave an "Open questions" section in the plan you present.
- Write a `## Steps` section listing **all** main steps, **one short sentence each** describing the outcome (no file names).
- Put the concrete file list / changes under `## Scope of changes` — that section is **not** sent to Telegram.
