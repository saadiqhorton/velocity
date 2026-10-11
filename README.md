# Velocity

Velocity is an open-source, self-hostable issue tracker for individuals and small teams. It combines teams, issues, cycles, projects, a public GraphQL API, GitHub integration, and an MCP server. The project name is a working title; see [BRANDING.md](BRANDING.md).

Licensed under [AGPL-3.0-or-later](LICENSE).

![Velocity issue list: Engineering issues grouped by status, with priorities, labels, and cycle progress](docs/images/dark-1440-list.png)

## What it looks like

| Board | Issue detail |
| --- | --- |
| ![Kanban board with Todo, In Progress, and Done columns](docs/images/dark-1440-board.png) | ![Issue detail panel open beside the issue list](docs/images/dark-1440-panel.png) |
| Issues grouped by status; drag to move. | Open an issue without leaving the list. |

| Command palette | Light theme |
| --- | --- |
| ![Command palette listing actions, views, and their shortcuts](docs/images/dark-1440-palette.png) | ![The same issue list in the light theme](docs/images/light-1440-list.png) |
| `Ctrl+K` reaches every action and view. | Both themes ship; light is not an afterthought. |

## Quick start

On a fresh Linux server (a small VPS is enough), run one command as root:

```sh
curl -fsSL https://raw.githubusercontent.com/saadiqhorton/velocity/main/scripts/install/install.sh | sudo sh
```

It installs Docker if needed, asks for an optional domain name (blank means plain HTTP on the server's IP), and starts Velocity.

1. Open the address it prints and create your account (the first account is the owner).
2. Manage the server with the `velocity` command: `velocity status`, `velocity backup`, `velocity update`.
3. Run `velocity help` for everything else, including `velocity reset-password`.

Prefer to do it by hand? See the manual path in [docs/self-hosting.md](docs/self-hosting.md#advanced--manual-install).

## Documentation

- [API guide](docs/api.md): authentication, GraphQL, filters, rate limits, and webhooks
- [Import guide](docs/import.md): CSV and API import options
- [Architecture](docs/architecture.md): runtime, packages, and implementation deviations
- [Self-hosting](docs/self-hosting.md): deployment and operations
- [Release verification](docs/release.md): image, SBOM, signing, and attestation
- [Security policy](SECURITY.md): reporting a vulnerability, supported versions, operator hardening
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

The server runs migrations on startup. To seed a fresh development database, run `pnpm --filter @velocity/server seed -- --issues 10000`; the demo owner is `demo` with password `correct-horse-battery-staple`. Use this only for local development and disposable benchmark databases. Build the web interface with `pnpm --filter @velocity/web build`; the production server serves that build. When running the Vite client, set `APP_URL=http://localhost:5173` so cookie-authenticated WebSockets accept the dev-server origin.

Useful commands:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @velocity/server seed -- --issues 10000
```

Database-backed tests require PostgreSQL; see [CONTRIBUTING.md](CONTRIBUTING.md) for the container and setup. No test or build result is implied by these instructions.

The screenshots above are captured from a seeded dev instance. To regenerate them:

```sh
node apps/web/scripts/screenshots.mjs http://localhost:5173 \
  --only=list,board,panel,palette --sizes=1440x900 --themes=dark,light --out=docs/images
```

## Project status

The v1 feature set is implemented. Browser E2E runs cover Chromium and WebKit, and the Compose setup flow has been verified through first issue creation. Release hardening is in place (signed images, an SBOM, and a full CI gate before publication); checks that require owner credentials remain open. See [docs/security-review.md](docs/security-review.md) for the security checks and [docs/release.md](docs/release.md) for the release process.
