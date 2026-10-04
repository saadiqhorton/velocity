# Velocity

Velocity is an open-source, self-hostable issue tracker for individuals and small teams. It combines teams, issues, cycles, projects, a public GraphQL API, GitHub integration, and an MCP server. The project name is a working title; see [BRANDING.md](BRANDING.md).

Licensed under [AGPL-3.0-or-later](LICENSE).

## Quick start

The supported self-hosting path is Docker Compose. Copy the example environment file, set a long random `APP_SECRET` (at least 32 characters), and set `CADDY_DOMAIN` to `localhost` for local use:

```sh
cp .env.example .env
```

Edit `.env`, then start the services:

```sh
docker compose up -d
```

Open `http://localhost` and complete first-run setup. For a public domain, point DNS at the host and set `CADDY_DOMAIN` to that hostname; Caddy provisions HTTPS. Keep `.env`, the PostgreSQL volume, and the uploads volume backed up. See [docs/self-hosting.md](docs/self-hosting.md) for configuration, upgrades, and backup details.

## Documentation

- [API guide](docs/api.md): authentication, GraphQL, filters, rate limits, and webhooks
- [Import guide](docs/import.md): CSV and API import options
- [Architecture](docs/architecture.md): runtime, packages, and implementation deviations
- [Self-hosting](docs/self-hosting.md): deployment and operations
- [Agent guide](docs/agents.md): MCP tools and agent usage
- [Specification](SPEC.md): product and engineering requirements

## Development

Requirements: Node.js 22+, pnpm 11, and PostgreSQL 16. Create a development database and configure the server environment:

```sh
pnpm install
export DATABASE_URL=postgres://velocity:velocity@localhost:5432/velocity_dev
export APP_URL=http://localhost:3000
export APP_SECRET="$(openssl rand -hex 32)"
export UPLOAD_DIR=./data/uploads EXPORT_DIR=./data/exports
pnpm --filter @velocity/server dev
```

The server runs migrations on startup. To seed a fresh development database, run `pnpm --filter @velocity/server seed -- --issues 10000`; the demo owner is `demo` with password `correct-horse-battery-staple`. Use this only for local development and disposable benchmark databases. The web interface is developed separately; its current completeness and browser verification are tracked in [HANDOFF.md](HANDOFF.md). When running the Vite client, set `APP_URL=http://localhost:5173` so cookie-authenticated WebSockets accept the dev-server origin.

Useful commands:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @velocity/server seed -- --issues 10000
```

Database-backed tests require PostgreSQL; details and current verification status are in [HANDOFF.md](HANDOFF.md). No test or build result is implied by these instructions.

## Project status

Velocity is under active development. Backend packages and the API are implemented, and the server integration suite currently has 12 passing tests. The web interface and its browser-level verification are still in progress. See [HANDOFF.md](HANDOFF.md) for the current work status and known gaps.
