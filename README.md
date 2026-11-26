# cc-notify-telegram

[![CI](https://github.com/sdc-ren/cc-notify-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/sdc-ren/cc-notify-telegram/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

**Let Claude Code work while you step away.** Get Telegram pings when a task finishes, answer Claude's questions from your phone, and approve or deny tool permissions and plans with a tap.

No server, no webhook, no extra dependencies: it only uses the Telegram Bot API and Claude Code's own hook system.

> **Codex / Antigravity support was removed.** If you installed it earlier, delete the `ai-notify-telegram` entries from `~/.codex/hooks.json` and `~/.agents/hooks.json`.

🌐 English · [Tiếng Việt](README.vi.md)

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
  - [1. Create a Telegram bot](#1-create-a-telegram-bot)
  - [2. Run the installer](#2-run-the-installer)
  - [3. Set up a short command (optional)](#3-set-up-a-short-command-optional)
- [Usage](#usage)
- [How it works](#how-it-works)
- [CLI reference](#cli-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Uninstall](#uninstall)
- [Contributing](#contributing)
- [License](#license)

## Features

| | Feature | Default |
|---|---|---|
| 📬 | **Completion & escalation pings.** One short summary when Claude finishes everything; a 🛑 ping when it is blocked and needs you. | on |
| ❓ | **Remote Ask.** Claude's question (with options) is sent to Telegram; reply in chat and the answer goes back to the same session. | off |
| 🔐 | **Remote Permission.** Permission requests and plans arrive with ✅ / ⛔ buttons. Only Telegram user IDs you allowlist can press them. | off |

Safety model: **fail-closed and fail-safe.** An empty allowlist means nobody can approve remotely. Network errors, Telegram errors and timeouts fall back to the normal prompt on your machine. Nothing is ever auto-approved.

What it looks like:

```
✅ packflow
• Refactored API client module
• Fixed memory leak in websocket listener
```

```
🔐 [cc-notify-telegram · c3d4] Claude is requesting permission to use:

🔧 Bash
npm test

   [ ✅ Allow ]  [ ⛔ Deny ]
   [ ✅ Allow all (30′) ]  [ 🖥 Handle on machine ]
```

Questions, permission requests and plans carry a `[Project · Session]` tag so replies always reach the right session.

## Requirements

- Node.js **22+** and `git` (the package is installed from GitHub)
- Claude Code
- A Telegram bot (free, about a minute to create)
- macOS, Linux or Windows (CI runs on all three)

## Installation

> **The package is not published on npm yet**, so `npx cc-notify-telegram` returns a 404. Everything below runs straight from GitHub.

### 1. Create a Telegram bot

1. In Telegram, talk to [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the **bot token** (`123456789:AA...`). Keep it secret.
2. Add the bot to the group where you want notifications (a private chat with the bot also works).
3. In the group, mention the bot or reply to one of its messages once, so the bot can see the chat. Bots have *privacy mode* on by default; this tool works with it, you do not need to turn it off.

### 2. Run the installer

```bash
npx -y github:sdc-ren/cc-notify-telegram
```

The first run downloads the repo, so it can take a few seconds. The wizard will:

1. validate your bot token with `getMe`,
2. auto-detect your chat ID (press Enter and pick from the chats the bot has seen),
3. optionally enable Remote Permission and detect the Telegram user IDs allowed to approve,
4. write `~/.config/ai-notify-telegram/config.json` (mode 600),
5. copy the hook runtime to `~/.claude/hooks/cc-notify-telegram/` (plus a small entry shim `~/.claude/hooks/cc-notify-telegram.mjs`) and register the hooks in `~/.claude/settings.json` (backed up first),
6. ask before appending the instruction block to `~/.claude/CLAUDE.md`,
7. send a test message.

Non-interactive install (CI, dotfiles):

```bash
npx -y github:sdc-ren/cc-notify-telegram init \
  --token "123456789:AAxxx" --chat-id "-1001234567890" --yes
# --thread-id 42  --lang en  --silent  --no-test  --no-claude-md
# --allow-user 111222333 --allow-user 444555666   (also enables Remote Permission)
```

To pin a version, append a branch, tag or commit: `github:sdc-ren/cc-notify-telegram#main` or `#<commit-sha>`.

### 3. Set up a short command (optional)

Typing `npx -y github:sdc-ren/cc-notify-telegram ...` every time gets old. Pick **one** of the options below. The hooks the installer registers do **not** depend on this step; it only makes the CLI (`status`, `remote on`, ...) easier to call.

**Option A: global install (recommended).** Creates a real `cc-notify-telegram` command that works in any shell, with no rc-file edits.

```bash
npm i -g github:sdc-ren/cc-notify-telegram
cc-notify-telegram status
```

To update, run the same command again. To remove it, `npm rm -g cc-notify-telegram`.

**Option B: shell alias.** Always runs the latest GitHub version and needs no global install. Add one line to your shell config, then restart the shell (or `source` the file):

| Shell | File | Line to add |
|---|---|---|
| zsh | `~/.zshrc` | `alias cc-notify='npx -y github:sdc-ren/cc-notify-telegram'` |
| bash | `~/.bashrc` (macOS: `~/.bash_profile`) | `alias cc-notify='npx -y github:sdc-ren/cc-notify-telegram'` |
| fish | run once: `alias --save cc-notify 'npx -y github:sdc-ren/cc-notify-telegram'` | |
| PowerShell | `$PROFILE` | `function cc-notify { npx -y github:sdc-ren/cc-notify-telegram @args }` |

Then use it like this:

```bash
cc-notify status
cc-notify remote on
```

An alias is only available in interactive shells, not in scripts or CI. In those, use the full `npx -y github:...` form or Option A.

> **Convention in this README.** Examples are written as `cc-notify-telegram <command>`. If you did not set up a short command, use `npx -y github:sdc-ren/cc-notify-telegram <command>`; with the Option B alias, use `cc-notify <command>`.
>
> The installed hook is a *copy* in `~/.claude/hooks/` (the `cc-notify-telegram.mjs` shim and the `cc-notify-telegram/` runtime folder). After you update the CLI, re-run `cc-notify-telegram init` to refresh it.

## Usage

Completion pings work right after install. Remote Ask and Remote Permission are opt-in:

```bash
cc-notify-telegram remote on          # Remote Ask
cc-notify-telegram remote-perm on     # Remote Permission (needs allowedUserIds)
```

> **Important: `remote-perm` requires `remote` to be on.** Permission and plan notifications are only sent when the `remote` switch is on. If `status` shows `Remote Ask: off`, you will get no permission or plan messages even with Remote Permission enabled. See [Troubleshooting](#troubleshooting).

Restart your Claude Code session after changing switches, then check everything:

```bash
cc-notify-telegram status
```

## How it works

**Completion pings: marker protocol.** The instruction block added to `~/.claude/CLAUDE.md` tells Claude: *only when everything is done*, end the last message with a hidden HTML comment:

```
<!-- CC_NOTIFY_DONE: point 1 | point 2 -->
```

When Claude is blocked it ends with a `🛑` line and `<!-- CC_NOTIFY_ESCALATE -->` instead. The `Stop` hook reads the last message, finds the marker and sends each `|`-separated point as a bullet.

**Remote Ask.** A `PreToolUse` hook on `AskUserQuestion` catches the question *before* the UI shows it, sends it to Telegram and long-polls `getUpdates` for your reply. If nobody replies within `remoteAskTimeoutSec` (default 15 min) the question falls back to the local UI.

```
Claude asks a question
   │ PreToolUse (AskUserQuestion)                 you're away 🚶
   ├─▶ ❓ question + options to Telegram ────────▶ you REPLY "1A"
   │◀──────────────── reply ──────────────────────┘
   ▼
answer returned to Claude → it continues
```

**Remote Permission.** A `PermissionRequest` hook fires right when the permission dialog is about to appear and sends the exact thing being requested with four buttons. The press is checked against `allowedUserIds` using Telegram's `from.id`, which cannot be spoofed.

**Plan review.** When Claude calls `ExitPlanMode`, the plan is sent to Telegram as a **short list of all its main steps** (title + one short line per step; no file paths, background, scope-of-changes or verification sections) with buttons:

```
📋 [proj · c3d4] Claude Code has a plan for you to review:

📌 <plan title>

1. <main step>
2. <main step>
…


   [ ✅ Approve (ask per edit) ]
   [ ✅ Approve + auto-accept edits ]
   [ ✏️ Not yet ]  [ 🖥 Handle at the machine ]
```

- **Approve** leaves plan mode and starts the work. "Approve + auto-accept edits" also switches the session to `acceptEdits`.
- **Review / request changes:** *reply to the plan message* with your feedback. Claude stays in plan mode, revises the plan and presents it again. "Not yet" does the same without feedback.
- **Open questions are asked before the plan.** The `CLAUDE.md` snippet tells Claude to ask them with `AskUserQuestion` (which reaches Telegram through Remote Ask) before presenting the plan. Sections such as "Open questions" or "Decisions needed" are left out of the step list.
- Want the whole plan text instead? Set `"planDetail": "full"` (or `CC_NOTIFY_PLAN_DETAIL=full`).
- If you approve or cancel at the machine instead, the Telegram message is closed automatically ("handled at the machine or cancelled") and its buttons disappear. Tapping an old button shows a short "request closed" notice.
- Only `allowedUserIds` can press buttons or send feedback. If you reply `local`, the wait times out, or the plan text is unavailable, the normal plan dialog appears on your machine.

> Plan review relies on Claude Code's `PermissionRequest` hook for `ExitPlanMode`. It was verified end to end on Claude Code 2.1.287. If your version ignores the hook's decision, the dialog still shows locally, so nothing is lost; please open an issue with your `claude --version`.

## CLI reference

| Command | Description |
|---|---|
| `init` *(default)* | Install, reinstall or reconfigure |
| `test` | Send a test message |
| `status` | Health check of the whole notify chain, with how to fix each problem |
| `topics` | List the group's topic IDs the bot has seen recently (for `threadId`) |
| `remote on\|off` | Toggle Remote Ask |
| `remote-perm on\|off` | Toggle Remote Permission (and plan review) |
| `uninstall [--purge]` | Remove hooks. `--purge` also removes config/token, state and the `CLAUDE.md` block |

## Configuration

`~/.config/ai-notify-telegram/config.json` (mode 600, contains your token, **never commit it**):

| Key | Required | Default | Meaning |
|---|---|---|---|
| `botToken` | ✅ | | Token from @BotFather |
| `chatId` | ✅ | | Target chat (groups are negative, `-100…`) |
| `threadId` | | | Topic ID when the group has Topics enabled |
| `lang` | | `vi` | Message and snippet language (`vi` / `en`) |
| `silent` | | `false` | Send without notification sound |
| `remote` | | `false` | Remote Ask switch |
| `remoteAskTimeoutSec` | | `900` | Wait time before falling back to the machine (max 1770) |
| `remotePermission` | | `false` | Remote Permission switch |
| `allowedUserIds` | | `[]` | Telegram user IDs allowed to approve. **Empty = nobody** |
| `sessionAllowTtlMin` | | `30` | Lifetime of "Allow all in this session" (max 480) |
| `planDetail` | | `summary` | `summary` sends the plan's title and main steps; `full` sends the whole plan text |

Environment overrides: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_THREAD_ID`, `CC_NOTIFY_REMOTE`, `CC_NOTIFY_REMOTE_PERM`, `CC_NOTIFY_PLAN_DETAIL`.

### Telegram Topics

If your group has Topics (forum mode), send everything to one topic by setting `threadId` (or `--thread-id` at install). It is the topic's `message_thread_id`, not the chat ID. The bot must be in the group and able to post; to manage topics it needs admin with **Manage Topics**.

To find topic IDs, mention the bot once in each topic, then list what it saw:

```bash
cc-notify-telegram topics
```

If a topic ID is wrong or the topic was deleted, messages fall back to the main chat so nothing is lost.

## Troubleshooting

- **I only get "task finished" messages, no permission or plan messages.** Run `cc-notify-telegram status`. Permission and plan notices need `remote` **and** `remote-perm` on, and `allowedUserIds` non-empty:
  ```bash
  cc-notify-telegram remote on
  cc-notify-telegram remote-perm on
  ```
  Restart the Claude Code session afterwards so it re-reads the hooks. Claude Code only shows a permission dialog for tools not already allowed in your `settings.json` or by your permission mode, so a tool you pre-approved (or a bypass-permissions mode) never produces a request.
- **`group chat was upgraded to a supergroup chat`.** Telegram migrated the group. Put the new `-100…` ID (returned as `migrate_to_chat_id`) into `chatId`, then run `test`.
- **`The operation was aborted due to timeout` / `fetch failed`.** The Telegram API or your network is slow or blocked. Retry, check VPN/proxy, then run `test`. If you use a stale cached copy, run the latest from GitHub: `npx -y github:sdc-ren/cc-notify-telegram test`.
- **Messages land in the wrong topic.** Check `threadId` against the `message_thread_id` the topic-ID command above prints.

## Security

- The token lives only in `~/.config/ai-notify-telegram/config.json` (mode 600).
- Approvals are authorized by Telegram `from.id` against `allowedUserIds`. Empty list means nobody.
- Any failure, timeout or `local` choice returns control to the on-machine prompt. The tool never approves by itself.
- Found a vulnerability? Please open a private security advisory on GitHub instead of a public issue.

## Uninstall

```bash
cc-notify-telegram uninstall          # remove hooks, keep config
cc-notify-telegram uninstall --purge  # remove everything
```

## Contributing

Issues and pull requests are welcome.

```bash
git clone https://github.com/sdc-ren/cc-notify-telegram.git
cd cc-notify-telegram
npm test        # node --test, no dependencies to install
```

Please add or update tests for behavior changes. CI runs Node 22 and 26 on Ubuntu, and Node 26 on macOS and Windows.

## License

[MIT](LICENSE) © sdc-ren
