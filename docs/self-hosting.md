# Self-hosting Velocity

Velocity runs as three containers: **caddy** (reverse proxy, automatic TLS), **app**
(API, web UI, WebSockets, background jobs) and **postgres** (16). Zero telemetry: nothing
phones home, there is no analytics and no version check unless you enable one.

## Requirements

- Linux host with Docker Engine 25+ and the Compose plugin (v2.24+).
- As a starting point, allow 2 vCPU, 4 GB RAM and 20 GB disk for the app and database.
  Actual needs depend on workload; monitor usage and add disk for attachments and backups.

## Install

```sh
git clone <repository-url> velocity && cd velocity
cp .env.example .env
```

Edit `.env`:

1. `POSTGRES_PASSWORD`: `openssl rand -hex 24`
2. `APP_SECRET`: `openssl rand -hex 32` (at least 32 characters; keep it stable)
3. `APP_URL`: `http://localhost` for a local trial, or `https://your.domain`
4. `CADDY_DOMAIN`: your domain for automatic HTTPS (leave unset for plain HTTP on port 80)

```sh
docker compose up -d
docker compose ps          # wait for app to become "healthy"
```

Open `APP_URL` and complete the first-run wizard. Sign-up is closed after the first user
(`DISABLE_SIGNUP=true`); invite members from settings.

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
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` | optional GitHub integration (`GITHUB_APP_SECRET` is accepted as an alias of `GITHUB_APP_CLIENT_SECRET`) |
| `MCP_HTTP_ENABLED`, `MCP_HTTP_TOKEN` | optional HTTP transport for remote agents |
| `TRUST_PROXY` | Compose sets this to `1` for Caddy; set it when running behind a trusted reverse proxy |
| `METRICS_TOKEN` | optional Bearer token for `/metrics`; set one when scraping through a forwarded request |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | default `0` (SSRF protection) |
| `LOG_LEVEL` | server log verbosity |
| `SENTRY_DSN` | reserved; Sentry reporting is not integrated yet |
| `VELOCITY_BACKUP_BEFORE_MIGRATE`, `BACKUP_DIR` | when enabled, runs `pg_dump` on every non-worker app startup before checking or applying migrations |

After editing `.env`: `docker compose up -d` (containers are recreated when needed).

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
