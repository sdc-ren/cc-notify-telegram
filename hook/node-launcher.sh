#!/bin/sh
# cc-notify-telegram — chạy hook bằng Node đã ghi lúc `init`. Nếu Node đó không còn (gỡ bản nvm,
# brew nâng version…) thì tự tìm một Node >= 22 khác, thay vì để mọi thông báo im lặng hỏng.
#
#   node-launcher.sh <node-lúc-cài> <hook.mjs> <event>   chạy hook
#   node-launcher.sh --which <node-lúc-cài>               in Node sẽ dùng (cho `status`)
#
# Không tìm được Node nào → thoát 0 (hook không bao giờ chặn Claude Code).

which_only=
if [ "$1" = "--which" ]; then which_only=1; shift; fi
recorded=$1
[ $# -gt 0 ] && shift

usable() {
  [ -n "$1" ] && [ -x "$1" ] &&
    "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' >/dev/null 2>&1
}

candidates() {
  command -v node 2>/dev/null
  ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -rV
  echo "$HOME/.volta/bin/node"
  echo "$HOME/.local/share/fnm/aliases/default/bin/node"
  echo /opt/homebrew/bin/node
  echo /usr/local/bin/node
  echo /usr/bin/node
}

pick=
if [ -n "$recorded" ] && [ -x "$recorded" ]; then
  pick=$recorded
else
  pick=$(candidates | while IFS= read -r n; do
    if usable "$n"; then echo "$n"; break; fi
  done)
fi

if [ -n "$which_only" ]; then
  [ -n "$pick" ] && echo "$pick"
  exit 0
fi
[ -n "$pick" ] || exit 0
exec "$pick" "$@"
