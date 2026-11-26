# Security policy

cc-notify-telegram can approve Claude Code permission prompts and plans from
Telegram, so security reports are taken seriously.

## Supported versions

Only the latest commit on `main` is supported. Please reproduce on it before
reporting.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:
**Security → Report a vulnerability** on this repository
(<https://github.com/sdc-ren/cc-notify-telegram/security/advisories/new>).

Please include:

- what an attacker can do and what they need (e.g. membership in the Telegram group),
- steps to reproduce,
- `cc-notify-telegram status` output, `claude --version`, `node --version`, OS.

Never include your bot token or real chat IDs.

You should get a first response within 7 days. Once a fix is ready, we will
publish an advisory and credit you unless you prefer otherwise.

## In scope

- Anyone other than `allowedUserIds` being able to approve a permission prompt
  or plan, or answer a question on the user's behalf.
- A permission or plan being approved without an explicit button press (for
  example on timeout, error or malformed Telegram updates).
- Leaking the bot token or config contents (logs, Telegram messages, files with
  loose permissions).
- The hook writing permanent permission rules to Claude Code settings.

## Out of scope

- Someone who controls the bot token or the user's machine.
- Telegram's own security, or members of the user's own group reading messages
  sent there (choose a private group).
- What Claude Code does after the user approves a prompt.
