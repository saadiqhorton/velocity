#!/usr/bin/env bash
# Runs the visual baselines (e2e/0-visual.spec.ts, Chromium) inside the official Playwright image,
# the same image CI's `visual` job uses, so local captures and CI render fonts identically.
# Baselines are only ever (re)generated through this script (HANDOFF §5).
#
# Usage (from anywhere):
#   apps/web/scripts/visual-docker.sh <slot 1-9>              # compare against the baselines
#   apps/web/scripts/visual-docker.sh <slot 1-9> --update     # re-take all 8 baselines (design owner only)
#   apps/web/scripts/visual-docker.sh 6 -g "shell — dark"     # extra args go to playwright
#
# Same harness as scripts/e2e-webkit-docker.sh: Playwright's webServer starts the API on the slot
# port (e2e/support/server.mjs recreates velocity_e2e_web_<slot>), then setup + seed + the visual spec
# run. Requirements: `pnpm --filter @velocity/web build` has run on the host (the harness serves
# apps/web/dist), host `node_modules` are installed, and Postgres listens on :54320.
set -euo pipefail

slot="${1:-}"
if [[ ! "$slot" =~ ^[1-9]$ ]]; then
  echo "usage: $0 <slot 1-9> [--update] [playwright args…]" >&2
  exit 2
fi
shift

args=()
for a in "$@"; do
  if [[ "$a" == "--update" ]]; then args+=("--update-snapshots=all"); else args+=("$a"); fi
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Chromium only, the visual spec only; the line reporter unless the caller picked one.
exec env PW_PROJECT=chromium "$here/e2e-webkit-docker.sh" "$slot" e2e/0-visual.spec.ts "${args[@]+"${args[@]}"}"
