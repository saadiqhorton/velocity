<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# AGENTS.md

Velocity is a pnpm/Turbo TypeScript monorepo (Node 22) for a self-hostable Linear-style issue tracker: a GraphQL API + SPA, a public API, an MCP server, and importers. Orient before changing anything:

- `SPEC.md` — source of truth (product + engineering requirements).
- `HANDOFF.md` — live state, ownership, and the "Gotchas already paid for" list.
- `CONTRIBUTING.md` — rules and dev setup.
- `docs/architecture.md` — runtime, package boundaries, recorded deviations.

## Core commands

```sh
pnpm install          # pnpm 11 via corepack; only one at a time (shared lockfile)
pnpm dev              # @velocity/server + @velocity/web in watch mode
pnpm typecheck        # turbo, all packages
pnpm lint             # eslint + check-hex + check-legal
pnpm test             # turbo, all packages (DB tests need Postgres)
pnpm build            # turbo, all packages
```

- Seed a fresh DB (migrations run on server startup): `pnpm --filter @velocity/server seed -- --issues 10000` (demo `demo` / `correct-horse-battery-staple`).
- Focus one test: `pnpm --filter @velocity/services exec vitest run <file> [-t "name"]`; for E2E, `cd apps/web && E2E_SLOT=<1-9> npx playwright test -g "name" --project=chromium`.

## Environment

- PostgreSQL 16 (`citext`, `pg_trgm`) on the usual dev port `54320`; see `CONTRIBUTING.md` for the container. `DATABASE_URL`, `APP_URL`, `APP_SECRET` (≥32 chars), `UPLOAD_DIR`, `EXPORT_DIR` are required.
- DB-backed tests clone a migrated template DB via `TEST_DATABASE_URL`; no testcontainers. Details in `docs/architecture.md`.
- The Vite dev client must use `APP_URL=http://localhost:5173` for cookie-auth WebSockets to work.

## Architecture in one screen

```
schema <- events <- services <- graphql <- apps      ui <- tokens
```

- All domain mutations live in `packages/services` so web, MCP and importers behave identically; apps never import each other. The GraphQL schema is generated from Pothos.
- `apps/web` must not import the `@velocity/schema` root (browser-unsafe) — use `@velocity/schema/enums`; the filter DSL is `@velocity/graphql/dsl`.
- Every web mutation must go through `apps/web/src/lib/mutation.ts` (optimistic + rollback); `useMutation` from Apollo is lint-banned elsewhere. No `any` in the domain packages.

## After a schema change (order matters)

1. `pnpm codegen` — prints `packages/graphql/schema.graphql`, then regenerates `apps/web/src/gql/` (including persisted documents). Run both steps in this order.
2. Migrations: edit `packages/schema`, then `pnpm db:generate`. Never edit an applied migration.
3. `pnpm tokens` — regenerates the ADS token CSS in `packages/tokens` (generated file).

## Hard rules

- **Do not commit, branch, amend, or push unless the repo owner explicitly asks.** This repo is under active multi-agent work; check `HANDOFF.md`.
- **Clean-room (SPEC §1.5):** no "Linear" in `apps/web` user-facing copy, no Linear assets. Comment phrases `Linear-style`/`Linear-parity`/`Linear-like`/`Linear's public API` are allowed; the importer is the exception. `check-legal` enforces this.
- **Design tokens only:** style with semantic ADS tokens (`--ds-*`); no hex outside `packages/tokens` (`check-hex`), no gradients/blur/glass, radius ≤ 12px, no top bar.
- **Design boundary:** non-design agents don't restyle `apps/web` or touch `packages/ui`/`packages/tokens`; log visual issues in `apps/web/WEB_PROGRESS.md`.
- Every fix (especially a bug fix) ships a regression test.

## E2E / visual testing

- E2E runs the built SPA under production CSP — `pnpm --filter @velocity/web build` first.
- Use `E2E_SLOT=<1-9>` to isolate parallel runs (own port and DB). Host runs exclude visual: `--grep-invert @visual`.
- Visual baselines live in `apps/web/e2e/0-visual.spec.ts` (Chromium-only; the `0-` prefix must run first). They render correctly only in the Playwright Docker image — capture/compare via `apps/web/scripts/visual-docker.sh <slot> [--update]`, never host `--update-snapshots`. Only the design owner regenerates them.
- WebKit needs Docker on many hosts: `apps/web/scripts/e2e-webkit-docker.sh <slot> [spec…]`.
- `pkill -f`/`pgrep -f` match the calling shell (exit 144); track PIDs or use `ss -ltnp`. Run long suites detached and poll a log.

## Ops

- `docker build .` builds the release image (serves the web bundle); `scripts/deploy/` has the Compose smoke and upgrade/restore scripts. Perf workloads and recorded budgets are in `scripts/perf/README.md`.
- `pnpm audit --audit-level high`; the one ignored GHSA is dev-only and documented in `docs/security-review.md`.
