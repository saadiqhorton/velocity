# Velocity — Engineering Handoff

**Read this, then `SPEC.md`. `SPEC.md` is the source of truth; this file is the current state + how to continue.**
Last updated: 2026-10-04 (Lane F final verification by the implementation agent; earlier web rows by Claude agent 2). Baseline commit `b622999` is on `master`. **Web/UI pickup: read `apps/web/WEB_PROGRESS.md` first.** **The backend (Codex) is finished; its latest status is in `HANDOFF.CODEX.md`, which supersedes the backend rows of §1.**

---

## 0. Ownership (updated 2026-10-04: Codex takes over web QA and fixes; design stays with Claude)

| Owner | Owns (may edit) | Responsibilities |
|---|---|---|
| **Claude (Opus 5.5): design** | `packages/ui/**`, `packages/tokens/**`, plus the **visual layer** of `apps/web` (styling, spacing, typography, color and density, layout geometry, empty states, visual hierarchy) | Design pass (screenshot review in both themes, 1440/1024 and responsive), UI library changes, approving visual-snapshot baselines, working the design review queue |
| **Codex: everything else** | All backend paths (as before), plus `apps/web/**` for **behavior**: logic, data, keyboard, state, routing, tests (`apps/web/e2e/**`, unit tests), and functional fixes | Web QA and fixes per **`CODEX_WEB_QA.md`**: E2E specs, end-to-end click-through review of every screen, functional bug fixes, missing features, WebKit, final gates. Also backend requests (§9) |

Coordination rules:
- **The design boundary inside `apps/web`.** Codex fixes behavior. Codex does not restyle: no changes to colors, spacing, sizes, typography, layout geometry or component choice, and no edits to `packages/ui` or `packages/tokens`.
  - If a functional fix needs a visual change, make the smallest one possible and add an entry to the **Design review queue** in `apps/web/WEB_PROGRESS.md`.
  - If Codex spots a visual problem, it logs it there instead of fixing it.
  - Claude changes `apps/web` logic only where a design change requires it.
- **File claims.** Before editing a file under `apps/web/src`, add it to the **Active claims** table in `apps/web/WEB_PROGRESS.md` (owner, files, task). Remove the claim when done. Never edit a file someone else has claimed. Re-read a file right before editing it, since others may have changed it.
- **API changes are additive.** Never rename or remove a GraphQL field the web app uses. After any schema change, regenerate `packages/graphql/schema.graphql` (`pnpm --filter @velocity/graphql print-schema`), then web codegen (`pnpm --filter @velocity/web codegen`).
- **One `pnpm install` at a time.** The lockfile is shared. Announce dependency additions in §9.
- **Single branch.** All work happens on `master`; there are no feature branches. Never commit without the repo owner asking.
- **Shared infrastructure.** Everyone uses the dev Postgres container (§2), each with their own databases and ports.
  - Web dev DB: `velocity_dev_web`, API :3100, Vite :5173 (`apps/web/.dev-data/start-*.sh`).
  - E2E runs isolate themselves with `E2E_SLOT=<n>` (n = 1–9 only; slot n uses port `32<n>0` and DB `velocity_e2e_web_<n>`), so parallel agents must use different slots.

---

## 1. Status snapshot

| Area | Path | State | Verified tests |
|---|---|---|---|
| Design tokens (ADS) | `packages/tokens` | Done. Light = SPEC values; dark generated from `@atlaskit/tokens` `atlassian-dark` (SPEC §4.3) | 42 (contrast/AA + structure) |
| Data model + migrations | `packages/schema` | Done. 38 tables, 3 migrations (extensions, init, triggers/FTS) | via services tests |
| Domain events / outbox | `packages/events` | Done. Transactional outbox + LISTEN/NOTIFY listener | via services tests |
| Pure domain libs | `packages/services/src/lib` | Done. permissions, cycle math (DST), fractional order, identifiers, issue refs, markdown sanitizer, crypto, SSRF, password policy | 897 |
| Domain services | `packages/services/src` | Done. All services incl. GitHub + importer pipeline | 66 DB tests (core 15, github 32, importer 19) |
| Filter DSL parser | `packages/graphql/src/dsl` | Done. Parse / serialize / chips | 485 |
| GraphQL API | `packages/graphql` | Done. ~100 mutations, 5 subscriptions, `uploadAvatar`; SDL in `schema.graphql` | 507 (DSL + API + web-parity walk) |
| App server | `apps/server` | Done & smoke-tested over HTTP, WS, MCP-HTTP. Bundle builds; issues-list perf budget met (p95 ~128 ms at 25 VUs on 10k issues) | 12 |
| MCP tools + stdio server | `packages/mcp-tools`, `apps/mcp` | Done (13 tools, `velocity_guide` prompt) | 41 (e2e vs real schema + Postgres) |
| Importers | `packages/importers` | Done. Linear CSV/API, Jira CSV, GitHub; `velocity-import` CLI | 76 |
| UI component library | `packages/ui` | Done (32 ADS components + `ComponentGallery`); rendered and screenshot-reviewed in both themes (gallery at `/__gallery?enable=1`). `Table` now has `min-w-160` for horizontal scroll on phones | 32 (jsdom) |
| Deploy / CI / lint / legal | root, `.github/` | Full `docker build .` (with the web app) succeeds (607 MB). Compose stack verified 2026-10-04: UI wizard → first issue through Caddy under the production CSP, `scripts/deploy/smoke.mjs` passes, read-only rootfs, user 10001. Whole-repo ESLint clean | 8 (check-script self-tests) |
| **Web app** | `apps/web` | **WP1 + WP2 built and E2E-verified on Chromium and WebKit** (Lanes A–F done; DIAGNOSIS §5 T1–T10). Left: Claude's design pass (light theme + 1024 review, visual baselines; see `apps/web/WEB_PROGRESS.md` → Design review queue) | 483 web unit · E2E Chromium 72 passed / 8 skipped · WebKit 72 / 8 · CI-shaped (both browsers, one DB) 142 / 16; the skips are `visual.spec.ts` awaiting approved baselines |

Smoke-verified end to end against a real server: first-run setup → session + CSRF cookies → create team/issue → DSL list; CSRF rejection; typed DSL errors with caret; API-key auth + audit attribution; MCP over HTTP (`initialize` → `tools/call get_issue`); WebSocket subscription receives an `issue.updated` event triggered by an HTTP mutation.

---

## 2. Getting running

```bash
# Postgres 16 for dev + tests (port 54320; needs pg_trgm + citext, both in the official image)
docker run -d --name velocity-dev-pg -e POSTGRES_USER=velocity -e POSTGRES_PASSWORD=velocity \
  -e POSTGRES_DB=velocity -p 54320:5432 postgres:16-alpine

pnpm install                                   # pnpm 11 (corepack); never run installs concurrently

# Dev API server — it does NOT auto-load .env; export vars yourself:
docker exec velocity-dev-pg psql -U velocity -c "create database velocity_dev"
export DATABASE_URL=postgres://velocity:velocity@localhost:54320/velocity_dev
export APP_URL=http://localhost:3000          # use http://localhost:5173 when working through Vite (see §5)
export APP_SECRET=$(openssl rand -hex 32)
export UPLOAD_DIR=./data/uploads EXPORT_DIR=./data/exports
pnpm --filter @velocity/server dev            # tsx watch; migrations run on boot (advisory-locked)

pnpm --filter @velocity/server seed -- --issues 10000   # demo owner demo / demo-password-velocity, 3 teams, cycles, projects
```

Tests (Postgres must be running; DB tests clone a per-run template DB, safe to run in parallel):

```bash
(cd packages/tokens && npx vitest run)                # 42
(cd packages/graphql && npx vitest run src/dsl)       # 485
(cd packages/importers && npx vitest run)             # 76
(cd packages/ui && npx vitest run)                    # 32
(cd packages/services && npx vitest run test/lib)     # 897
(cd packages/services && npx vitest run test/db)      # 66
(cd packages/mcp-tools && npx vitest run)             # 41
node --test scripts/*.test.mjs                        # 6
node scripts/check-hex.mjs && node scripts/check-legal.mjs
npx tsc --noEmit -p <package>/tsconfig.json           # every package typechecks clean today
```

`TEST_DATABASE_URL` overrides the admin URL (default `postgres://velocity:velocity@localhost:54320/postgres`). Root `pnpm test` / `pnpm typecheck` via Turbo have **not** been run end to end; `apps/server`'s `vitest run` has no tests yet and will fail without `--passWithNoTests`.

---

## 3. Contracts — build against these, don't change them casually

- **GraphQL schema**: `packages/graphql/schema.graphql` (generated; regenerate with `pnpm --filter @velocity/graphql print-schema` after any schema change). Pothos code-first in `packages/graphql/src/types/*`. Fields are non-null unless marked; errors carry `extensions.code` ∈ `NOT_FOUND | FORBIDDEN | VALIDATION | CONFLICT | RATE_LIMITED | UNAUTHENTICATED` (DSL errors add `position` + `caret`).
  - Issue lists: `issues(filter: <DSL>, teamId|teamKey, projectId, cycleId, …, groupBy, ordering, first, after)` → `IssueConnection` (offset cursors), plus `issueGroupCounts(…, groupBy)` for group headers. `issue(id)` accepts a UUID **or** `ENG-123`.
  - Realtime: `workspaceEvents` (invalidation stream: `topic, issueId, teamId, changedFields`), `issueUpdated(issueId)`, `issueCreated(teamId)`, `notificationCreated`, `importProgress(runId)`.
  - Auth mutations (`setupWorkspace`, `login`, `acceptInvite`, `signup`) set the cookies themselves.
- **HTTP/auth**: session cookie `vel_session` (httpOnly) + `vel_csrf` (readable). Every cookie-authenticated POST must send header `X-CSRF-Token: <vel_csrf>`. API keys: `Authorization: vel_…` or `X-Api-Key`. WebSocket at `/graphql` (graphql-ws); cookie-auth sockets must come from the `APP_URL` origin; API clients pass `{ authorization: 'vel_…' }` as connectionParams. Uploads: `uploadAttachment(file: File!)` via GraphQL multipart. Files at `/files/:id` (signed URL or session). Export download `/api/exports/:id/download`.
- **Filter DSL**: parser is pure and browser-safe — import from `@velocity/graphql/dsl` (`parseFilter`, `serializeFilter`, `toChips`, `fromChips`, `FILTER_FIELD_SPECS`). Chips are canonical in the UI; DSL is the URL/interchange format (SPEC §3.10, §6.1.4).
- **Browser-safe enums**: import from `@velocity/schema/enums` (the `@velocity/schema` root also exports Drizzle tables — never import it in the web app).
- **Styling**: tokens CSS `@velocity/tokens/tokens.css` (build with `pnpm tokens`), Tailwind mapping `@velocity/ui/theme.css`. Utilities: `bg-surface|sunken|raised|overlay|hover`, `text-fg|fg-subtle|fg-subtlest`, `border-border`, `bg-primary|primary-subtle`, 4px grid (`h-8` = 32px), `text-sm`(12)/`text-base`(14), `rounded-sm|md|lg`. Status palette via `var(--ds-status-<color>[-text|-bg])`. Layout constants in `@velocity/tokens` `layout` (sidebar 220, panel 400, row 32).
- **UI components**: `@velocity/ui` (see `packages/ui/src/index.ts`). `PopupSelect` (programmatic `open`/`anchorEl` for `S`/`A`/`L`/`P` shortcuts), `OptionList` + `useOptionListNavigation` (reuse for the command palette), `Modal`/`ConfirmDialog`, `Menu`, `Table`, `FlagProvider`/`useFlags`, `SideNav*`, `PriorityIcon`, `StatusIcon`, `Lozenge`, `ComponentGallery`.
- **Dependency rule (ESLint-enforced)**: `schema ← events ← services ← graphql ← apps`; `ui ← tokens`; apps never import each other; all domain mutations live in `packages/services`.

---

## 4. Rules (binding — from SPEC, enforced where possible)

1. **Clean-room** (SPEC §1.5): no Linear code, assets, screenshots or branding. Layout parity comes from SPEC §4.10's written geometry only.
2. **No hex colors outside `packages/tokens`** (`scripts/check-hex.mjs`). No arbitrary Tailwind colors/pixels, no gradients/blur/glass, radius ≤ 12px, shadows only on dropdowns/modals, **no top bar** (SPEC §4.17).
3. **Every web mutation is optimistic** (SPEC §5.4): `useMutation` from `@apollo/client` is lint-banned outside `apps/web/src/lib/mutation.ts` — build the wrapper there and require an optimistic response + rollback flag text.
4. TypeScript strict, `verbatimModuleSyntax` (`import type`), no `any` in schema/events/services/graphql.
5. Operational copy only, human error sentences with a recovery action, identifiers always mono (SPEC §4.14). Strings go through the `en` message catalog (SPEC §7.5).
6. Keyboard-complete, visible focus ring everywhere, ARIA patterns (SPEC §4.12, §4.15).
7. Every PR references a SPEC section. Don't commit unless the user asks.

---

## 5. Gotchas already paid for

- **graphql-yoga in Node**: use `yoga.requestListener(req, res)`. `handleNodeRequestAndResponse` only *returns* a Response and the request hangs.
- **graphql dual-package in vitest**: tests that build their own executor must `import { graphql } from 'graphql/index.js'` (explicit CJS entry), or vitest loads a second `graphql` copy and schema checks fail.
- **WebSocket origin check**: cookie-auth sockets are rejected unless `Origin === APP_URL` origin. When developing through the Vite dev server, set `APP_URL=http://localhost:5173` and proxy `/graphql` (with `ws: true`), `/files`, `/api` to `:3000`.
- **CSP** (served with the SPA): `script-src 'self'` — no inline scripts, so the theme bootstrap (SPEC §4.5) must be an external file (e.g. `public/theme-init.js`). `style-src 'self' 'nonce-…'`: the per-request nonce is injected as `<meta name="csp-nonce" property="csp-nonce" nonce="…" content="…">`; read `content`, and pass it to tiptap (`injectNonce`) or disable its CSS injection (the app disables it). `property`/`nonce` let Vite's `__vitePreload` nonce any `<link>` it injects. Build-emitted `<script>`/`<link>` tags are not nonced; `'self'` covers them. `apps/server/test/static.test.ts` pins this contract.
- **pnpm 11** blocks build scripts: `pnpm-workspace.yaml` → `allowBuilds: { esbuild: true, sharp: false }` (sharp uses prebuilt `@img/*` binaries; its source build fails). New deps may add `minimumReleaseAgeExclude` entries — that's expected.
- **`pkill -f <pattern>`** matches the shell running it (exit 144); so does `pgrep -f`. Track dev-server PIDs in a file, or find them by port (`ss -ltnp`).
- **Long E2E runs from an agent shell:** run detached with `setsid -f bash -c '… > /tmp/e2e-<n>.log 2>&1; echo EXIT=$? >> /tmp/e2e-<n>.log' </dev/null` and poll the log. `nohup … &` keeps the tool's stdout pipe open and hangs it. Debug one test with `-g` first; on failure read `test-results_<n>/<test>/error-context.md`.
- **WebKit E2E on Arch-like hosts:** Playwright's WebKit build targets Ubuntu (ICU 74, `libxml2.so.2`, flite, libbacktrace) and won't start natively. Run it in the Playwright image: `apps/web/scripts/e2e-webkit-docker.sh <slot> [spec…]` (build `apps/web/dist` on the host first).
- **WebKit noise the E2E guard tolerates:** (1) Playwright's pre-close screenshot (`screenshot: 'only-on-failure'`) injects `<style>body {}</style>` on WebKit, which the CSP blocks, so the guard freezes once the test's context fixture tears down. (2) WebKit logs "Fetch API cannot load … due to access control checks" whenever a navigation cancels an in-flight fetch, and Playwright reports that as a page error. The guard tolerates only that message, same-origin, within 3 s of a main-frame navigation (`apps/web/e2e/support/fixtures.ts`). Every other CSP violation or page error still fails the test.
- **Pothos nullability**: builder sets `DefaultFieldNullability: false` — outputs are non-null unless `nullable: true`; inputs are optional unless `required: true`.
- **Services API quirks**: `systemActor('import' | 'github' | 'system', userId?)` for background work; per-issue notifications/webhooks are suppressed for `kind: 'import'`. `IssueService.createInTx` accepts import overrides (`createdAt`, `completedAt`, …).

---

## 6. Remaining work packages

Owners per §0. Run your package's verify commands before handing back. Don't edit another owner's paths; file a §9 request instead.

### WP1 — Web app core · built (Claude); QA and fixes now **Codex** (`CODEX_WEB_QA.md`) · `apps/web/**`
SPEC §4.10 (binding geometry), §4.12, §4.13, §5.4, §5.5, §4.5, §4.16.
- Vite 8 + React 18 + Tailwind v4 (`@tailwindcss/vite`) + `@fontsource-variable/inter`; CSS imports tokens + `@velocity/ui/theme.css` + `@source` for `packages/ui/src`.
- GraphQL codegen (`@graphql-codegen/client-preset`, schema from `packages/graphql/schema.graphql`) → `apps/web/src/gql/` (lint-ignored).
- Apollo Client 3: HTTP link adding `X-CSRF-Token` from the `vel_csrf` cookie; graphql-ws link; split; `workspaceEvents` → refetch active list queries (debounced); reconnect backoff 1–30s + refetch; offline banner after 5s; error → flags.
- `src/lib/mutation.ts` optimistic wrapper; Zustand stores (selection, panel, theme, sidebar collapse).
- Router (§5.4): `/team/:key/{active|backlog|cycles|projects|views}`, `/issue/:id`, `/project/:id`, `/inbox`, `/my-issues`, `/insights`, `/search`, `/settings/*`, `/view/:slug`, plus `/login`, `/setup`, `/invite/:token`. Issue panel = `?issue=<uuid>` route state.
- Shell: 220px sidebar (exact §4.10.3 order, bottom inset: `+ New` menu, Settings, avatar), no top bar, content, 400px detail panel; responsive breakpoints from §4.10.2.
- Keyboard engine (single listener, layered scopes, `G` chords, registry feeding the palette) + command palette (`Cmd/Ctrl+K`, `>` `#` `@` modes) + `?` shortcuts help.
- Issue list: virtualized (TanStack Virtual), grouped with sticky headers, 32px rows (§4.10.2 anatomy), focus/selection (`X`, `⇧X`), bulk action bar, `⌥↑/↓` reorder; board layout (`B`) with DnD + `M`.
- Issue detail panel/page (§4.11.3): inline title (500ms autosave), property popups, lazy tiptap markdown editor, sub-issues, relations, comments/activity tabs, subscribe.
- Create-issue modal (`C`), team Active/Backlog screens, dev route mounting `ComponentGallery` (for visual tests).
- **Verify**: `pnpm --filter @velocity/web build` succeeds and the server serves it; keyboard-only loop create → navigate → edit → close works against a seeded DB.
- **Status (2026-10-04, agent 2): built.** Verified by E2E under the production CSP: keyboard loop (C, J/K, Enter, title autosave, S/P/A/L/I/E/Y/#/M/R, Esc focus return, ⌘Enter, G chords, ?, /), palette (> # @ modes, Tab, Esc), layout conformance (1440/1024 × both themes), theme switch, views share-by-URL. Initial JS 175.5 KB gz (budget 350). Still to verify by running the on-disk specs: bulk, board DnD + M, ⌥↑/↓ reorder, infinite scroll, panel deep link + markdown editor under CSP, realtime two-context, offline banner + sync pulse.

### WP2 — Web screens · built (Claude); click-through QA now **Codex**, design pass **Claude** · `apps/web/src/screens/<area>/**`
- **Auth**: setup wizard (owner → workspace → first team → optional GitHub → done, < 2 min), login, invite accept (SPEC §3.2, §3.3).
- **Settings** (§3.12, §4.11.9): workspace, members & invites, teams + workflow editor + cycle settings, labels, API keys (show-once, mutations/hour), sessions, profile/theme, integrations (GitHub install/settings/backfill, MCP info, webhooks + deliveries + redeliver), import wizard (upload → mapping preview → dry run → commit with live progress), export, audit log (owner).
- **Planning**: projects list (ADS table) + detail tabs (Overview / Issues / Milestones / Activity), cycles screen (header, velocity sparkline, scope markers, closed archive), insights (2 SVG charts, each linking to its live view) — SPEC §3.8, §3.9, §4.11.4–7.
- **Workspace**: inbox (§4.11.10), My Issues presets, search screen, views builder (filter chips + display options + save; URL-serialized state), favorites.
- **Status (agent 2): every screen above is built** (settings shell `screens/settings/Settings.tsx` + `common.tsx`; sections in `screens/settings/{account,workspace,integrations,data}/`; planning in `screens/project`, `screens/team/TeamCycles.tsx`, `screens/insights`, `components/charts`; workspace in `screens/{inbox,search,views,my-issues}`, `components/common/FavoriteButton.tsx`) and screenshot-reviewed in dark at 1440. Remaining: click-through verification of each flow, light-theme and 1024 screenshot pass, a per-row "added after start" marker on cycle lists (needs an `IssueRow` prop), and the §9 rows 4–5 gaps.

### WP3 — GraphQL API tests · **Codex** · `packages/graphql/test/**`
SPEC §7.3 GraphQL row: pagination, filter and orderBy combinations, typed error codes, depth and complexity limits, and the permission truth table through the API. Reuse `packages/services/test/helpers/harness.ts` and an in-process executor (see `packages/mcp-tools/test/helpers.ts`). The parity walk checks that every web operation validates against `schema.graphql`. It reads documents from `apps/web/src/**/*.graphql` and `apps/web/src/gql/` once WP1 exists, so wire it up to pass trivially until then.

### WP4 — Server tests · **Codex** · `apps/server/test/**`
Boot `createApp` against a harness DB with `inlineJobs: true`: CSRF, cookies, rate limits (429 + headers, 10/min auth), WebSocket auth/origin, `/files` signed URLs, GitHub webhook endpoint, MCP HTTP token checks, `/metrics` protection. Outbound webhook delivery against a local receiver: HMAC signature, retry schedule, dead-letter, redeliver, SSRF block.

### WP5 — Performance · **Codex** · `scripts/perf/**`, `apps/server/src/seed-cli.ts`
Seed 10k issues; k6 scripts for SPEC §4.16 / §7.3 (issues query p95 < 150 ms @ 10k, 25 concurrent users, mutation storm); add indexes if budgets fail. The seed CLI is written but **not yet run**.

### WP6 — Docker / deploy verification · **Codex** · `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`, `docs/self-hosting.md`
`docker build` + `docker compose up` on a clean checkout → wizard → first issue. Confirm `pnpm deploy --prod --legacy` works with pnpm 11, the read-only rootfs (writes only to `/data`, `/tmp`), and `pg_dump` 16 for `VELOCITY_BACKUP_BEFORE_MIGRATE`. Block `/metrics` at Caddy (the server requires `METRICS_TOKEN` or rejects proxied requests). Set `TRUST_PROXY=1` for the app behind Caddy.
- **Status (2026-10-04, Lane F):** `docker build .` succeeds with the web app. `docker compose` (isolated project, `scripts/deploy/compose.smoke.yml` with its port changed) comes up healthy. The first-run wizard through the UI and the first issue work through Caddy with zero CSP/console errors, and `scripts/deploy/smoke.mjs` passes. Not re-checked this round: `pnpm deploy --prod --legacy` on its own, and `VELOCITY_BACKUP_BEFORE_MIGRATE` restore.

### WP7 — Lint cleanup (21 ESLint errors today)
- **WP7a · Claude:** **done.** `packages/ui` lint is clean (Popover, Tooltip, Portal fixed).
- **WP7b · Codex:** the other 13 errors are unused vars and useless assignments:
  - `packages/services`: `issues/index.ts` (5), `exports.ts` (2)
  - `apps/server`: `static.ts` (1)
  - `packages/mcp-tools`: `executor.ts` (1), `tools.e2e.test.ts` (1)
  - `packages/graphql`: `dsl/parser.ts` (1)
  - `packages/importers`: `cli.test.ts` (2)

Re-run the owning package's tests after each fix.

### WP8 — Docs · **Codex** · `README.md`, `docs/api.md`, `docs/import.md`, `docs/architecture.md`
Claude contributes a UI section (design system usage, keyboard map) to `docs/architecture.md` through a §9 request when WP1 lands.
Quickstart, API (auth, DSL, examples, rate limits, webhooks + signature verification snippet), import guide, architecture + the deviations in §7 below. `docs/agents.md` already exists (source of the MCP prompt; run `node packages/mcp-tools/scripts/sync-guide.mjs` after editing it).

### WP9 — Browser E2E · harness built (Claude); remaining specs now **Codex**; visual baselines approved by **Claude** · `apps/web/e2e/**`, `apps/web/playwright.config.ts`
Playwright on Chromium and WebKit (browsers are cached locally). The config boots the API server itself; the CI job in `.github/workflows/ci.yml` (Codex) expects that. Scenarios:
- first-run wizard, keyboard loop, bulk ops, cycle rotate
- GitHub link via a mock
- import a 1k-row CSV (`packages/importers/scripts/generate-linear-csv.ts`)
- theme switch
- layout conformance (§4.10.4): no top bar, sidebar 220±2, panel 400±2, row 32±2, both themes, at 1440 and 1024
- axe with zero critical
- visual snapshots of `ComponentGallery`

**Status (2026-10-04, Lane F): done except visual baselines.** All specs on disk are verified: Chromium 72 passed / 8 skipped, WebKit 72 / 8 (WebKit runs in Docker: `apps/web/scripts/e2e-webkit-docker.sh`), CI-shaped run of both browsers against one DB 142 / 16. The 8 skips per browser are `visual.spec.ts`, which skips until Claude generates and approves baselines (`npx playwright test visual --project=chromium --update-snapshots`). Written: import 1k CSV, settings, planning, workspace, rollback, reconnect refetch. Not written: cycle rotate, GitHub-link mock (the configured state is drafted in `settings.spec.ts`).

**Earlier status (agent 2, historical):** harness done (`playwright.config.ts`, `e2e/support/{server,env,fixtures}`): boots the API serving `dist` on a fresh DB, runs the wizard through the UI (setup project) and `seed-cli --issues 400` (seed project), then specs signed in via storage state; any CSP violation or page error fails a test. Local runs use DB `velocity_e2e_web` on :3200; `E2E_SLOT=<1-9>` isolates parallel runs (:32<n>0, `velocity_e2e_web_<n>`). CI path unchanged (`CI=1` + `DATABASE_URL`/`APP_URL`, uses `apps/server/dist`). Specs on disk: keyboard-loop, palette, views, theme, layout, a11y (green); bulk, board, reorder, infinite-scroll, panel, realtime, offline (written, **unverified**). Not written yet: import-1k-CSV, visual snapshots, cycle rotate, GitHub-link mock. WebKit not run yet.

---

## 7. Deviations from SPEC already made (document in `docs/architecture.md`)

- **Dark theme** comes from the current published `@atlaskit/tokens` `atlassian-dark` theme, per SPEC §4.3's "published tokens win". Light is SPEC-exact. Dark lozenge text was lightened to keep 4.5:1 on the 15% tint.
- **Extra tables**: `workspace` (singleton), `invites`, `team_counters`, `project_teams`, `issue_activity`, `favorites` (orderable, replacing `views.is_favorite_for[]`), `mcp_sessions`, `import_items`, `exports`. `api_keys` also has a `prefix` column for lookup and display.
- **Tests** use a shared Postgres (`TEST_DATABASE_URL`) with a per-run template DB, not testcontainers.
- **Markdown sanitizer** escapes raw HTML (`\<`) instead of stripping it, so text like `Map<string, number>` survives. `javascript:`, `data:` and similar URLs become `#`.
- **Webhook retries** use the app's own schedule (1m, 5m, 15m, 30m, 60m), then dead-letter. pg-boss retry is off for that queue.
- **Cycles**: rotation runs as an hourly sweep, so per-team local midnight is honored. A manual early close shortens `endsAt` to now. Catch-up windows are inserted already closed.
- **GitHub**:
  - Installation tokens are minted per call and never stored.
  - Backfill links PRs without notifications or auto-close.
  - Issue-sync dedupe uses an activity marker.
  - Commits link on any reference but never close issues.
- **MCP** has 13 tool names, because `get_project` and `list_projects` are separate.
- **Web/API surface**:
  - GraphiQL is disabled (no third-party JS); introspection stays on.
  - Persisted documents are not implemented.
  - Avatar upload is not implemented (`User.avatarUrl` exists).
- **Behavior choices**:
  - `is:blocked` counts only unresolved blockers.
  - `DISABLE_SIGNUP=false` enables open signup.
  - Rate limits are per process.

## 8. Open questions for the owner

- Should team-key renames keep old identifiers resolvable? Today, renaming breaks old `ENG-123` references in PRs and commits.
- On PR open, should the issue move to In Progress? SPEC §2.1 says "status transitions", but the §6.5.2 matrix only lists auto-close on merge, which is what is implemented.
- Product name: "Velocity" is a working title (SPEC §1.6). `BRANDING.md` lists every occurrence of it.

---

## 9. Cross-team requests

Append rows; the owner of the target path marks them done. Keep entries short and specific.

| # | From → To | Request | Status |
|---|---|---|---|
| 1 | Claude → Codex | Avatar upload: an `uploadAvatar(file: File!): User!` mutation plus `GET /avatars/:id` serving (SPEC §3.12 profile). `User.avatarUrl` already returns `/avatars/:id?v=…` when `avatarPath` is set. | **done** (Codex). `GET /avatars/:id` requires a signed-in member |
| 2 | Claude → Codex | Before WP6's `docker build`, confirm the web build output path stays `apps/web/dist` (Claude keeps it there) and that the Dockerfile copies it to `/app/web-dist`. | **confirmed** (Claude, 2026-10-04): `pnpm --filter @velocity/web build` writes `apps/web/dist` (vite `outDir: 'dist'`); `Dockerfile` copies `/repo/apps/web/dist` → `/app/web-dist` with `WEB_DIST_DIR=/app/web-dist`. Contract unchanged. |
| 3 | Lead (Claude) | `scripts/check-legal.mjs` now ignores generated `apps/web/src/gql/` for the UI-copy rule (it mirrors schema descriptions such as the Linear importer key). Asset-host checks still apply there. Test added. | **done** |
| 4 | Claude → Codex | Expose `before`/`after` (date range) args on the `auditLog` GraphQL field; the service already supports them. Today the web audit log date presets filter only the newest 200 entries on the client. | **done** (Lane E / opencode): `auditLog(after, before)` in `schema.graphql`; the web date presets filter on the server (`settings.spec.ts`) |
| 5 | Claude → Codex | Add a `removeAvatar: User!` mutation (clears `avatarPath`), so Settings → Profile can offer "Remove" next to "Upload". | **done** (Lane E / opencode): `removeAvatar` mutation + Profile "Remove" action |
| 6 | Claude → Codex | (FYI) `apps/server/dist/main.js` on disk was stale vs. source on 2026-10-04; the local E2E harness now runs the server from source unless `CI=1` or `E2E_USE_BUNDLE=1`. No action unless CI should also run from source. | **decided** (Lane F, 2026-10-04): CI keeps running the freshly built bundle (`ci.yml` builds `@velocity/server` + `@velocity/web` in the same job right before `pnpm test:e2e`, so it cannot be stale). Local runs keep using the source. Both paths stay covered. |
