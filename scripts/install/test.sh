#!/bin/sh
# Hermetic tests for install.sh and the velocity CLI (no real Docker, network or root needed).
#   sh scripts/install/test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pass=0; fail=0
t() { # name, command...
  name=$1; shift
  if "$@" >"$work/out" 2>&1; then pass=$((pass+1)); echo "ok   $name"
  else fail=$((fail+1)); echo "FAIL $name"; sed 's/^/     | /' "$work/out"; fi
}

# fake binaries
mkdir -p "$work/bin" "$work/src/scripts/install"
cat > "$work/bin/docker" <<'EOF'
#!/bin/sh
case "$1" in info|compose) exit 0 ;; esac
exit 0
EOF
cat > "$work/bin/curl" <<'EOF'
#!/bin/sh
echo 203.0.113.9
EOF
cat > "$work/bin/getent" <<'EOF'
#!/bin/sh
echo "203.0.113.9 STREAM $2"
EOF
cat > "$work/bin/chown" <<EOF
#!/bin/sh
echo "chown \$*" >> "$work/chown.log"
EOF
chmod +x "$work/bin/"*
echo "services: {}" > "$work/src/docker-compose.yml"
cp "$here/velocity" "$work/src/scripts/install/velocity"
cp "$here/install.sh" "$work/src/scripts/install/install.sh"
echo '{"name":"x",
  "version": "9.9.9",
  "private": true}' > "$work/src/package.json"

# --- helper functions (sourced) ---
. /dev/null
check_helpers() (
  VELOCITY_INSTALL_SOURCED=1; export VELOCITY_INSTALL_SOURCED
  . "$here/install.sh"
  valid_domain tracker.example.com || exit 1
  valid_domain localhost && exit 1
  valid_domain 'a b.com' && exit 1
  valid_domain '-x.com' && exit 1
  valid_port 8080 || exit 1
  valid_port 0 && exit 1
  valid_port 99999 && exit 1
  valid_port abc && exit 1
  [ "$(random_hex 32 | tr -d "\n" | wc -c)" -eq 64 ] || exit 1
  [ "$(random_hex 24)" != "$(random_hex 24)" ] || exit 1
)
t "helpers: domain/port validation and random_hex" check_helpers

run_install() { # extra args...
  env PATH="$work/bin:$PATH" VELOCITY_HOME="$work/home" VELOCITY_SOURCE="$work/src" VELOCITY_BIN_DIR="$work/binout" \
    VELOCITY_NO_START=1 VELOCITY_HTTP_PORT=8088 VELOCITY_HTTPS_PORT=8443 sh "$here/install.sh" "$@"
}

t "unknown option fails" sh -c "! sh '$here/install.sh' --bogus"
t "bad domain rejected" sh -c "! PATH='$work/bin':\$PATH VELOCITY_HOME='$work/h2' VELOCITY_SOURCE='$work/src' VELOCITY_BIN_DIR='$work/b2' VELOCITY_NO_START=1 sh '$here/install.sh' --yes --domain 'not a domain'"

t "install with --domain generates .env" run_install --yes --domain Tracker.Example.com
env_file="$work/home/.env"
t ".env has domain and https APP_URL" sh -c "grep -qx 'CADDY_DOMAIN=tracker.example.com' '$env_file' && grep -qx 'APP_URL=https://tracker.example.com:8443' '$env_file'"
t ".env has ports" sh -c "grep -qx 'HTTP_PORT=8088' '$env_file' && grep -qx 'HTTPS_PORT=8443' '$env_file'"
t ".env secrets are long" sh -c "[ \$(sed -n 's/^APP_SECRET=//p' '$env_file' | tr -d '\n' | wc -c) -ge 32 ] && [ \$(sed -n 's/^POSTGRES_PASSWORD=//p' '$env_file' | tr -d '\n' | wc -c) -ge 24 ]"
t ".env is mode 600" sh -c "[ \$(stat -c %a '$env_file') = 600 ]"
t "release files copied, version recorded" sh -c "[ -f '$work/home/docker-compose.yml' ] && grep -qx 'version=9.9.9' '$work/home/.velocity-release'"
t "release file records a local source exactly once" sh -c "grep -qx 'repo=local:$work/src' '$work/home/.velocity-release'"
t "CLI installed with baked home" sh -c "[ -x '$work/binout/velocity' ] && grep -qx 'DEFAULT_HOME=\"$work/home\"' '$work/binout/velocity'"

t ".env has VELOCITY_BACKUP_DIR" grep -qx "VELOCITY_BACKUP_DIR=$work/home/backups" "$env_file"
t "backup dir is mode 700" sh -c "[ \$(stat -c %a '$work/home/backups') = 700 ]"
t "backup dir chown to 10001:10001 attempted" grep -qx 'chown 10001:10001 .*/home/backups' "$work/chown.log"

cp "$env_file" "$work/env.before"
echo "# user edit" >> "$env_file"; cp "$env_file" "$work/env.before"
t "re-run keeps existing .env" run_install --yes --domain other.example.org
t ".env unchanged on re-run" cmp "$env_file" "$work/env.before"

# existing install without the var: only that line is appended
grep -v '^VELOCITY_BACKUP_DIR=' "$env_file" > "$work/env.old"; cp "$work/env.old" "$env_file"
t "re-run adds missing VELOCITY_BACKUP_DIR" run_install --yes
t "only the backup var was added" sh -c "cp '$env_file' '$work/env.new'; echo VELOCITY_BACKUP_DIR=$work/home/backups >> '$work/env.old'; cmp '$work/env.old' '$work/env.new'"

rm -rf "$work/home" "$work/binout"
t "no domain -> plain http on detected IP" run_install --yes
t "ip-based APP_URL and empty CADDY_DOMAIN" sh -c "grep -qx 'CADDY_DOMAIN=' '$env_file' && grep -qx 'APP_URL=http://203.0.113.9:8088' '$env_file'"
t "VELOCITY_DOMAIN env respected" sh -c "rm -rf '$work/home' && VELOCITY_DOMAIN=env.example.com PATH='$work/bin':\$PATH VELOCITY_HOME='$work/home' VELOCITY_SOURCE='$work/src' VELOCITY_BIN_DIR='$work/binout' VELOCITY_NO_START=1 sh '$here/install.sh' --yes && grep -qx 'CADDY_DOMAIN=env.example.com' '$work/home/.env'"

# --- CLI ---
t "CLI help lists commands" sh -c "'$here/velocity' help | grep -q 'reset-password'"
t "CLI unknown command exits 2" sh -c "'$here/velocity' nope >/dev/null 2>&1; [ \$? -eq 2 ]"
t "CLI errors clearly without install" sh -c "! PATH='$work/bin':\$PATH VELOCITY_HOME='$work/none' '$here/velocity' status 2>&1 | grep -q 'unexpected'; VELOCITY_HOME='$work/none' PATH='$work/bin':\$PATH '$here/velocity' status 2>&1 | grep -q 'No Velocity install'"

# restore: the safety dump (password hashes, tokens) must be owner-only
mkdir -p "$work/rbin" "$work/rhome"
cat > "$work/rbin/docker" <<'FAKE'
#!/bin/sh
case "$*" in
  *"admin-cli.js backups"*) printf 'a.dump\t10\t2026-01-01T00:00:00Z\n' ;;
  *pg_dump*) echo fake-dump ;;
  *"cat > /data/backups/"*) for a; do :; done; f=${a##*> }; ( umask 077; cat > "$FAKE_BACKUPS/${f##*/}" ) ;;
  *" ps -q"*) echo cid1 ;;
  "inspect "*) echo healthy ;;
  *pg_restore*) cat >/dev/null ;;
esac
exit 0
FAKE
chmod +x "$work/rbin/docker"; echo "services: {}" > "$work/rhome/docker-compose.yml"
restore_safety_private() {
  mkdir -p "$work/rhome/backups"
  ( umask 022; env FAKE_BACKUPS="$work/rhome/backups" PATH="$work/rbin:$PATH" VELOCITY_HOME="$work/rhome" "$here/velocity" restore latest --yes </dev/null ) || return 1
  f=$(ls "$work"/rhome/backups/pre-restore-*.dump) || return 1
  [ "$(stat -c %a "$f")" = 600 ] && [ -s "$f" ]
}
t "restore: safety dump is written owner-only" restore_safety_private

uninstall_keeps_data() {
  mkdir -p "$work/ubin"; : > "$work/ubin/velocity"
  out=$(env PATH="$work/rbin:$PATH" VELOCITY_HOME="$work/rhome" VELOCITY_BIN_DIR="$work/ubin" "$here/velocity" uninstall --yes </dev/null 2>&1) || return 1
  [ ! -e "$work/ubin/velocity" ] && [ -f "$work/rhome/docker-compose.yml" ] || return 1
  # the CLI was just removed, so the hint must not tell the user to run it directly
  case "$out" in *"re-run the installer"*) return 0 ;; *) return 1 ;; esac
}
t "uninstall keeps files and gives a usable purge hint" uninstall_keeps_data

purge_keeps_backups() {
  mkdir -p "$work/phome/backups" "$work/pbin"; : > "$work/pbin/velocity"
  echo services: {} > "$work/phome/docker-compose.yml"; echo "VELOCITY_BACKUP_DIR=$work/phome/backups" > "$work/phome/.env"
  echo x > "$work/phome/backups/velocity-1.dump"
  out=$(env PATH="$work/rbin:$PATH" VELOCITY_HOME="$work/phome" VELOCITY_BIN_DIR="$work/pbin" "$here/velocity" uninstall --purge --yes </dev/null 2>&1) || return 1
  [ -f "$work/phome/backups/velocity-1.dump" ] && [ ! -e "$work/phome/.env" ] && [ ! -e "$work/phome/docker-compose.yml" ] || return 1
  case "$out" in *"rm -rf $work/phome/backups"*) return 0 ;; *) return 1 ;; esac
}
t "uninstall --purge keeps the backups folder and says how to delete it" purge_keeps_backups

# --- real-user regressions: logging fake docker, start path enabled ---
mkdir -p "$work/lbin"; cp "$work/bin/"* "$work/lbin/"
cat > "$work/lbin/docker" <<'FAKE'
#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$*" in
  *"admin-cli.js backup"*) if [ -n "${FAKE_EACCES:-}" ]; then echo "backup failed: EACCES: permission denied, open '/data/backups/x.dump'" >&2; exit 1; fi; echo x.dump ;;
  *" ps -q"*) echo cid1 ;;
  "inspect "*) echo healthy ;;
esac
exit 0
FAKE
chmod +x "$work/lbin/docker"
lenv() { env FAKE_LOG="$work/docker.log" PATH="$work/lbin:$PATH" VELOCITY_HOME="$work/lhome" "$@"; }

: > "$work/docker.log"
lenv VELOCITY_SOURCE="$work/src" VELOCITY_BIN_DIR="$work/lbinout" VELOCITY_HTTP_PORT=18088 VELOCITY_HTTPS_PORT=18443 \
  sh "$here/install.sh" --yes > "$work/first.out" 2>&1
t "first install prints the create-account text" grep -q 'Then create your account' "$work/first.out"
t "install runs 'compose up' exactly once" sh -c "[ \$(grep -c ' up -d' '$work/docker.log') -eq 1 ]"
t "custom VELOCITY_BIN_DIR is saved in .env" grep -qx "VELOCITY_BIN_DIR=$work/lbinout" "$work/lhome/.env"
t "default VELOCITY_BIN_DIR is not saved" sh -c "PATH='$work/lbin':\$PATH VELOCITY_HOME='$work/dhome' VELOCITY_SOURCE='$work/src' VELOCITY_BIN_DIR=/usr/local/bin VELOCITY_NO_START=1 sh '$here/install.sh' --yes >/dev/null 2>&1; [ -f '$work/dhome/.env' ] && ! grep -q '^VELOCITY_BIN_DIR=' '$work/dhome/.env'"

rm -f "$work/lbinout/velocity"
lenv "$here/velocity" update --yes > "$work/update.out" 2>&1 || cat "$work/update.out"
t "update reuses the saved VELOCITY_BIN_DIR" test -x "$work/lbinout/velocity"
t "update says up to date, not the first-install text" sh -c "grep -q 'up to date at' '$work/update.out' && ! grep -q 'Then create your account' '$work/update.out'"

echo "VELOCITY_BACKUP_DIR=$work/lhome/backups" >> "$work/lhome/.env"; mkdir -p "$work/lhome/backups"
t "backup: permission error gives the chown fix" sh -c "FAKE_EACCES=1 FAKE_LOG='$work/docker.log' PATH='$work/lbin':\$PATH VELOCITY_HOME='$work/lhome' '$here/velocity' backup 2>&1 | grep -q \"isn't writable by Velocity. Fix: sudo chown 10001:10001 $work/lhome/backups\""
t "doctor: backups folder not owned by 10001 fails with the fix" sh -c "FAKE_LOG='$work/docker.log' PATH='$work/lbin':\$PATH VELOCITY_HOME='$work/lhome' '$here/velocity' doctor 2>&1 | grep -q 'Fix: sudo chown 10001:10001 $work/lhome/backups'"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
