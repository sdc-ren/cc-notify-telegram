# Contributing to cc-notify-telegram

Thanks for helping! Bug reports, docs fixes and pull requests are all welcome.
Discussion in English or Vietnamese is fine.

## Ground rules

- **Zero runtime dependencies.** The hook runs on every Claude Code event, on the
  user's own Node. Use only Node built-ins (`node:fs`, `fetch`, …). Dev tooling
  is also kept to what ships with Node (`node --test`).
- **Never block Claude Code.** The hook must always exit 0 and stay silent on
  errors. Anything that can wait on the network must fall back to the local UI
  on timeout, error or `local` reply. Never auto-approve.
- **Fail closed on permissions.** Only Telegram user IDs in `allowedUserIds` may
  approve anything. Do not add paths that approve without that check.
- **Never commit secrets.** Bot tokens and chat IDs live in
  `~/.config/ai-notify-telegram/config.json`; tests use fake values.

## Development setup

Requires Node.js 22 or newer.

```bash
git clone https://github.com/sdc-ren/cc-notify-telegram.git
cd cc-notify-telegram
npm test
```

There is nothing to install. To try your working copy against your own Claude
Code, run the installer from the checkout (it copies `hook/` into
`~/.claude/hooks/`):

```bash
node bin/cli.mjs init        # or: node bin/cli.mjs init --yes --no-test
node bin/cli.mjs status      # warns if the installed hook differs from your checkout
```

Re-run `init` after every change to `hook/`, then start a new Claude Code session.

## Project layout

| Path | What it is |
|---|---|
| `hook/notify-telegram.mjs` | Hook entry point (`stop`, `ask`, `ask-done`, `notify`, `perm`) |
| `hook/lib/*.mjs` | Hook runtime modules: config, strings (vi/en), Telegram client, state, poller, stop, ask, plan, perm, notify, presence |
| `src/*.mjs` | CLI commands: init, status, remote, topics, away, uninstall, settings merge |
| `bin/cli.mjs` | CLI entry point |
| `snippets/` | Marker instructions inserted into `~/.claude/CLAUDE.md` |
| `test/` | `node --test` suites |

## Pull requests

1. Open an issue first for larger changes, so we can agree on the approach.
2. Keep each PR focused on one thing.
3. Add or update tests for any behaviour change. `npm test` must pass.
4. User-facing text exists in both Vietnamese and English (`hook/lib/strings.mjs`,
   `snippets/*.vi.md` / `*.en.md`, `README.vi.md` / `README.md`). Update both.
5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
6. CI runs Node 22 and 26 on Ubuntu and Node 26 on macOS and Windows; all
   required checks must pass before merge.

Commit messages follow a light [Conventional Commits](https://www.conventionalcommits.org/)
style: `feat: …`, `fix: …`, `docs: …`, `refactor: …`, `test: …`, `ci: …`, `chore: …`.

## Reporting bugs

Use the bug report template. Include the output of `cc-notify-telegram status`
(it never prints your token), `claude --version`, `node --version` and your OS.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By taking part
you agree to uphold it.
