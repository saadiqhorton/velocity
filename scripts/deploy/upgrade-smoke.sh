#!/usr/bin/env bash
# Upgrade a disposable Compose stack from a previous checkout, then restore its
# automatic pre-migration dump into a second database and boot against it.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
old_ref=${OLD_REF:-9cf440d50d657b79cf1ebf26d56cb1925c0950bc}
port=${UPGRADE_PORT:-$((20000 + $$ % 20000))}
project="velocity-upgrade-$$"
work=$(mktemp -d "${TMPDIR:-/tmp}/velocity-upgrade.XXXXXX")
old_image="velocity-upgrade-old:$$"
new_image="velocity-upgrade-new:$$"
trap 'status=$?; if ((status != 0)); then docker compose --project-name "$project" --env-file "$work/env" -f "$repo/docker-compose.yml" -f "$work/override.yml" logs --tail=100 app postgres 2>/dev/null || true; fi; docker compose --project-name "$project" --env-file "$work/env" -f "$repo/docker-compose.yml" -f "$work/override.yml" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$work"; exit "$status"' EXIT

mkdir -p "$work/old"
git -C "$repo" archive "$old_ref" | tar -x -C "$work/old"
migration_count() {
  node -e 'const fs = require("node:fs"); const journal = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (!Array.isArray(journal.entries)) process.exit(1); process.stdout.write(String(journal.entries.length));' "$1"
}
expected_old_migrations=$(migration_count "$work/old/packages/schema/migrations/meta/_journal.json")
expected_new_migrations=$(migration_count "$repo/packages/schema/migrations/meta/_journal.json")
# The baseline server bundle externalizes dependencies from workspace packages,
# while pnpm deploy only links direct server dependencies at the runtime root.
# Repair its disposable manifest so the historical server can boot. Its source
# and migrations remain from old_ref.
node - "$work/old" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const serverPath = path.join(root, 'apps/server/package.json');
const server = JSON.parse(fs.readFileSync(serverPath, 'utf8'));
for (const name of ['schema', 'events', 'services', 'graphql', 'mcp-tools', 'importers']) {
  const workspace = JSON.parse(fs.readFileSync(path.join(root, `packages/${name}/package.json`), 'utf8'));
  for (const [dependency, version] of Object.entries(workspace.dependencies ?? {})) {
    if (!dependency.startsWith('@velocity/')) server.dependencies[dependency] ??= version;
  }
}
fs.writeFileSync(serverPath, `${JSON.stringify(server, null, 2)}\n`);
NODE
pnpm --dir "$work/old" install --lockfile-only --prefer-offline >/dev/null

cat > "$work/override.yml" <<'YAML'
services:
  app:
    build: !reset null
    env_file: !reset []
    image: ${VELOCITY_IMAGE}
    environment:
      APP_SECRET: ${APP_SECRET}
      APP_URL: http://127.0.0.1:${UPGRADE_PORT}
      DATABASE_URL: postgres://velocity:${POSTGRES_PASSWORD}@postgres:5432/${ACTIVE_DB}
      VELOCITY_BACKUP_BEFORE_MIGRATE: ${BACKUP_FLAG}
  caddy:
    ports: !override
      - "127.0.0.1:${UPGRADE_PORT}:80"
    environment:
      CADDY_DOMAIN: ":80"
YAML

password=$(openssl rand -hex 24)
secret=$(openssl rand -hex 32)
write_env() {
  cat > "$work/env" <<EOF
POSTGRES_PASSWORD=$password
APP_SECRET=$secret
UPGRADE_PORT=$port
VELOCITY_IMAGE=$1
BACKUP_FLAG=$2
ACTIVE_DB=$3
EOF
}
compose() {
  docker compose --project-name "$project" --env-file "$work/env" \
    -f "$repo/docker-compose.yml" -f "$work/override.yml" "$@"
}
assert_issue() {
  local database=$1
  local count
  count=$(compose exec -T postgres psql -U velocity -d "$database" -Atc \
    "select count(*) from issues where title like 'Deployment smoke issue %'")
  [[ "$count" == 1 ]] || { echo "Expected one smoke issue in $database, found $count" >&2; exit 1; }
}
wait_ready() {
  local attempt
  for attempt in {1..30}; do
    if curl -fsS "http://127.0.0.1:$port/readyz" >/dev/null; then return; fi
    sleep 2
  done
  echo "App did not become ready on port $port" >&2
  exit 1
}

echo "Building $old_ref and current images"
# The baseline predates the web UI. Build its server source with today's
# server-runtime target, which does not copy or serve a web bundle.
docker build -q -f "$repo/Dockerfile" --target server-runtime -t "$old_image" "$work/old" >/dev/null
docker build -q -t "$new_image" "$repo" >/dev/null

write_env "$old_image" 0 velocity
compose up -d --no-build postgres app caddy
wait_ready
BASE_URL="http://127.0.0.1:$port" REQUIRE_WEB=0 node "$repo/scripts/deploy/smoke.mjs"
assert_issue velocity
old_migrations=$(compose exec -T postgres psql -U velocity -d velocity -Atc \
  'select count(*) from drizzle.__drizzle_migrations')
[[ "$old_migrations" == "$expected_old_migrations" ]] || { echo "Expected $expected_old_migrations baseline migrations, found $old_migrations" >&2; exit 1; }

echo "Upgrading in place with pre-migration backup enabled"
write_env "$new_image" 1 velocity
compose up -d --no-build --force-recreate app
wait_ready
assert_issue velocity
new_migrations=$(compose exec -T postgres psql -U velocity -d velocity -Atc \
  'select count(*) from drizzle.__drizzle_migrations')
[[ "$new_migrations" == "$expected_new_migrations" ]] || { echo "Expected $expected_new_migrations upgraded migrations, found $new_migrations" >&2; exit 1; }

dump=$(compose exec -T app sh -c 'find /data/backups -maxdepth 1 -name "*.dump" -type f | head -n 1' | tr -d '\r')
[[ -n "$dump" ]] || { echo 'No pre-migration dump was written to /data/backups' >&2; exit 1; }
compose exec -T app pg_restore --list "$dump" >/dev/null
echo "Validated automatic dump: $dump"

echo 'Restoring dump into an isolated database'
compose exec -T postgres createdb -U velocity velocity_restore
compose exec -T app cat "$dump" | compose exec -T postgres \
  pg_restore -U velocity -d velocity_restore --no-owner --exit-on-error
assert_issue velocity_restore
restored_migrations=$(compose exec -T postgres psql -U velocity -d velocity_restore -Atc \
  'select count(*) from drizzle.__drizzle_migrations')
[[ "$restored_migrations" == "$expected_old_migrations" ]] || { echo "Expected $expected_old_migrations migrations in pre-migration dump, found $restored_migrations" >&2; exit 1; }

write_env "$new_image" 0 velocity_restore
compose up -d --no-build --force-recreate app
wait_ready
assert_issue velocity_restore
restored_upgraded_migrations=$(compose exec -T postgres psql -U velocity -d velocity_restore -Atc \
  'select count(*) from drizzle.__drizzle_migrations')
[[ "$restored_upgraded_migrations" == "$expected_new_migrations" ]] || { echo "Restored app did not migrate successfully (expected $expected_new_migrations migrations, found $restored_upgraded_migrations)" >&2; exit 1; }
echo "Upgrade and restore passed ($old_ref -> current, issue preserved, restored app ready)."
