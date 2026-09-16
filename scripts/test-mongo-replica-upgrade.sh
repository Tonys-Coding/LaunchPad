#!/usr/bin/env bash
# Uses only uniquely named containers, networks, databases, and disposable volumes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
suffix="$(openssl rand -hex 4)"
network="launchpad-mongo-replica-${suffix}"
auth_container="${network}-auth"
upgrade_container="${network}-upgrade"
auth_volume="${network}-auth-data"
upgrade_volume="${network}-upgrade-data"
auth_db="launchpad_replica_test_auth_${suffix}"
upgrade_db="launchpad_replica_test_upgrade_${suffix}"
secret_dir="$(mktemp -d /tmp/launchpad-mongo-key.XXXXXX)"
key_path="${secret_dir}/replica.key"
openssl rand -base64 -out "$key_path" 756
chmod 0400 "$key_path"

cleanup() {
  docker stop "$auth_container" "$upgrade_container" >/dev/null 2>&1 || true
  docker rm "$auth_container" "$upgrade_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  printf 'Retained test-only volumes: %s and %s\n' "$auth_volume" "$upgrade_volume"
  printf 'Temporary test key directory: %s\n' "$secret_dir"
}
trap cleanup EXIT
docker network create --internal "$network" >/dev/null

# Fresh production-style authenticated replica set.
docker run -d --name "$auth_container" --network "$network" \
  --hostname "$auth_container" -v "$auth_volume:/data/db" \
  -v "$key_path:/run/secrets/mongo_replica_set_key:ro" \
  -v "$PWD/docker/mongo-init.js:/docker-entrypoint-initdb.d/launchpad.js:ro" \
  -e MONGO_INITDB_ROOT_USERNAME=test_root -e MONGO_INITDB_ROOT_PASSWORD=test_root_password \
  -e MONGO_INITDB_DATABASE="$auth_db" -e MONGO_DATABASE="$auth_db" \
  -e MONGO_APP_USERNAME=test_app -e MONGO_APP_PASSWORD=test_app_password \
  -e MONGO_REPLICA_SET_NAME=launchpad-auth -e MONGO_REPLICA_SET_HOST="${auth_container}:27017" \
  -e MONGO_REPLICA_SET_KEY_FILE=/run/secrets/mongo_replica_set_key \
  launchpad-mongo-production:latest mongod --auth --bind_ip_all \
  --replSet launchpad-auth --keyFile /data/configdb/launchpad-replica-set.key >/dev/null
for _ in {1..60}; do
  docker exec "$auth_container" launchpad-mongo-healthcheck >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$auth_container" launchpad-mongo-healthcheck
docker run --rm --network "$network" \
  -v "$PWD/scripts/verify_mongo_transactions.py:/verify.py:ro" \
  -e "VERIFY_MONGO_URL=mongodb://test_app:test_app_password@${auth_container}:27017/?replicaSet=launchpad-auth&authSource=${auth_db}" \
  -e VERIFY_DATABASE="$auth_db" -e VERIFY_REPLICA_SET=launchpad-auth \
  launchpad-production-backend:latest python /verify.py
docker exec "$auth_container" mongodump --quiet --archive=/tmp/launchpad-auth.archive.gz --gzip --db "$auth_db" \
  --username test_root --password test_root_password --authenticationDatabase admin
docker exec "$auth_container" mongosh --quiet "$auth_db" --username test_root --password test_root_password \
  --authenticationDatabase admin --eval "db.probe.updateOne({_id:'before'},{\$set:{value:'changed'}})" >/dev/null
docker exec "$auth_container" mongorestore --quiet --archive=/tmp/launchpad-auth.archive.gz --gzip --drop \
  --username test_root --password test_root_password --authenticationDatabase admin
test "$(docker exec "$auth_container" mongosh --quiet "$auth_db" --username test_root --password test_root_password --authenticationDatabase admin --eval "db.probe.findOne({_id:'before'}).value")" = preserved
printf 'PASS: authenticated replica-set dump and restore\n'

# Existing standalone volume -> replica set, preserving its records.
docker run -d --name "$upgrade_container" --network "$network" \
  --hostname "$upgrade_container" -v "$upgrade_volume:/data/db" \
  -e MONGO_REPLICA_SET_NAME=launchpad-upgrade -e MONGO_REPLICA_SET_HOST="${upgrade_container}:27017" \
  launchpad-mongo-production:latest mongod --bind_ip_all >/dev/null
for _ in {1..30}; do
  docker exec "$upgrade_container" mongosh --quiet --eval "db.adminCommand('ping').ok" >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$upgrade_container" mongosh --quiet "$upgrade_db" --eval \
  "db.sentinel.insertOne({_id:'preserved',value:'before-upgrade'})" >/dev/null
docker stop "$upgrade_container" >/dev/null
docker rm "$upgrade_container" >/dev/null
docker run -d --name "$upgrade_container" --network "$network" \
  --hostname "$upgrade_container" -v "$upgrade_volume:/data/db" \
  -e MONGO_REPLICA_SET_NAME=launchpad-upgrade -e MONGO_REPLICA_SET_HOST="${upgrade_container}:27017" \
  launchpad-mongo-production:latest mongod --bind_ip_all --replSet launchpad-upgrade >/dev/null
for _ in {1..60}; do
  docker exec "$upgrade_container" launchpad-mongo-healthcheck >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$upgrade_container" launchpad-mongo-healthcheck
test "$(docker exec "$upgrade_container" mongosh --quiet "$upgrade_db" --eval "db.sentinel.findOne({_id:'preserved'}).value")" = before-upgrade
docker run --rm --network "$network" \
  -v "$PWD/scripts/verify_mongo_transactions.py:/verify.py:ro" \
  -e "VERIFY_MONGO_URL=mongodb://${upgrade_container}:27017/?replicaSet=launchpad-upgrade" \
  -e VERIFY_DATABASE="$upgrade_db" -e VERIFY_REPLICA_SET=launchpad-upgrade \
  launchpad-production-backend:latest python /verify.py
docker exec "$upgrade_container" mongodump --quiet --archive=/tmp/launchpad-upgrade.archive.gz --gzip --db "$upgrade_db"
docker exec "$upgrade_container" mongosh --quiet "$upgrade_db" --eval "db.sentinel.updateOne({_id:'preserved'},{\$set:{value:'changed'}})" >/dev/null
docker exec "$upgrade_container" mongorestore --quiet --archive=/tmp/launchpad-upgrade.archive.gz --gzip --drop
test "$(docker exec "$upgrade_container" mongosh --quiet "$upgrade_db" --eval "db.sentinel.findOne({_id:'preserved'}).value")" = before-upgrade
printf 'PASS: converted replica-set dump and restore\n'
docker restart "$upgrade_container" >/dev/null
for _ in {1..60}; do
  docker exec "$upgrade_container" launchpad-mongo-healthcheck >/dev/null 2>&1 && break
  sleep 1
done
test "$(docker exec "$upgrade_container" mongosh --quiet "$upgrade_db" --eval "db.sentinel.findOne({_id:'preserved'}).value")" = before-upgrade
printf 'PASS: standalone data preserved through replica-set conversion and restart\n'
