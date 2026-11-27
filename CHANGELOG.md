# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/) once 1.0.0 is released.

## [Unreleased]

### Removed
- **Codex and Antigravity support.** The tool is Claude Code only. The Codex App
  Server bridge, the `codex-bridge` command, the `ai-notify-telegram` command
  alias and the `AI_NOTIFY_*` markers are gone. Old multi-provider config files
  still load. If you installed Codex/Antigravity hooks earlier, delete the
  `ai-notify-telegram` entries from `~/.codex/hooks.json` and `~/.agents/hooks.json`.
- Detection of "Open questions / Decisions needed" sections in plans. Claude is
  told to ask those with `AskUserQuestion` before presenting a plan.

### Added
- Answer 🛑 messages from Telegram while you are away (needs `away` and Remote):
  the message carries the reply buttons from the Claude desktop app's next-step
  box, or you can REPLY with free text. Claude continues with your answer. The
  Stop hook waits up to `remoteAskTimeoutSec` and lets go as soon as you are back
  at the Mac. Re-run `init` (the Stop hook timeout grows to 1830s).
- `away <minutes> [--skip]` / `away off` (macOS): completion, 🛑 and notification
  messages are sent without sound, or skipped, while you are using the Mac.
- `topics` command to list a group's topic IDs.
- `status` warns when the installed hook differs from the CLI you are running.

### Changed
- "Claude is waiting for your input" (idle) notifications are no longer forwarded
  to Telegram; completion and 🛑 messages already cover it, and idle also fired
  while Claude only waited for background work.
- Message tags are now `[project · ab12]` (no agent name).
- The hook runtime is split into modules and installed as
  `~/.claude/hooks/cc-notify-telegram/` plus a small entry shim at the old path,
  so hook commands in `settings.json` are unchanged. Re-run `init` to update.
- Requires Node.js 22 or newer (Node 18 and 20 are end-of-life).
- The `CLAUDE.md` snippet tells Claude not to add notify markers while it only
  waits for background work (workflows, subagents, background commands).

### Fixed
- No ✅ message when Claude wrongly adds a done marker in a turn that just
  started a background workflow or subagent; it reports when the work finishes.
- Telegram calls no longer fail on networks with broken IPv6 and slow IPv4
  (longer connect attempts, one safe retry on connection errors).
- `status` and `init` no longer blame the bot token for network errors.

## [0.1.1]

Remote Permission, plan review from Telegram, closing stale Telegram buttons,
multi-agent support (Codex, Antigravity) and many fixes.

## [0.1.0] - 2026-07-13

First release: completion / escalation notifications through the `CLAUDE.md`
marker protocol, and Remote Ask (answer `AskUserQuestion` from Telegram).

[Unreleased]: https://github.com/sdc-ren/cc-notify-telegram/commits/main
