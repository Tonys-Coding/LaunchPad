#!/bin/sh
set -eu

if [ "${1:-}" = "--version" ]; then
  echo "LaunchPad setpriv compatibility wrapper"
  exit 0
fi

target_user=${1:?A target user is required}
shift

target_uid=$(id -u "$target_user")
target_gid=$(id -g "$target_user")

exec setpriv --reuid="$target_uid" --regid="$target_gid" --init-groups "$@"
