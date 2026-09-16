#!/bin/sh
set -eu

if [ "${1:-}" = "mongod" ] && [ -n "${MONGO_REPLICA_SET_KEY_FILE:-}" ]; then
  if [ ! -r "$MONGO_REPLICA_SET_KEY_FILE" ]; then
    printf 'MongoDB replica-set key file is not readable.\n' >&2
    exit 1
  fi
  key_target=/data/configdb/launchpad-replica-set.key
  umask 077
  cp "$MONGO_REPLICA_SET_KEY_FILE" "$key_target"
  chown mongodb:mongodb "$key_target"
  chmod 0400 "$key_target"
fi

exec docker-entrypoint.sh "$@"
