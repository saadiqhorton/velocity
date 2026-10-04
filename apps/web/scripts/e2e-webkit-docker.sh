#!/usr/bin/env bash
# Runs the Playwright E2E suite on WebKit inside the official Playwright image.
# Playwright's WebKit build targets Ubuntu and cannot run natively on hosts with newer ICU/libxml2
# (e.g. Arch), so WebKit always runs here (DIAGNOSIS §2.4).
#
# Usage (from anywhere):
#   apps/web/scripts/e2e-webkit-docker.sh <slot 1-9> [spec…] [extra playwright args…]
#   apps/web/scripts/e2e-webkit-docker.sh 8 e2e/theme.spec.ts
#   apps/web/scripts/e2e-webkit-docker.sh 8 e2e/bulk.spec.ts --repeat-each=3
#   PW_PROJECT= apps/web/scripts/e2e-webkit-docker.sh 8     # no --project: CI-shaped run (chromium + webkit)
#
# Requirements: `pnpm --filter @velocity/web build` has run on the host (the harness serves
# apps/web/dist), host `node_modules` are installed, and Postgres listens on :54320.
# Host networking lets the container reach Postgres and the slot port; the host UID keeps
# test-results_<slot> user-owned. The repo is mounted at its host path so log paths match the
# host. `--rm` leaves no container behind.
set -euo pipefail

slot="${1:-}"
if [[ ! "$slot" =~ ^[1-9]$ ]]; then
  echo "usage: $0 <slot 1-9> [spec…] [playwright args…]" >&2
  exit 2
fi
shift

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$(cd "$here/.." && pwd)"
repo_dir="$(cd "$web_dir/../.." && pwd)"

if [[ ! -f "$web_dir/dist/index.html" ]]; then
  echo "error: $web_dir/dist/index.html is missing; run \`pnpm --filter @velocity/web build\` first" >&2
  exit 1
fi

image="${PW_IMAGE:-mcr.microsoft.com/playwright:v1.63.0-noble}"
project="${PW_PROJECT-webkit}"
name="vel-webkit-${slot}-$$"

args=("$@")
if [[ -n "$project" ]]; then args+=("--project=$project"); fi
if ! printf '%s\n' "${args[@]+"${args[@]}"}" | grep -q -- '^--reporter'; then args+=("--reporter=line"); fi

# Quote each argument for the inner shell.
inner="E2E_SLOT=$slot npx playwright test"
for a in "${args[@]}"; do inner+=" $(printf '%q' "$a")"; done

exec docker run --rm --name "$name" --network host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  ${E2E_REUSE_SERVER:+-e E2E_REUSE_SERVER=1} \
  -v "$repo_dir":"$repo_dir" -w "$web_dir" "$image" \
  bash -lc "$inner"
