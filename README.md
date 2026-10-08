# cc-notify-telegram

[![CI](https://github.com/sdc-ren/cc-notify-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/sdc-ren/cc-notify-telegram/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)

**Let your AI coding agent work while you step away.** Get Telegram pings when a task finishes, answer the agent's questions from your phone, and approve or deny tool permissions with a tap.

Works with **Claude Code**, **OpenAI Codex** and **Google Antigravity**. No server, no webhook, no extra dependencies: it only uses the Telegram Bot API and each agent's own hook system.

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
| 📬 | **Completion & escalation pings.** One short summary when the agent finishes everything; a 🛑 ping when it is blocked and needs you. | on |
| ❓ | **Remote Ask.** The agent's question (with options) is sent to Telegram; reply in chat and the answer goes back to the same session. | off |
| 🔐 | **Remote Permission.** Permission requests arrive with ✅ / ⛔ buttons. Only Telegram user IDs you allowlist can press them. | off |

Safety model: **fail-closed and fail-safe.** An empty allowlist means nobody can approve remotely. Network errors, Telegram errors and timeouts fall back to the normal prompt on your machine. Nothing is ever auto-approved.

What it looks like:

```
✅ [Codex · packflow]
• Refactored API client module
• Fixed memory leak in websocket listener
```

```
🔐 [Claude · cc-notify-telegram · c3d4] Claude asks permission to use:

🔧 Bash
npm test

   [ ✅ Allow ]  [ ⛔ Deny ]
   [ ✅ Allow all (30′) ]  [ 🖥 Handle on machine ]
```

Every message carries an `[Agent · Project · Session]` tag so replies always reach the right session.

## Requirements

- Node.js **18.17+** and `git` (the package is installed from GitHub)
- At least one of: Claude Code, OpenAI Codex, Google Antigravity
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

1. let you pick which agents to install for (Claude Code, Codex, Antigravity),
2. validate your bot token with `getMe`,
3. auto-detect your chat ID (press Enter and pick from the chats the bot has seen),
4. write `~/.config/ai-notify-telegram/config.json` (mode 600),
5. copy the hook runtime to `~/.claude/hooks/cc-notify-telegram.mjs` and register hooks in each agent's config (`~/.claude/settings.json`, `~/.codex/config.json`, `~/.gemini/config/settings.json`),
6. optionally enable Remote Permission and detect the Telegram user IDs allowed to approve,
7. ask before appending the instruction block to `CLAUDE.md` / `CODEX.md` / `AGENTS.md`,
8. send a test message.

Non-interactive install (CI, dotfiles):

```bash
npx -y github:sdc-ren/cc-notify-telegram init \
  --token "123456789:AAxxx" --chat-id "-1001234567890" --yes
# --provider claude,codex,antigravity | all
# --thread-id 42  --lang en  --silent  --no-test  --no-claude-md
# --allow-user 111222333 --allow-user 444555666   (also enables Remote Permission)
```

To pin a version, append a branch, tag or commit: `github:sdc-ren/cc-notify-telegram#main` or `#<commit-sha>`.

### 3. Set up a short command (optional)

Typing `npx -y github:sdc-ren/cc-notify-telegram ...` every time gets old. Pick **one** of the options below. The hooks the installer registers do **not** depend on this step; it only makes the CLI (`status`, `remote on`, ...) easier to call.

**Option A: global install (recommended).** Creates real `cc-notify-telegram` and `ai-notify-telegram` commands that work in any shell, with no rc-file edits.

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
cc-notify remote on claude
```

An alias is only available in interactive shells, not in scripts or CI. In those, use the full `npx -y github:...` form or Option A.

> **Convention in this README.** Examples are written as `cc-notify-telegram <command>`. If you did not set up a short command, use `npx -y github:sdc-ren/cc-notify-telegram <command>`; with the Option B alias, use `cc-notify <command>`.
>
> The installed hook is a *copy* in `~/.claude/hooks/`. After you update the CLI, re-run `cc-notify-telegram init` to refresh it.

## Usage

Completion pings work right after install. Remote Ask and Remote Permission are opt-in:

```bash
cc-notify-telegram remote on          # Remote Ask
cc-notify-telegram remote-perm on     # Remote Permission (needs allowedUserIds)
```

> **Important: `remote-perm` requires `remote` to be on.** Permission and plan notifications are only sent when the global *and* per-agent `remote` switch is on. If `status` shows `Remote Ask: off`, you will get no permission or plan messages even with Remote Permission enabled. See [Troubleshooting](#troubleshooting).

Restart your agent session after changing switches, then check everything:

```bash
cc-notify-telegram status
```

## How it works

**Completion pings: marker protocol.** The instruction block added to `CLAUDE.md` / `CODEX.md` / `AGENTS.md` tells the agent: *only when everything is done*, end the last message with a hidden HTML comment:

```
<!-- AI_NOTIFY_DONE: point 1 | point 2 -->
```

(`<!-- CC_NOTIFY_DONE: ... -->` is also accepted.) The `Stop` hook reads the last message, finds the marker and sends each `|`-separated point as a bullet.

**Remote Ask.** A `PreToolUse` hook (or the Antigravity ask interceptor) catches the question *before* the UI shows it, sends it to Telegram and long-polls `getUpdates` for your reply. If nobody replies within `remoteAskTimeoutSec` (default 15 min) the question falls back to the local UI.

```
Agent asks a question
   │ PreToolUse / ask interceptor                 you're away 🚶
   ├─▶ ❓ question + options to Telegram ────────▶ you REPLY "1A"
   │◀──────────────── reply ──────────────────────┘
   ▼
answer returned to the agent → it continues
```

**Remote Permission.** A `PermissionRequest` hook fires right when the permission dialog is about to appear and sends the exact thing being requested with four buttons. The press is checked against `allowedUserIds` using Telegram's `from.id`, which cannot be spoofed.

**Plan review (Claude Code).** When Claude calls `ExitPlanMode`, a **short summary of the plan** (title plus the main steps, without file paths, background or verification sections) is sent to Telegram with buttons:

```
📋 [Claude · proj · c3d4] Claude Code has a plan for you to review:

📌 <plan title>

1. <main step>
2. <main step>
…

(Summary only — full plan at the machine)

   [ ✅ Approve (ask per edit) ]
   [ ✅ Approve + auto-accept edits ]
   [ ✏️ Not yet ]  [ 🖥 Handle at the machine ]
```

- **Approve** leaves plan mode and starts the work. "Approve + auto-accept edits" also switches the session to `acceptEdits`.
- **Review / request changes:** *reply to the plan message* with your feedback. Claude stays in plan mode, revises the plan and presents it again. "Not yet" does the same without feedback.
- Want the whole plan text instead? Set `"planDetail": "full"` (or `CC_NOTIFY_PLAN_DETAIL=full`).
- If you approve or cancel at the machine instead, the Telegram message is closed automatically ("handled at the machine or cancelled") and its buttons disappear. Tapping an old button shows a short "request closed" notice.
- Only `allowedUserIds` can press buttons or send feedback. If you reply `local`, the wait times out, or the plan text is unavailable, the normal plan dialog appears on your machine.

> Plan review relies on Claude Code's `PermissionRequest` hook for `ExitPlanMode`. It was verified end to end on Claude Code 2.1.287. If your version ignores the hook's decision, the dialog still shows locally, so nothing is lost; please open an issue with your `claude --version`.

**Codex App Server bridge.** Codex completion uses the official `Stop` hook and permissions use `PermissionRequest`. Remote Ask for Codex needs the experimental App Server API, so use `cc-notify-telegram codex-bridge` as the app-server command. It proxies JSON-RPC between your client and `codex app-server --stdio` and intercepts `item/tool/requestUserInput` plus the approval requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `execCommandApproval`, `applyPatchApproval`).

```
Codex client ──JSON-RPC──▶ cc-notify-telegram codex-bridge ──JSON-RPC──▶ codex app-server --stdio
                                │
                                ├─▶ ❓ Telegram reply   → { answers: [...] }
                                └─▶ 🔐 Telegram buttons → approval decision
```

If Telegram times out, or you reply/choose `local`, the request goes back to the local client. For `item/permissions/requestApproval`, Deny is mapped to an empty grant because the App Server schema has no separate decline decision for it.

## CLI reference

`cc-notify-telegram` and `ai-notify-telegram` are the same binary.

| Command | Description |
|---|---|
| `init` *(default)* | Install, reinstall or reconfigure |
| `test` | Send a test message |
| `status` | Health dashboard for every agent and a list of misconfigurations |
| `remote on\|off [provider]` | Toggle Remote Ask globally or for `claude` / `codex` / `antigravity` |
| `remote-perm on\|off [provider]` | Toggle Remote Permission globally or per agent |
| `codex-bridge` | Stdio proxy for the Codex App Server |
| `uninstall [--purge]` | Remove hooks. `--purge` also removes config/token, state and instruction blocks |

## Configuration

`~/.config/ai-notify-telegram/config.json` (mode 600, contains your token, **never commit it**):

| Key | Required | Default | Meaning |
|---|---|---|---|
| `botToken` | ✅ | | Token from @BotFather |
| `chatId` | ✅ | | Target chat (groups are negative, `-100…`) |
| `threadId` | | | Default topic ID when the group has Topics enabled |
| `providerThreads` | | `{}` | Per-agent topic IDs, e.g. `{ "claude": 5, "codex": 6, "antigravity": 7 }` |
| `enabledProviders` | | all three | Which agents are active |
| `lang` | | `vi` | Message and snippet language (`vi` / `en`) |
| `silent` | | `false` | Send without notification sound |
| `remote` | | `{"global": false}` | Remote Ask switches (global + per agent) |
| `remoteAskTimeoutSec` | | `900` | Wait time before falling back to the machine (max 1770) |
| `remotePermission` | | `{"global": false}` | Remote Permission switches (global + per agent) |
| `allowedUserIds` | | `[]` | Telegram user IDs allowed to approve. **Empty = nobody** |
| `sessionAllowTtlMin` | | `30` | Lifetime of "Allow all in this session" (max 480) |
| `planDetail` | | `summary` | `summary` sends the plan's title and main steps; `full` sends the whole plan text |

Environment overrides: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_THREAD_ID`, `CC_NOTIFY_REMOTE`, `CC_NOTIFY_REMOTE_PERM`, `CC_NOTIFY_PLAN_DETAIL`.

### Telegram Topics

If your group has Topics (forum mode), route each agent to its own topic with `providerThreads`. `message_thread_id` is the topic's ID, not the chat ID. The bot must be in the group and able to post; to manage topics it needs admin with **Manage Topics**.

To find topic IDs, mention the bot once in each topic, then list what it saw:

```bash
node -e "import('node:fs').then(async fs=>{const p=process.env.HOME+'/.config/ai-notify-telegram/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));const r=await fetch('https://api.telegram.org/bot'+c.botToken+'/getUpdates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({offset:-100,timeout:0,allowed_updates:['message','callback_query']})});const j=await r.json();const out=[];for(const u of j.result||[]){const m=u.message||u.callback_query?.message;if(String(m?.chat?.id)===String(c.chatId)&&m.message_thread_id!=null)out.push({message_thread_id:m.message_thread_id,text:m.text||''});}console.log(JSON.stringify(out,null,2));})"
```

If a topic ID is wrong or the topic was deleted, messages fall back to the main chat so nothing is lost. `providerThreads.<agent>` takes priority over `threadId`.

## Troubleshooting

- **I only get "task finished" messages, no permission or plan messages.** Run `cc-notify-telegram status`. Permission and plan notices need `remote` **and** `remote-perm` on, and `allowedUserIds` non-empty:
  ```bash
  cc-notify-telegram remote on claude
  cc-notify-telegram remote-perm on claude
  ```
  Restart the agent session afterwards so it re-reads the hooks. Claude Code only shows a permission dialog for tools not already allowed in your `settings.json` or by your permission mode, so a tool you pre-approved (or a bypass-permissions mode) never produces a request.
- **`group chat was upgraded to a supergroup chat`.** Telegram migrated the group. Put the new `-100…` ID (returned as `migrate_to_chat_id`) into `chatId`, then run `test`.
- **`The operation was aborted due to timeout` / `fetch failed`.** The Telegram API or your network is slow or blocked. Retry, check VPN/proxy, then run `test`. If you use a stale cached copy, run the latest from GitHub: `npx -y github:sdc-ren/cc-notify-telegram test`.
- **Messages land in the wrong topic.** Check the provider key (`claude`, `codex`, `antigravity`) and the `message_thread_id` in `providerThreads`.

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

Please add or update tests for behavior changes. CI runs on Ubuntu, macOS and Windows with Node 18 and 22.

## License

[MIT](LICENSE) © sdc-ren
