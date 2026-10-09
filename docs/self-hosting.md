# Self-hosting Velocity

Velocity runs as three containers: **caddy** (reverse proxy, automatic TLS), **app**
(API, web UI, WebSockets, background jobs) and **postgres** (16). Zero telemetry: nothing
phones home, there is no analytics and no version check unless you enable one.

## Requirements

- A Linux server (x86-64 or ARM64). The installer sets up Docker if it is missing.

| | RAM | CPU | Disk |
|---|---|---|---|
| Minimum | 512 MB | 1 vCPU | 3 GB |
| Recommended | 1–2 GB | 1–2 vCPU | 20 GB (attachments and backups) |
| Building the image from source (only if no published image is available) | 3–4 GB | 2 vCPU | +5 GB |

Measured with 10,000 issues: all three containers use about 140 MB idle and about 200 MB under
steady use; the app ran with a 128 MB memory limit. Add disk as attachments and backups grow.

## Install

On a fresh Linux server, as root:

```sh
curl -fsSL https://raw.githubusercontent.com/saadiqhorton/velocity/main/scripts/install/install.sh | sudo sh
```

The installer:

1. checks the OS, and installs Docker with Docker's official script if it is missing (it asks first);
2. downloads Velocity into `/opt/velocity`;
3. asks one question, "Domain name (leave blank to use http://your-server-ip)". With a domain it checks that DNS
   points at this server and that ports 80/443 are free;
4. generates `.env` once, with random passwords and secrets (mode 600; an existing `.env` is never overwritten);
5. pulls the image (or builds it from source if no published image is available; this takes a few minutes),
   starts everything and waits until it is healthy;
6. installs the `velocity` command and prints the address to open.

Open the address and create your account; the first account is the owner. Sign-up then closes
(`DISABLE_SIGNUP=true`); invite members from settings. Re-running the installer upgrades in place.

Non-interactive use and options:

```sh
curl -fsSL <url>/install.sh | sudo sh -s -- --domain tracker.example.com --yes
```

| Flag / variable | Meaning |
|---|---|
| `--domain <name>` / `VELOCITY_DOMAIN` | serve `https://<name>` with an automatic certificate |
| `--yes` | never ask a question; accept defaults (installs Docker if missing) |
| `--no-start` / `VELOCITY_NO_START` | prepare files and `.env`, do not start |
| `VELOCITY_HOME` | install directory (default `/opt/velocity`) |
| `VELOCITY_REPO`, `VELOCITY_REF` | GitHub `owner/repo` and branch/tag to download (default `saadiqhorton/velocity`, the newest published release tag) |
| `VELOCITY_SOURCE` | copy from a local checkout instead of downloading (builds the image locally) |
| `VELOCITY_HTTP_PORT`, `VELOCITY_HTTPS_PORT` | host ports (default 80 / 443) |
| `VELOCITY_BIN_DIR` | where the `velocity` command is installed (default `/usr/local/bin`) |

## Managing your server

The installer adds a `velocity` command (run it as root or with `sudo`).

| Command | What it does |
|---|---|
| `velocity status` | containers, health, URL and last backup |
| `velocity url` | print the address the server is served at |
| `velocity logs [service] [-f]` | show logs (`app`, `postgres`, `caddy`); `-f` follows |
| `velocity start` / `stop` / `restart` | start, stop or restart everything |
| `velocity update` | back up, fetch the newest release (keeping `.env`), upgrade, wait until healthy |
| `velocity backup` | create a database backup now |
| `velocity backups` | list backups (nightly backups, kept 14 days, in `/opt/velocity/backups`) |
| `velocity restore <file\|latest>` | replace the database with a backup (asks first; saves a safety copy) |
| `velocity domain <name\|none>` | switch domain (updates `CADDY_DOMAIN` and `APP_URL`) or back to plain HTTP |
| `velocity reset-password <user>` | set a new password for a username or email and print it |
| `velocity users` | list users |
| `velocity doctor` | check Docker, containers, disk, DNS, ports, certificate and backup age |
| `velocity config` | edit `.env` in `$EDITOR`, then apply it |
| `velocity version` | installed release info |
| `velocity uninstall [--purge]` | remove containers and the command; `--purge` also deletes all data (double confirmation) |

Add `--yes` before a command to skip confirmations in scripts. `VELOCITY_HOME=<dir>` points the command
at a non-default install directory.

## Advanced / manual install

Without the installer, with Docker Engine 25+ and the Compose plugin:

```sh
git clone <repository-url> velocity && cd velocity
cp .env.example .env
```

Edit `.env`:

1. `POSTGRES_PASSWORD`: `openssl rand -hex 24` (the only required value)
2. `APP_SECRET`: `openssl rand -hex 32` (optional; the server generates one into `/data/app-secret` if unset)
3. `CADDY_DOMAIN`: your domain for automatic HTTPS (leave unset for plain HTTP on port 80)
4. `APP_URL`: optional; derived from `CADDY_DOMAIN` (`https://domain`, else `http://localhost`) if unset
5. `HTTP_PORT` / `HTTPS_PORT`: optional host ports (default 80 / 443)

```sh
docker compose up -d
docker compose ps          # wait for app to become "healthy"
```

Open `APP_URL` and complete the first-run wizard.

## Configuration

All configuration is environment variables in `.env`; `.env.example` documents each one
(purpose and default). Webhook signing secrets are encrypted at rest in the database; API keys
and session tokens are stored as hashes. Highlights:

| Variable | Notes |
|---|---|
| `APP_URL`, `APP_SECRET` | required by the app |
| `POSTGRES_PASSWORD` | required for the bundled Compose database; set `DATABASE_URL` to use an external Postgres 16 instance |
| `CADDY_DOMAIN` | enables automatic HTTPS |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `EXPORT_DIR`, `BACKUP_DIR` | Docker defaults are under `app_data` (`/data`); `BACKUP_DIR` defaults to `/data/backups` in the image |
| `DISABLE_SIGNUP` | default `true` |
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` | optional, advanced alternative to in-app setup (see [GitHub integration](#github-integration)); `GITHUB_APP_SECRET` is accepted as an alias of `GITHUB_APP_CLIENT_SECRET` |
| `MCP_HTTP_ENABLED`, `MCP_HTTP_TOKEN` | `/mcp` HTTP transport is on by default (API key via `X-Api-Key` or `Bearer vel_…`); `MCP_HTTP_ENABLED=0` disables it; `MCP_HTTP_TOKEN` (24+ chars) optionally adds a required bearer token |
| `TRUST_PROXY` | Compose sets this to `1` for Caddy; set it when running behind a trusted reverse proxy |
| `METRICS_TOKEN` | optional Bearer token for `/metrics`; set one when scraping through a forwarded request |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | default `0` (SSRF protection) |
| `LOG_LEVEL` | server log verbosity |
| `SENTRY_DSN` | reserved; Sentry reporting is not integrated yet |
| `VELOCITY_BACKUP_BEFORE_MIGRATE`, `BACKUP_DIR` | when enabled, runs `pg_dump` on every non-worker app startup before checking or applying migrations |

After editing `.env`: `docker compose up -d` (containers are recreated when needed).

## GitHub integration

Recommended: set up the GitHub App from the UI. As the workspace owner, open Settings -> GitHub and
choose "Set up GitHub" (personal account, or enter an organization name). Velocity submits an App
manifest to GitHub, you approve it there, and Velocity stores the returned credentials. No `.env`
edits or restart are needed. Then install the App on your repositories from the same page.

- The App name defaults to `Velocity`. GitHub App names are globally unique, so if the name is taken,
  rename it on GitHub's registration form before approving.
- `APP_URL` must be reachable from github.com (webhooks are delivered to `APP_URL/api/github/webhook`).
  On `localhost` the setup completes but no events arrive; use a public URL or a tunnel.
- Requested permissions: issues write, pull requests read, metadata read. Events: pull_request,
  pull_request_review, push, issues.
- Credentials (private key, webhook secret, client secret) are encrypted at rest with a key derived
  from `APP_SECRET`. If you rotate `APP_SECRET`, the stored credentials can no longer be decrypted:
  Velocity logs a warning and falls back to the `GITHUB_*` env vars (or treats GitHub as not
  configured if they are unset). Restore the old secret, or remove the App in Settings -> GitHub
  and run setup again. The Settings UI does not yet show a notice for this state.
- Precedence: an App created in-app overrides `GITHUB_*` env vars. "Remove" in Settings -> GitHub
  deletes the stored App (installs on GitHub are not touched) and falls back to the env vars, if set.

Advanced alternative: create the App yourself on GitHub and set `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` (and optionally the client secret) in `.env`.

## HTTPS with Caddy

1. Point a DNS A/AAAA record for your domain at the host.
2. Open ports 80 and 443 (and 443/udp for HTTP/3).
3. Set `CADDY_DOMAIN=velocity.example.com` and `APP_URL=https://velocity.example.com`.
4. `docker compose up -d`.

Caddy obtains and renews a Let's Encrypt certificate automatically and stores it in the
`caddy_data` volume (do not delete that volume, or you may hit rate limits). It forwards
WebSocket upgrades (`/graphql`), compresses responses and sets security headers; the app
sets its own Content-Security-Policy. Uploads are capped at 26 MB by Caddy; raise
`request_body max_size` in `Caddyfile` together with `MAX_UPLOAD_MB`.

Already behind another reverse proxy or load balancer? Remove the `caddy` service, publish
port 3000 for the `app` service (for example, `3000:3000`) and proxy to it, forwarding
`X-Forwarded-*` headers and WebSocket upgrades. Compose sets `TRUST_PROXY=1`; only use this
behind a proxy you trust.

## Upgrades

Set `VELOCITY_BACKUP_BEFORE_MIGRATE=1` in `.env` before upgrading. Keep a copy of the
resulting dump outside the host, and back up `app_data` as well for attachments. Upgrade
one release at a time and check `docker compose ps` and `/readyz` after each step.

For the checkout-based Compose installation above:

```sh
git pull
docker compose up -d --build
docker compose ps
```

The Compose file builds from the checkout. When using a published image, set
`VELOCITY_IMAGE` to the next release tag and use `docker compose pull app && docker compose up -d`
instead. No public release image has been verified yet. Migrations run automatically on
boot under a Postgres advisory lock. A failed backup prevents the app from starting;
inspect `docker compose logs app` before retrying.

The repository's `scripts/deploy/upgrade-smoke.sh` checks the upgrade from `b622999`
to the current checkout using a disposable Compose project. It creates an issue on the
old image, checks that the new image migrates and preserves it, validates the automatic
pre-migration dump in `/data/backups`, restores that dump into another database, and
boots the current image against the restored database. It requires Docker, Compose,
`git`, `node`, `pnpm`, `curl` and `openssl`; it builds the baseline API with the current
`server-runtime` Docker target because that checkpoint predates the web UI, and repairs
the baseline's deployment manifest in a temporary checkout. Run it from
the repository with `scripts/deploy/upgrade-smoke.sh`. The script uses an isolated
Compose project and removes its volumes when it finishes. Set `UPGRADE_PORT` if its
chosen loopback port is in use.

## API-only server image

The `server-runtime` Docker target builds the API runtime without building or copying the web UI.
Use it for API and backup-path diagnostics without building the web bundle:

```sh
docker build --target server-runtime -t velocity-server-runtime:check .
```

To start this image, provide the usual `DATABASE_URL`, `APP_SECRET` and `APP_URL`, connect it to
Postgres, and mount `/data` as a writable volume. Then check `/healthz` and `/readyz`. This image
does not include `web-dist`, so `/` responds with a “web app has not been built yet” message; it is
not a complete user-facing deployment. The default final Docker target includes the web build.

## Backups

State lives in two volumes: `pg_data` (database) and `app_data` (attachments, exports, backups).

With the installer, backups are plain files in `/opt/velocity/backups` on the host: one is taken nightly at
03:00 UTC and kept 14 days; `velocity backup` makes one now, and `velocity restore <file|latest>` restores one.
The folder is private (mode 700, owned by the container user) and survives `velocity uninstall --purge`
(delete it yourself with `sudo rm -rf /opt/velocity/backups` if you want it gone).

To keep a copy off the server, copy that folder, for example
`rsync -a /opt/velocity/backups/ user@other:velocity-backups/`, or point any backup tool at it.

Upgrading from an older installer: backups taken before this change stay in the `app_data` volume
(`/data/backups`); new ones go to the host folder. Copy old ones out if you want them, e.g.
`docker compose cp app:/data/backups/. /opt/velocity/backups/` (then `chown 10001:10001` them).
Manual Compose users: set `VELOCITY_BACKUP_DIR` in `.env` to a host folder owned by uid 10001, or leave it
unset to use the `backups_data` volume.

Running `velocity reset-password` over `ssh` from a script or one-shot command needs `</dev/null`
(e.g. `ssh host 'velocity reset-password alice </dev/null'`).

Automatic startup dump: set `VELOCITY_BACKUP_BEFORE_MIGRATE=1` in `.env`. On every non-worker app
startup, before checking or applying migrations, the app runs `pg_dump` into `BACKUP_DIR` (Docker
default `/data/backups`, inside `app_data`). This can create a dump even when no migration is pending;
copy the files off the host and manage old dumps to control disk use.

Manual database backup:

```sh
docker compose exec -T postgres pg_dump -U velocity -Fc velocity > velocity-$(date +%F).dump
```

To copy an automatic dump out of `app_data`, find its name with
`docker compose exec app ls -lh /data/backups`, then use
`docker compose cp app:/data/backups/<filename>.dump ./<filename>.dump`.
Before restoring, save the current database and attachment volume separately. A
database dump does not contain uploaded files. Stop the app and any `scale` worker so
there are no writers, then restore into a new, empty database:

```sh
docker compose stop app              # also stop worker if the scale profile is in use
docker compose exec -T postgres dropdb -U velocity --if-exists velocity
docker compose exec -T postgres createdb -U velocity velocity
docker compose exec -T postgres pg_restore -U velocity -d velocity --no-owner --exit-on-error < velocity-2026-10-05.dump
docker compose up -d app
docker compose ps                     # wait for app to become healthy
```

Use your actual dump filename. Restoring a pre-upgrade dump with the newer app causes
pending migrations to run again on startup. Check the restored issue and attachment
files before reopening access to users.

Attachments:

```sh
docker run --rm -v velocity_app_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/app_data-$(date +%F).tgz -C /data .
```

(The volume name is prefixed with your compose project name; check `docker volume ls`.)
Workspace owners can also trigger a full JSON export from settings. Test your restores.

## Scaling: the `scale` profile

One `app` process runs the API, web and background jobs; that is enough for most teams.
To add dedicated job capacity:

```sh
docker compose --profile scale up -d
```

This starts a `worker` container (same image, `VELOCITY_ROLE=worker`, no ports). pg-boss supports multiple
pollers safely. To dedicate `app` to HTTP only, set `VELOCITY_ROLE=web` in `.env` and restart.

## Virus scanning: the `clamav` profile

```sh
docker compose --profile clamav up -d
```

Then add to `.env` and run `docker compose up -d` again so `app` picks them up:

```
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
```

ClamAV needs about 1 GB of extra RAM and downloads signatures on first start (a few minutes; the
container is healthy when ready). **Limitation when disabled (the default): uploads are not scanned for
malware.** The MIME allowlist, size limit, EXIF stripping for images and download headers still apply, but
if users upload files that other people open, enable ClamAV.

## Security notes

- The app container runs as uid 10001 with a read-only root filesystem, all capabilities dropped and `no-new-privileges`.
  Only `/data` and `/tmp` are writable.
- Only Caddy publishes ports. Postgres and the app are reachable only on the compose network.
- Keep `.env` private (`chmod 600 .env`) and out of version control.
- Outbound webhooks cannot target private addresses unless `ALLOW_PRIVATE_WEBHOOK_TARGETS=1`.

## Monitoring

- `GET /healthz` (process up) and `GET /readyz` (database and storage OK) for health checks.
- `GET /metrics` serves Prometheus metrics. Caddy always blocks this path; scrape `app:3000/metrics`
  directly from inside the Compose network. If `METRICS_TOKEN` is set, send it as a Bearer token.
  Without a token, the app rejects requests that include `X-Forwarded-For`.
- Logs are structured JSON on stdout: `docker compose logs -f app`.

## Troubleshooting

Start with `velocity doctor`; it checks the common causes below.

**DNS not pointing at the server.** HTTPS never appears and `velocity doctor` reports the domain does not
resolve or points elsewhere. Create an `A` record for the domain with your DNS provider pointing at the
server's public IP, wait a few minutes, then `velocity restart`. Caddy retries automatically.

**Ports 80/443 already in use.** The installer stops and names the port. Stop the other web server
(`sudo systemctl stop nginx apache2`), or install with other ports
(`VELOCITY_HTTP_PORT=8080 VELOCITY_HTTPS_PORT=8443`). Automatic HTTPS needs 80 and 443 reachable from the internet.

**Forgot password.** `velocity users` lists accounts; `velocity reset-password <username-or-email>` prints a new one.

**Restore from backup.** `velocity backups`, then `velocity restore latest` (or a file name). The current
database is saved to `/opt/velocity/backups/` first. Restoring does not touch uploaded files.

**Changing domain.** `velocity domain new.example.com` (or `velocity domain none` for plain HTTP). If you
set up the GitHub integration, re-run its setup in Settings -> GitHub because the webhook/callback URLs change.

**Updating.** `velocity update` backs up first. If the new version misbehaves, `velocity restore latest`
and reinstall the previous release with `VELOCITY_REF=<tag>`.

Manual-install symptoms:

| Symptom | Check |
|---|---|
| `docker compose up` fails with `set POSTGRES_PASSWORD in .env` | You did not copy `.env.example` to `.env`. |
| `app` restarts immediately | `docker compose logs app`. Usually `APP_SECRET` shorter than 32 characters or a bad `DATABASE_URL`. |
| `app` unhealthy on first start | Migrations may still be running; the health check allows 40 s. Large upgrades can take longer. |
| Browser shows certificate warnings or HTTPS never appears | DNS must point at the host and ports 80/443 must be reachable. See `docker compose logs caddy`. |
| Login loops or CSRF errors | `APP_URL` must exactly match the URL in the browser (scheme and host). |
| Realtime updates stop | Another proxy in front of Caddy is not forwarding WebSocket upgrades on `/graphql`. |
| Upload rejected with 413 | Raise both `MAX_UPLOAD_MB` and the Caddyfile `max_size`. |
| Backups missing | Requires `VELOCITY_BACKUP_BEFORE_MIGRATE=1`; check `BACKUP_DIR` and app startup logs. |
| Permission denied writing `/data` | The volume must be writable by uid 10001: `docker compose run --rm --user root app chown -R 10001:10001 /data`. |

Reset everything (destroys all data): `docker compose down -v`.
