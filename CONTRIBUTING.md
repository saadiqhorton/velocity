# Contributing to Velocity

Thanks for helping. Velocity is AGPL-3.0-or-later; by contributing you agree your
work is released under that license. `SPEC.md` is the source of truth.

**Every PR must reference the spec section(s) it implements or changes** (for example
"Implements SPEC §3.8 cycle rotation"). If the spec is wrong or silent, change the spec in the same PR.

## Dev setup

Requirements: Node 22, pnpm 11 (`corepack enable`), Docker (for Postgres 16).

```sh
# 1. Local Postgres 16
docker run -d --name velocity-pg -p 54320:5432 \
  -e POSTGRES_USER=velocity -e POSTGRES_PASSWORD=velocity -e POSTGRES_DB=velocity \
  postgres:16-alpine

# 2. Install and configure
pnpm install
# No env setup needed: `pnpm dev` loads apps/server/.env.development (dev defaults for the
# container above). Override values in a git-ignored apps/server/.env.local.

# 3. Migrate, seed, run
pnpm db:migrate
pnpm seed
pnpm dev                 # server + web
```

Tests that need a database read `TEST_DATABASE_URL`, for example
`postgres://velocity:velocity@localhost:54320/velocity_test` (create the database first).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | server + web in watch mode |
| `pnpm build` | build everything (Turborepo) |
| `pnpm lint` | ESLint + `check-hex` + `check-legal` |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | unit and service tests (vitest) |
| `pnpm test:e2e` | Playwright end-to-end tests (add `--grep-invert @visual` on your host; the visual baselines run in Docker via `apps/web/scripts/visual-docker.sh <slot>`) |
| `pnpm codegen` | GraphQL schema print + client codegen |
| `pnpm db:generate` | new Drizzle migration after editing `packages/schema` |
| `pnpm tokens` | regenerate ADS token CSS |
| `node --test scripts/*.test.mjs` | tests for the lint scripts |

## Dependency rule (SPEC §5.3, enforced by ESLint)

```
schema <- events <- services <- graphql <- apps        ui <- tokens
```

- `schema` imports no workspace package; `events` only `schema`; `services` only
  `schema`, `events`, `importers`; `graphql` only `schema`, `events`, `services`; `ui` only `tokens`.
- Apps never import other apps.
- All domain mutations happen in `packages/services`, so web, MCP and importers behave identically.
- No `any` in `schema`, `events`, `services`, `graphql` (SPEC §5.2).
- In `apps/web`, do not import `useMutation` from `@apollo/client`; use `src/lib/mutation.ts`,
  which requires an optimistic counterpart for every mutation (SPEC §5.4).

## Design system rules (SPEC §4.2, §4.17)

- Style only with semantic ADS tokens (`--ds-*`). **No hard-coded hex colors outside `packages/tokens`**
  (`pnpm lint` fails otherwise). Never reference raw palette tokens from components.
- Banned: glassmorphism and backdrop-blur, gradients as hierarchy, consumer-soft styling,
  radius above 12px on containers, shadow stacking, placeholder-only labels, unlabeled icon buttons,
  spinner-first loading (use skeletons and optimism), marketing copy in-app, modals for routine inline edits,
  and a top bar (the only fixed chrome is the sidebar).
- Shell geometry follows the written spec in §4.10. Do not use screenshots of other products as references.
- Self-host everything: no third-party fonts, scripts or telemetry.

## Clean-room rules (SPEC §1.5)

- Do not copy, port, decompile or consult Linear's proprietary code, SDK internals or client bundles.
- Do not copy Linear's logo, wordmark, copy, illustrations or screenshots into the repo or docs.
- Do not use "Linear" in product UI copy. Docs may say "a Linear alternative" (nominative use);
  code comments may say "Linear-style", "Linear-parity" or "Linear's public API". The importer is the exception.
- Implement from the behavioral descriptions in `SPEC.md`, never by reverse-engineering Linear.
- Never reference Linear-owned asset hosts. `pnpm lint` (`check-legal`) enforces this.
- If you are unsure whether something is derived from Linear, leave it out and ask in the PR.

## Testing expectations (SPEC §7.3)

- Unit (vitest): pure logic such as the filter DSL, permission truth table, cycle math, ordering, identifiers. Coverage at least 90% on schema, services, graphql.
- Service tests against real Postgres: every service method covers happy path, permission denied and concurrency where relevant.
- GraphQL: schema parity, pagination, filters, rate limits. MCP: every tool, including denied and malformed input.
- Webhooks/GitHub: recorded fixtures only, no network.
- E2E (Playwright) and visual snapshots for UI changes; axe must report zero critical issues.
- Tests are deterministic: per-test schema or transactional rollback, seeded fixtures, no external network.
- A bug fix includes a regression test.

## Pull requests

1. Branch from `main`; keep PRs focused.
2. Reference the SPEC section(s).
3. `pnpm lint && pnpm typecheck && pnpm test` pass locally.
4. Update docs and `.env.example` when you add configuration.
5. Add new migrations with `pnpm db:generate`; never edit an applied migration.
6. Do not add telemetry or outbound network calls that are on by default.
