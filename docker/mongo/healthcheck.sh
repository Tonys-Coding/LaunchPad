#!/bin/sh
set -eu

replica_name="${MONGO_REPLICA_SET_NAME:-launchpad}"
replica_host="${MONGO_REPLICA_SET_HOST:-mongo:27017}"
case "$replica_name" in *[!A-Za-z0-9_-]*|'') printf 'Invalid replica-set name.\n' >&2; exit 1;; esac
case "$replica_host" in *[!A-Za-z0-9_.:-]*|'') printf 'Invalid replica-set host.\n' >&2; exit 1;; esac

set -- mongosh --quiet --host 127.0.0.1 --port 27017
if [ -n "${MONGO_INITDB_ROOT_USERNAME:-}" ]; then
  set -- "$@" --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin
fi

if "$@" --eval 'quit(rs.status().myState === 1 ? 0 : 1)' >/dev/null 2>&1; then
  exit 0
fi

# A single node owns initialization; repeated health checks may safely retry.
"$@" --eval "try { rs.initiate({_id:'$replica_name',members:[{_id:0,host:'$replica_host'}]}) } catch (e) { if (e.codeName !== 'AlreadyInitialized') throw e }" >/dev/null 2>&1 || exit 1
"$@" --eval 'quit(rs.status().myState === 1 ? 0 : 1)' >/dev/null 2>&1
