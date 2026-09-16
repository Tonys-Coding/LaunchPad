#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R minio:minio /data
  exec su-exec minio /usr/bin/minio "$@"
fi

exec /usr/bin/minio "$@"
