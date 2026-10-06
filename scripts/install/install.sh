#!/bin/sh
# Velocity one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/saadiqhorton/velocity/main/scripts/install/install.sh | sudo sh
#
# Options:  --domain <name>   serve https://<name> (automatic certificate)
#           --yes, -y         never ask questions; accept defaults
#           --no-start        prepare everything but do not start containers
#           --help
# Environment: VELOCITY_DOMAIN, VELOCITY_HOME (/opt/velocity), VELOCITY_REPO (saadiqhorton/velocity),
#   VELOCITY_REF (main), VELOCITY_SOURCE (local checkout to copy instead of downloading),
#   VELOCITY_HTTP_PORT (80), VELOCITY_HTTPS_PORT (443), VELOCITY_NO_START, VELOCITY_BIN_DIR (/usr/local/bin),
#   VELOCITY_WAIT_SECONDS (300).
#
# Safe to re-run: it upgrades in place and never overwrites an existing .env.

set -eu

VELOCITY_HOME="${VELOCITY_HOME:-/opt/velocity}"
VELOCITY_REPO="${VELOCITY_REPO:-saadiqhorton/velocity}"
VELOCITY_REF="${VELOCITY_REF:-main}"
VELOCITY_SOURCE="${VELOCITY_SOURCE:-}"
VELOCITY_HTTP_PORT="${VELOCITY_HTTP_PORT:-80}"
VELOCITY_HTTPS_PORT="${VELOCITY_HTTPS_PORT:-443}"
BIN_DIR_GIVEN="${VELOCITY_BIN_DIR:-}"
VELOCITY_BIN_DIR="${VELOCITY_BIN_DIR:-/usr/local/bin}"
FIRST_INSTALL=0
VELOCITY_WAIT_SECONDS="${VELOCITY_WAIT_SECONDS:-300}"
DOMAIN="${VELOCITY_DOMAIN:-}"
ASSUME_YES=0
NO_START="${VELOCITY_NO_START:-}"
ORIG_ARGS="$*"

if [ -t 1 ]; then
  B='\033[1m'; G='\033[32m'; Y='\033[33m'; R='\033[31m'; N='\033[0m'
else
  B=''; G=''; Y=''; R=''; N=''
fi
say()  { printf '%b\n' "$*"; }
step() { printf '\n%b==>%b %b%s%b\n' "$G" "$N" "$B" "$*" "$N"; }
ok()   { printf '  %b[ok]%b %s\n' "$G" "$N" "$*"; }
warn() { printf '  %b[warn]%b %s\n' "$Y" "$N" "$*" >&2; }
die()  { printf '\n%bError:%b %s\n' "$R" "$N" "$*" >&2; exit 1; }

usage() {
  sed -n '2,15p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
}

# --- argument parsing --------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) [ $# -ge 2 ] || die "--domain needs a value, e.g. --domain tracker.example.com"; DOMAIN="$2"; shift 2 ;;
    --domain=*) DOMAIN="${1#--domain=}"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done


# --- helpers -----------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

# Read one line from the terminal even when the script itself is piped into sh.
prompt_line() { # prompt default -> stdout
  if [ "$ASSUME_YES" = 1 ] || ! [ -r /dev/tty ] || ! (: </dev/tty) 2>/dev/null; then
    printf '%s' "$2"; return 0
  fi
  printf '%s' "$1" >/dev/tty
  ans=''
  IFS= read -r ans </dev/tty || ans=''
  [ -n "$ans" ] || ans="$2"
  printf '%s' "$ans"
}

confirm() { # question -> 0 yes / 1 no (default yes)
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  ans=$(prompt_line "$1 [Y/n] " "y")
  case "$ans" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

valid_domain() {
  case "$1" in
    *[!A-Za-z0-9.-]*|.*|*.|-*|'') return 1 ;;
    *.*) return 0 ;;
    *) return 1 ;;
  esac
}

valid_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

random_hex() { # bytes
  if have openssl; then
    openssl rand -hex "$1"
  else
    od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

public_ip() {
  for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -fsS --max-time 5 "$u" 2>/dev/null | tr -d ' \n\r') || ip=''
    case "$ip" in
      *[!0-9a-fA-F:.]*|'') ;;
      *) printf '%s' "$ip"; return 0 ;;
    esac
  done
  return 1
}

resolve_ipv4() {
  if have getent; then getent ahostsv4 "$1" 2>/dev/null | awk 'NR==1{print $1}'
  elif have dig; then dig +short A "$1" 2>/dev/null | head -n1
  elif have host; then host -t A "$1" 2>/dev/null | awk '/has address/{print $4; exit}'
  fi
}

port_in_use() {
  if have ss; then ss -ltn 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {f=1} END{exit !f}'
  elif have netstat; then netstat -ltn 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {f=1} END{exit !f}'
  else return 1
  fi
}

dc() { docker compose --project-directory "$VELOCITY_HOME" -f "$VELOCITY_HOME/docker-compose.yml" "$@"; }

env_value() { # key -> value from .env
  [ -f "$VELOCITY_HOME/.env" ] || return 0
  sed -n "s/^$1=//p" "$VELOCITY_HOME/.env" | tail -n1
}

# --- steps -------------------------------------------------------------------
ensure_privileges() {
  [ "$(id -u)" = 0 ] && return 0
  # Non-root is fine when Docker is usable and the install dir is writable (e.g. testing).
  if have docker && docker info >/dev/null 2>&1 \
     && mkdir -p "$VELOCITY_HOME" 2>/dev/null && [ -w "$VELOCITY_HOME" ]; then
    return 0
  fi
  if have sudo && [ -f "$0" ] && [ "${0##*/}" != sh ]; then
    say "Velocity needs administrator rights; re-running with sudo..."
    exec sudo -E sh "$0" $ORIG_ARGS
  fi
  die "This installer needs root. Re-run it as root, for example:
    curl -fsSL <installer-url> | sudo sh"
}

detect_platform() {
  [ "$(uname -s)" = Linux ] || die "Velocity's installer supports Linux servers only (found $(uname -s))."
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64|aarch64|arm64) ;;
    *) warn "Untested CPU architecture '$arch'; continuing, but images may be unavailable." ;;
  esac
  os_name=Linux
  if [ -r /etc/os-release ]; then os_name=$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-Linux}"); fi
  ok "$os_name ($arch)"
  have curl || die "curl is required. Install it first (for example: apt-get install -y curl) and re-run."
  have tar || die "tar is required. Install it first and re-run."
}

ensure_docker() {
  if have docker && docker compose version >/dev/null 2>&1; then
    ok "Docker and Compose are installed"
  else
    say "Docker (with the Compose v2 plugin) is not installed."
    confirm "Install Docker now using Docker's official script (get.docker.com)?" \
      || die "Docker is required. Install it from https://docs.docker.com/engine/install/ and re-run."
    tmp_docker=$(mktemp)
    curl -fsSL https://get.docker.com -o "$tmp_docker" || die "Could not download https://get.docker.com. Check this server's internet access."
    sh "$tmp_docker" || { rm -f "$tmp_docker"; die "Docker's installer failed. See its output above, or install Docker manually: https://docs.docker.com/engine/install/"; }
    rm -f "$tmp_docker"
    have systemctl && systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  if ! docker info >/dev/null 2>&1; then
    have systemctl && systemctl start docker >/dev/null 2>&1 || true
    sleep 2
  fi
  docker info >/dev/null 2>&1 || die "The Docker daemon is not running (or you lack permission). Try: sudo systemctl start docker"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing. Install the 'docker-compose-plugin' package and re-run."
  ok "Docker daemon is running"
}

fetch_release() {
  step "Downloading Velocity into $VELOCITY_HOME"
  mkdir -p "$VELOCITY_HOME" || die "Cannot create $VELOCITY_HOME."
  stage=$(mktemp -d "${VELOCITY_HOME}.stage.XXXXXX") || die "Cannot create a staging directory next to $VELOCITY_HOME."
  trap 'rm -rf "$stage"' EXIT
  if [ -n "$VELOCITY_SOURCE" ]; then
    [ -f "$VELOCITY_SOURCE/docker-compose.yml" ] || die "VELOCITY_SOURCE=$VELOCITY_SOURCE does not look like a Velocity checkout."
    tar -C "$VELOCITY_SOURCE" --exclude=node_modules --exclude=.git --exclude=./.env --exclude=./.env.local \
        --exclude=./data --exclude=.turbo --exclude=test-results --exclude=playwright-report \
        --exclude=./.opencode -cf - . | tar -C "$stage" -xf - || die "Copying $VELOCITY_SOURCE failed."
    ok "Copied files from $VELOCITY_SOURCE"
  else
    url="https://codeload.github.com/$VELOCITY_REPO/tar.gz/$VELOCITY_REF"
    curl -fsSL "$url" | tar -xz -C "$stage" --strip-components=1 \
      || die "Could not download $url. Check the server's internet access, and that VELOCITY_REPO ($VELOCITY_REPO) and VELOCITY_REF ($VELOCITY_REF) exist."
    ok "Downloaded $VELOCITY_REPO@$VELOCITY_REF"
  fi
  [ -f "$stage/docker-compose.yml" ] || die "The downloaded release has no docker-compose.yml."
  # Replace release files but keep .env and local state.
  for entry in "$VELOCITY_HOME"/* "$VELOCITY_HOME"/.[!.]*; do
    [ -e "$entry" ] || continue
    case "${entry##*/}" in .env|backups|.env.bak|.velocity-release) continue ;; esac
    rm -rf "$entry"
  done
  for entry in "$stage"/* "$stage"/.[!.]*; do
    [ -e "$entry" ] || continue
    case "${entry##*/}" in .env) continue ;; esac
    mv "$entry" "$VELOCITY_HOME/"
  done
  rm -rf "$stage"; trap - EXIT
  version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$VELOCITY_HOME/package.json" 2>/dev/null | head -n1)
  {
    if [ -n "$VELOCITY_SOURCE" ]; then echo "repo=local:$VELOCITY_SOURCE"; else echo "repo=$VELOCITY_REPO"; fi
    echo "ref=$VELOCITY_REF"
    echo "version=${version:-unknown}"
    echo "installed=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$VELOCITY_HOME/.velocity-release"
}

check_ports() {
  # Our own running stack legitimately holds the ports on a re-run.
  if [ -f "$VELOCITY_HOME/.env" ] && [ -n "$(dc ps -q caddy 2>/dev/null || true)" ]; then return 0; fi
  for p in "$VELOCITY_HTTP_PORT" "$VELOCITY_HTTPS_PORT"; do
    if port_in_use "$p"; then
      die "Port $p is already in use by another program (a web server such as nginx/apache?).
Stop it, or pick other ports, for example:
    VELOCITY_HTTP_PORT=8080 VELOCITY_HTTPS_PORT=8443 sh install.sh
(With a custom port, automatic HTTPS certificates will not work unless 80/443 are reachable from the internet.)"
    fi
  done
  ok "Ports $VELOCITY_HTTP_PORT and $VELOCITY_HTTPS_PORT are free"
}

persist_bin_dir() { # remember a custom command location so `velocity update` finds it
  [ "$VELOCITY_BIN_DIR" != /usr/local/bin ] || return 0
  grep -q '^VELOCITY_BIN_DIR=' "$envf" || printf 'VELOCITY_BIN_DIR=%s\n' "$VELOCITY_BIN_DIR" >> "$envf"
}

write_env() {
  step "Configuring"
  envf="$VELOCITY_HOME/.env"
  if [ -f "$envf" ]; then
    ok "Keeping your existing configuration ($envf)"
    # Upgrades: only add the backup folder setting if it is missing; nothing else changes.
    if ! grep -q '^VELOCITY_BACKUP_DIR=' "$envf"; then
      printf 'VELOCITY_BACKUP_DIR=%s/backups\n' "$VELOCITY_HOME" >> "$envf"
      ok "Backups will now be stored in $VELOCITY_HOME/backups (older backups stay in the app_data Docker volume)"
    fi
    persist_bin_dir
    return 0
  fi
  FIRST_INSTALL=1
  valid_port "$VELOCITY_HTTP_PORT" || die "Invalid VELOCITY_HTTP_PORT: $VELOCITY_HTTP_PORT"
  valid_port "$VELOCITY_HTTPS_PORT" || die "Invalid VELOCITY_HTTPS_PORT: $VELOCITY_HTTPS_PORT"
  ip=$(public_ip || true)
  if [ -z "$DOMAIN" ]; then
    hint="http://${ip:-localhost}"
    DOMAIN=$(prompt_line "Domain name (leave blank to use $hint): " "")
  fi
  if [ -n "$DOMAIN" ]; then
    DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed 's#^https\{0,1\}://##; s#/.*$##')
    valid_domain "$DOMAIN" || die "'$DOMAIN' does not look like a domain name (example: tracker.example.com)."
    resolved=$(resolve_ipv4 "$DOMAIN" || true)
    if [ -z "$resolved" ]; then
      warn "$DOMAIN does not resolve yet. Create a DNS 'A' record pointing to ${ip:-this server}; HTTPS starts working once it propagates."
    elif [ -n "$ip" ] && [ "$resolved" != "$ip" ]; then
      warn "$DOMAIN points to $resolved but this server is $ip. HTTPS will fail until DNS is fixed."
    else
      ok "$DOMAIN points at this server"
    fi
    app_url="https://$DOMAIN"
    [ "$VELOCITY_HTTPS_PORT" = 443 ] || app_url="$app_url:$VELOCITY_HTTPS_PORT"
  else
    app_url="http://${ip:-localhost}"
    [ "$VELOCITY_HTTP_PORT" = 80 ] || app_url="$app_url:$VELOCITY_HTTP_PORT"
    ok "No domain given: Velocity will be served over plain HTTP at $app_url"
  fi
  umask 077
  cat > "$envf" <<EOF
# Velocity configuration, generated by the installer on $(date -u +%Y-%m-%d).
# Edit with: velocity config    (all options: .env.example in this directory)
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-velocity}
POSTGRES_PASSWORD=$(random_hex 24)
APP_SECRET=$(random_hex 32)
CADDY_DOMAIN=$DOMAIN
APP_URL=$app_url
HTTP_PORT=$VELOCITY_HTTP_PORT
HTTPS_PORT=$VELOCITY_HTTPS_PORT
VELOCITY_BACKUP_DIR=$VELOCITY_HOME/backups
EOF
  chmod 600 "$envf"
  persist_bin_dir
  ok "Wrote $envf (private, mode 600)"
}

make_backup_dir() { # plain-file backups on the host, owned by the container user (10001)
  dir=$(env_value VELOCITY_BACKUP_DIR)
  [ -n "$dir" ] || return 0
  { mkdir -p "$dir" && chmod 700 "$dir"; } || die "Cannot create $dir."
  chown 10001:10001 "$dir" 2>/dev/null || warn "Could not chown $dir to 10001:10001; backups may fail (run: chown 10001:10001 $dir)"
}

pull_or_build() {
  step "Getting the Velocity image"
  dc pull caddy postgres >/dev/null 2>&1 || warn "Could not pre-pull caddy/postgres images; Docker will fetch them on start."
  if [ -z "$VELOCITY_SOURCE" ] && dc pull app >/dev/null 2>&1; then
    ok "Pulled the published image"
  else
    [ -n "$VELOCITY_SOURCE" ] || say "  The published image is not available; building from source instead."
    say "  Building the image. This takes a few minutes the first time..."
    dc build app || die "Building the image failed. Scroll up for the error; a lack of memory (< 2 GB) or disk is the usual cause."
    ok "Image built"
  fi
}

wait_healthy() {
  say "  Waiting for Velocity to become healthy (up to ${VELOCITY_WAIT_SECONDS}s; first start runs database setup)..."
  waited=0
  while [ "$waited" -lt "$VELOCITY_WAIT_SECONDS" ]; do
    cid=$(dc ps -q app 2>/dev/null || true)
    status=''
    [ -z "$cid" ] || status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)
    [ "$status" = healthy ] && { ok "Velocity is healthy"; return 0; }
    sleep 3; waited=$((waited + 3))
  done
  say "" >&2
  dc logs --tail 40 app >&2 || true
  die "Velocity did not become healthy within ${VELOCITY_WAIT_SECONDS}s. The last log lines are above.
Try:  velocity logs -f      or      velocity doctor"
}

install_cli() {
  src="$VELOCITY_HOME/scripts/install/velocity"
  [ -f "$src" ] || { warn "CLI script missing from the release; skipping."; return 0; }
  mkdir -p "$VELOCITY_BIN_DIR" 2>/dev/null || true
  tmpcli=$(mktemp)
  sed "s|^DEFAULT_HOME=.*|DEFAULT_HOME=\"$VELOCITY_HOME\"|" "$src" > "$tmpcli"
  # Copy then rename so a running `velocity update` is never overwritten in place.
  if cp "$tmpcli" "$VELOCITY_BIN_DIR/.velocity.new" 2>/dev/null && chmod 755 "$VELOCITY_BIN_DIR/.velocity.new" \
     && mv -f "$VELOCITY_BIN_DIR/.velocity.new" "$VELOCITY_BIN_DIR/velocity"; then
    ok "Installed the 'velocity' command to $VELOCITY_BIN_DIR/velocity"
  else
    warn "Could not write $VELOCITY_BIN_DIR/velocity. Run it directly: $src"
  fi
  rm -f "$tmpcli"
}

main() {
  say "${B}Velocity installer${N}"
  if [ -z "$BIN_DIR_GIVEN" ]; then saved=$(env_value VELOCITY_BIN_DIR); [ -z "$saved" ] || VELOCITY_BIN_DIR=$saved; fi
  step "Checking this server"
  detect_platform
  ensure_privileges
  ensure_docker
  fetch_release
  [ -n "$NO_START" ] || check_ports
  write_env
  make_backup_dir
  install_cli
  if [ -n "$NO_START" ]; then
    say "\nVELOCITY_NO_START set: files and configuration are ready in $VELOCITY_HOME. Start later with: velocity start"
    return 0
  fi
  pull_or_build
  step "Starting Velocity"
  dc up -d || die "docker compose up failed. See the messages above."
  wait_healthy
  url=$(env_value APP_URL)
  say ""
  if [ "$FIRST_INSTALL" = 1 ]; then
    say "${G}${B}Velocity is running.${N}"
    say ""
    say "  Open:   ${B}${url:-http://localhost}${N}"
    say "  Then create your account (the first account becomes the owner)."
  else
    say "${G}${B}Velocity is up to date at ${url:-http://localhost}${N}"
  fi
  say ""
  say "  Manage your server with the 'velocity' command, e.g.  velocity status  /  velocity backup"
  say "  Run  velocity help  to see everything."
  if [ -n "$(env_value CADDY_DOMAIN)" ]; then
    say "  HTTPS: the certificate is issued automatically; the first visit may take a minute."
  fi
}

if [ "${VELOCITY_INSTALL_SOURCED:-}" != 1 ]; then main; fi
