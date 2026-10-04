# Self-hosting Velocity

Velocity runs as three containers: **caddy** (reverse proxy, automatic TLS), **app**
(API, web UI, WebSockets, background jobs) and **postgres** (16). Zero telemetry: nothing
phones home, there is no analytics and no version check unless you enable one.

## Requirements

- Linux host with Docker Engine 24+ and the Compose plugin (v2.24+).
- Sizing: 1 vCPU, 1 GB RAM and 2 GB disk comfortably run a workspace of about 10,000 issues.
  Add disk for attachments and backups; scale CPU and RAM roughly linearly with active users.

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
(purpose and default). No secrets are stored in the database. Highlights:

| Variable | Notes |
|---|---|
| `APP_URL`, `APP_SECRET`, `POSTGRES_PASSWORD` | required |
| `CADDY_DOMAIN` | enables automatic HTTPS |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `EXPORT_DIR` | under the `app_data` volume (`/data`) |
| `DISABLE_SIGNUP` | default `true` |
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` | optional GitHub integration (`GITHUB_APP_SECRET` is accepted as an alias of `GITHUB_APP_CLIENT_SECRET`) |
| `MCP_HTTP_ENABLED`, `MCP_HTTP_TOKEN` | optional HTTP transport for remote agents |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | default `0` (SSRF protection) |
| `LOG_LEVEL`, `SENTRY_DSN` | `SENTRY_DSN` is opt-in |
| `VELOCITY_BACKUP_BEFORE_MIGRATE` | pg_dump before migrations |

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
`app:3000` from the compose file and proxy to it, forwarding `X-Forwarded-*` headers and WebSocket upgrades.

## Upgrades

```sh
docker compose pull
docker compose up -d
```

(If you build locally from a checkout instead: `git pull && docker compose build && docker compose up -d`.)
Migrations run automatically on boot under a Postgres advisory lock, so they are safe with several replicas.
Releases keep N-1 compatibility: upgrade one release at a time. Take a backup first (below).

## Backups

State lives in two volumes: `pg_data` (database) and `app_data` (attachments, exports, backups).

Automatic pre-migration dump: set `VELOCITY_BACKUP_BEFORE_MIGRATE=1` in `.env`. On boot, before applying
migrations, the app runs `pg_dump` into `/data/backups/` (inside `app_data`). Copy those files off the host.

Manual database backup and restore:

```sh
docker compose exec -T postgres pg_dump -U velocity -Fc velocity > velocity-$(date +%F).dump
# restore into an empty database:
docker compose exec -T postgres pg_restore -U velocity -d velocity --clean --if-exists < velocity-2026-01-01.dump
```

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
- `GET /metrics` serves Prometheus metrics. Scrape it from inside the compose network, and do not expose it publicly (block `/metrics` in the Caddyfile if your app build does not require auth for it).
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
| Backups missing | Requires `VELOCITY_BACKUP_BEFORE_MIGRATE=1`, and only run when migrations are pending. |
| Permission denied writing `/data` | The volume must be writable by uid 10001: `docker compose run --rm --user root app chown -R 10001:10001 /data`. |

Reset everything (destroys all data): `docker compose down -v`.
