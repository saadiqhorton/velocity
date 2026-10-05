# Velocity — Engineering Handoff

**Read this, then `SPEC.md`. `SPEC.md` is the source of truth; this file is the current state and how to continue.**
Last committed checkpoint: 2026-10-04 (evening), after the design pass. The commits below are on `master`:

| Commit | What |
|---|---|
| `4a11dc8` | Design pass: light/responsive fixes, visual baselines |
| `2531f85` | Final verification (Lane F): WebKit green, board/reconnect fixes, Docker deploy verified |
| `a0325f7` | Checkpoint: complete web app, backend hardening, API/server tests |
| `b622999` | Baseline: backend, UI library, tokens, deploy scaffolding |

**Where things stand:** v1.0 feature work is done and verified. Every screen and the backend pass all gates on Chromium and WebKit, and `docker compose up` gets through the setup wizard to a first issue.

**Working tree continuation (2026-10-05, uncommitted):** Codex completed the local security, upgrade/restore, load, deterministic-seed, integration-test, release dry-run and documentation work in §6. The remaining owner/design steps are called out on each item below. Do not commit unless the repo owner asks.

**Final working-tree gates:** Turbo typecheck 13/13; Turbo tests 13/13; whole-repo ESLint, color/legal checks, script tests, web build/bundle budget and diff check pass. Full E2E on isolated slot 4: Chromium 82 passed; WebKit Docker 74 passed with eight expected Chromium-only visual skips. The multi-architecture OCI build and standalone `pnpm deploy --prod --legacy` passed.

Deeper context:
- `apps/web/WEB_PROGRESS.md`: web architecture map, QA findings F1–F10, the design queue.
- `DIAGNOSIS.md`: why the WebKit runs stalled, and what fixed them.
- `CODEX_WEB_QA.md`: QA lanes A–F, all done.
- `HANDOFF.CODEX.md`: backend performance work.

---

## 0. Ownership

| Owner | Owns (may edit) | Responsibilities |
|---|---|---|
| **Claude (Opus 5.5): design** | `packages/ui/**`, `packages/tokens/**`, and the **visual layer** of `apps/web` (styling, spacing, typography, color and density, layout geometry, empty states, visual hierarchy), plus the visual baselines `apps/web/e2e/0-visual.spec.ts-snapshots/` | Design review, UI library changes, approving and re-taking visual baselines, the design review queue in `apps/web/WEB_PROGRESS.md` |
| **Codex / other agents: everything else** | All backend paths, deploy/CI/scripts/docs, and `apps/web/**` for **behavior** (logic, data, keyboard, state, routing, unit and E2E tests) | The work packages in §6 marked Codex, functional fixes, §9 backend requests |

**The design boundary inside `apps/web`.** Non-design agents fix behavior and do not restyle:
- no changes to colors, spacing, sizes, typography, layout geometry or component choice;
- no edits to `packages/ui` or `packages/tokens`;
- never regenerate visual baselines (`--update-snapshots`).

If a fix needs a visual change, make the smallest one possible and add a row to the **Design review queue** in `apps/web/WEB_PROGRESS.md`. Log visual problems there instead of fixing them.

**Coordination rules:**
- **File claims.** Before editing a file under `apps/web/src`, add a row to **Active claims** in `apps/web/WEB_PROGRESS.md`; remove it when done. Never edit a file someone else has claimed. Re-read files right before editing.
- **API changes are additive.** Never rename or remove a GraphQL field the web app uses. After a schema change, run `pnpm --filter @velocity/graphql print-schema`, then `pnpm --filter @velocity/web codegen`.
- **One `pnpm install` at a time.** The lockfile is shared.
- **Single branch:** all work is on `master`. **Never commit unless the repo owner asks.**
- **Isolation.** Use your own databases and ports on the shared Postgres (§2).
  - E2E: `E2E_SLOT=<n>`, n = 1–9 only. Slot n uses port `32<n>0` and DB `velocity_e2e_web_<n>`. Parallel agents must use different slots.
  - Never touch other agents' processes, containers or databases.

---

## 1. Status snapshot (all verified 2026-10-04)

| Area | Path | State | Tests |
|---|---|---|---|
| Design tokens (ADS) | `packages/tokens` | Done. Light = SPEC values; dark generated from `@atlaskit/tokens` (SPEC §4.3) | 42 |
| Data model | `packages/schema` | Done. 38 tables, 4 migrations (`0003` = perf partial index) | via services |
| Events / outbox | `packages/events` | Done. Transactional outbox + LISTEN/NOTIFY | via services |
| Domain services | `packages/services` | Done, incl. GitHub, importer pipeline, perf caches | 963 |
| GraphQL API + filter DSL | `packages/graphql` | Done. ~100 mutations, 5 subscriptions, `uploadAvatar`/`removeAvatar`, `auditLog(after,before)`; web-parity walk | 509 |
| App server | `apps/server` | Done. HTTP/WS/MCP-HTTP, jobs, strict CSP; issues-list p95 ≈128 ms at 25 VUs on 10k issues | 13 |
| MCP tools + stdio server | `packages/mcp-tools`, `apps/mcp` | Done. 13 tools + `velocity_guide` prompt | 41 |
| Importers | `packages/importers` | Done. Linear CSV/API, Jira CSV, GitHub; `velocity-import` CLI | 76 |
| UI library | `packages/ui` | Done. 32 ADS components, design pass applied | 32 |
| **Web app** | `apps/web` | **Done.** Every SPEC §4.11 screen, full keyboard/palette, realtime, optimistic mutations; design pass in both themes at 1440/1024/768/390 | 483 unit · **E2E Chromium 80/80** · WebKit 72 + 8 Chromium-only visual skips |
| Deploy / CI | root, `.github/` | `docker build .` OK (≈607 MB). Compose: wizard → first issue through Caddy with read-only rootfs, user 10001, zero CSP errors; `scripts/deploy/smoke.mjs` passes. Whole-repo ESLint, `check-hex`, `check-legal` clean | 8 (script tests) |

Bundle: 176.4 KB gzip initial JS (budget 350). Turbo `pnpm typecheck` and `pnpm test` are 13/13 tasks.

---

## 2. Getting running

```bash
# Shared Postgres 16 (pg_trgm + citext)
docker run -d --name velocity-dev-pg -e POSTGRES_USER=velocity -e POSTGRES_PASSWORD=velocity \
  -e POSTGRES_DB=velocity -p 54320:5432 postgres:16-alpine
pnpm install                                   # pnpm 11 via corepack; never concurrently

# Web + API dev environment (DB velocity_dev_web, API :3100, Vite :5173)
apps/web/.dev-data/start-api.sh && apps/web/.dev-data/start-vite.sh   # stop: apps/web/.dev-data/stop.sh
# → http://localhost:5173, login demo / correct-horse-battery-staple
# (.dev-data is gitignored; on a fresh clone create it from §5's env notes or run the API manually:)
#   DATABASE_URL=postgres://velocity:velocity@localhost:54320/<db> APP_URL=http://localhost:5173 \
#   APP_SECRET=$(openssl rand -hex 32) PORT=3100 node --import tsx apps/server/src/main.ts
#   pnpm --filter @velocity/server seed -- --issues 2000        # demo / correct-horse-battery-staple
```

Gates (run before handing back):

```bash
pnpm typecheck && pnpm test                     # Turbo, 13/13 tasks (Postgres must be up)
pnpm exec eslint . && node scripts/check-hex.mjs && node scripts/check-legal.mjs && node --test scripts/*.test.mjs
pnpm --filter @velocity/web build && node apps/web/scripts/bundle-size.mjs      # budget 350 KB gzip
cd apps/web && E2E_SLOT=<n> npx playwright test --project=chromium             # 80 tests
apps/web/scripts/e2e-webkit-docker.sh <n>                                       # WebKit via Docker (see §5)
docker build .                                                                  # full image incl. web
```

---

## 3. Contracts: build against these, don't change them casually

- **GraphQL schema** (`packages/graphql/schema.graphql`)
  - Generated; regenerate after any change. Fields are non-null unless marked.
  - Errors carry `extensions.code` ∈ `NOT_FOUND | FORBIDDEN | VALIDATION | CONFLICT | RATE_LIMITED | UNAUTHENTICATED`; DSL errors add `position` + `caret`.
  - `issues(filter: <DSL>, teamId|teamKey, …, groupBy, ordering, first, after)` returns an `IssueConnection` (lazy `totalCount`).
  - `issue(id)` accepts a UUID or `ENG-123`.
  - Realtime: `workspaceEvents`, `issueUpdated`, `issueCreated`, `notificationCreated`, `importProgress`.
- **HTTP / auth**
  - Cookies: `vel_session` (httpOnly) + `vel_csrf`. Cookie-authenticated POSTs send `X-CSRF-Token`.
  - API keys: `Authorization: vel_…` or `X-Api-Key`.
  - WebSocket at `/graphql` (graphql-ws). Cookie-auth sockets must come from the `APP_URL` origin.
  - Uploads go through GraphQL multipart. Files at `/files/:id`; avatars at `/avatars/:id`.
- **Filter DSL:** pure and browser-safe, from `@velocity/graphql/dsl`. Chips are canonical in the UI; the DSL is the URL/interchange format.
- **Browser-safe enums:** `@velocity/schema/enums`. Never import the `@velocity/schema` root in the web app.
- **Styling:** `@velocity/tokens/tokens.css` + `@velocity/ui/theme.css` (Tailwind v4). Layout constants: sidebar 220, panel 400, row 32.
- **Dependency rule (ESLint-enforced):** `schema ← events ← services ← graphql ← apps`; `ui ← tokens`; apps never import each other.

## 4. Rules (binding)

1. Clean-room (SPEC §1.5): no Linear code, assets, screenshots or branding.
2. Visual limits (SPEC §4.17):
   - no hex outside `packages/tokens`;
   - no gradients, blur or glass;
   - radius ≤ 12px;
   - **no top bar**.
3. Every web mutation is optimistic, via `apps/web/src/lib/mutation.ts`. `useMutation` is lint-banned elsewhere.
4. TypeScript strict; no `any` in schema/events/services/graphql.
5. Operational copy only; strings go through `apps/web/src/i18n/en.ts`; identifiers always mono.
6. Keyboard-complete, visible focus, ARIA patterns.
7. Every fix gets a regression test. Don't commit unless asked.

## 5. Gotchas already paid for

- **graphql-yoga in Node:** use `yoga.requestListener(req, res)`. `handleNodeRequestAndResponse` hangs.
- **graphql dual-package in vitest:** tests that build an executor import `graphql/index.js` explicitly.
- **WebSocket origin:** when working through Vite, set `APP_URL=http://localhost:5173`.
- **CSP:**
  - `script-src 'self'`: no inline scripts; the theme bootstrap is `public/theme-init.js`.
  - `style-src` is nonce'd via `<meta name="csp-nonce" property="csp-nonce" nonce content>`.
  - Pinned by `apps/server/test/static.test.ts`.
- **pnpm 11:** `allowBuilds: { esbuild: true, sharp: false }`.
- **`pkill -f` / `pgrep -f`** match your own shell (exit 144). Track PIDs in files or find them by port (`ss -ltnp`).
- **Long E2E runs from an agent shell:** run detached (`setsid -f bash -c '… > /tmp/e2e.log 2>&1' </dev/null`) and poll the log. `nohup … &` hangs the tool. Debug a single test with `-g` first.
- **WebKit on this Arch-like host** won't start natively. Use `apps/web/scripts/e2e-webkit-docker.sh <slot> [spec…]` (Playwright `v1.63.0-noble` image). Build `apps/web/dist` first.
- **WebKit noise the E2E guard tolerates (`e2e/support/fixtures.ts`):**
  - the pre-close screenshot's injected `<style>` (the guard freezes at context teardown);
  - "Fetch API cannot load … access control checks" within 3 s of a navigation.
  - Every other CSP violation or page error fails the test.
- **Visual baselines** (`e2e/0-visual.spec.ts`) are Chromium-only and unmasked except for times and dates. The `0-` prefix is load-bearing: the file must run first (name order, one worker) so the shell sees only the deterministic seed. Later specs add randomly named issues and teams. Only the design owner regenerates baselines (`docs/architecture.md`, "Design boundary and visual baselines").
- **Services:** `systemActor('import'|'github'|'system', userId?)` runs background work; imports suppress per-issue notifications and webhooks.

---

## 6. Remaining work (prioritized)

Each item has an owner, its paths, and how to verify it. Log progress in `apps/web/WEB_PROGRESS.md` (Handover log) for web items, or append to this section's status lines.

### R1 — Security audit · Codex · SPEC §7.1, §8.2
- `pnpm audit --audit-level high`: fix or justify every high/critical.
- Secrets scan of the full git history: gitleaks or trufflehog via Docker; nothing should be found.
- A security review of the auth/session/CSRF code, API-key handling, rate limits, the webhook SSRF guard, upload handling (mime allowlist, EXIF strip, ClamAV path), markdown sanitization, the GitHub webhook signature check, MCP-HTTP token checks, and CSP headers.
- Write findings to `docs/security-review.md` (severity, fix, test). Fix highs and criticals with tests.
- **Verify:** audit clean or justified, scan clean, findings doc committed by the owner, all gates green.

**Status 2026-10-05:** Security review and high-severity fixes are in `docs/security-review.md`. Full-history gitleaks is clean. `pnpm audit --audit-level high` passes with one exact GHSA exception for unpatched, development-only `braces`; production audit has no high/critical findings. Full typecheck, tests and lint pass. Commit remains for the owner.

### R2 — Upgrade path and backups · Codex · SPEC §5.9, §8.2 ("N-1 compatibility")
- Build an image from `b622999` (or `a0325f7`) and run it with compose. Create data, then switch to the current image (`docker compose pull && up -d` semantics). Migrations must apply cleanly and the data must survive.
- Verify `VELOCITY_BACKUP_BEFORE_MIGRATE=1` writes a dump to `/data/backups`, and document and test a restore.
- Run `pnpm deploy --prod --legacy` on its own.
- Update `docs/self-hosting.md`.
- **Verify:** a scripted upgrade test (e.g. `scripts/deploy/upgrade-smoke.sh`) passes, and a restore is demonstrated.

**Status 2026-10-05:** `scripts/deploy/upgrade-smoke.sh` passed from `b622999`: an issue survived migration 3→4, the automatic dump was validated, and restore into a fresh DB survived startup migration. Standalone `pnpm deploy --prod --legacy` passed after fixing missing runtime dependency declarations. `docs/self-hosting.md` has the upgrade and restore steps.

### R3 — Load test re-run · Codex · SPEC §4.16, §7.3
- Re-run `scripts/perf/mutation-storm.js` (k6) against a 10k-issue DB (`velocity_perf_codex` has one; login `demo` / `correct-horse-battery-staple`) after the perf fixes, plus `issues-list.js` with 25 VUs.
- Interleave runs; laptop clock state skews results (see `HANDOFF.CODEX.md` §1).
- **Verify:** budgets met or regressions fixed; numbers recorded in `scripts/perf/README.md`.

**Status 2026-10-05:** Both 25-VU, three-minute k6 workloads passed their thresholds against 10,000 issues. The uncontended list rerun was p95 143.17 ms; mutation storm made 15,834 updates with zero errors. A list run during concurrent image builds was p95 188.16 ms. All values and conditions are recorded in `scripts/perf/README.md`.

### R4 — Deterministic seed for the visual baseline · Codex, then Claude
- Add `--deterministic` (fixed RNG seed, fixed timestamps) to `apps/server/src/seed-cli.ts`, and have the E2E seed project use it.
- Then **Claude** removes the content masks from the shell baseline in `visual.spec.ts` and re-takes the baselines.
- **Verify:** two fresh E2E runs produce identical shell screenshots with no masks.

**Status 2026-10-05:** `--deterministic` is wired into the E2E seed. Two fresh isolated wizard+seed runs produced byte-identical unmasked 1440×900 shell screenshots; normalized 400-issue data from two fresh databases also matched. Claude's removal and approval of the visual baseline masks is still pending.

**Status 2026-10-05 (Claude): done.** The masks are removed except for relative times and dates. The spec is renamed `e2e/0-visual.spec.ts` so it runs before the specs that add random data; the first unmasked full run showed their issues and teams in the shot. Two fresh full runs gave identical light shells (AE 0) and dark shells within 7 and 18 antialiasing pixels. All 8 baselines were re-taken and reviewed. Normal full Chromium runs on two fresh databases passed 83/83 both times.

### R5 — Small UX gaps · Claude (design) + small behavior
- **Phones:** below 768 the settings section list is hidden; add a compact section menu.
- **Error copy:** editor/panel chunk-load failure gets its own message key, e.g. "Couldn't load the editor." Update `ChunkBoundary.test.tsx`.
- **Verify:** screenshots at 390/768, unit tests, Chromium E2E.

**Status 2026-10-05:** The editor and panel now show specific chunk-load error messages; the boundary unit test and web typecheck pass. The compact phone settings menu and viewport review remain with Claude.

**Status 2026-10-05 (Claude): done.** Below 768px the settings header has a "Sections" menu (`screens/settings/nav.tsx`, ADS `DropdownMenu`) that is keyboard and screen-reader accessible, marks the current section with `aria-current`, and hides owner-only sections from members. Screenshots at 390 and 768 in both themes were reviewed. Tests: `nav.test.tsx` 4, ui `menu.test.tsx` +1, E2E `layout.spec.ts` "phone settings". The chunk-load messages render well in the panel and editor. One behavior gap is logged as QA G1: the phone full-page issue route lacks `ChunkBoundary`.

### R6 — Missing E2E specs · Codex
- Cycle rotation: a manual rotate via the API, then the UI shows the new cycle with carry-over.
- GitHub link with mocked webhooks: a signed PR-opened payload links the issue; merge auto-closes it.
- **Verify:** both specs green on Chromium and WebKit.

**Status 2026-10-05:** `integrations.spec.ts` covers carry-over after manual cycle close and signed PR-open/merge webhooks. A cycle scheduling bug found by the spec was fixed. Focused Chromium and Docker WebKit runs passed.

### R7 — Real-world integrations · **repo owner** + Codex
- **GitHub App:** the owner creates the app (permissions per SPEC §6.5.3) and sets the `GITHUB_*` env. Then install it, run backfill, and check the §6.5.2 matrix against a real repo.
- **MCP:** connect Claude Desktop and Cursor via `npx @velocity/mcp` (`apps/mcp/README.md`). Run create, comment and close through a real client, and the HTTP transport too.
- **Verify:** a short checklist in `docs/agents.md`, plus any fixes found.

**Status 2026-10-05:** The real stdio process and Streamable HTTP transport passed a local create→comment→Done→readback test; `docs/agents.md` has the live-client checklist. Claude Desktop, Cursor and a real GitHub App/repository check need the owner's clients and credentials.

### R8 — Release pipeline · Codex + owner credentials · SPEC §7.1.5
- Dry-run `.github/workflows/release.yml`: multi-arch buildx, syft SBOM, cosign signing, and the `@velocity/mcp` npm publish (check that it's `--dry-run`-able).
- `act` or a fork works for the first test. The owner provides the registry and npm credentials when publishing for real.
- **Verify:** a dry-run produces images, an SBOM and signatures.

**Status 2026-10-05:** A local buildx run produced an amd64/arm64 OCI archive; Syft produced an SPDX SBOM for each; Cosign signed and verified the archive and both SBOMs with an ephemeral local key; npm publish dry-run passed. The release workflow now waits for image success before npm publish and attaches the SBOM after signing. `docs/release.md` records evidence and the remote credentials/OIDC check still needed for an actual tag.

### R9 — Docs final pass · Codex (UI section: Claude)
- Bring `README.md`, `docs/api.md`, `docs/import.md`, `docs/architecture.md` and `docs/self-hosting.md` up to date with this snapshot and the §7 deviations.
- Claude adds the UI section to `docs/architecture.md`: design-system usage and the keyboard map.

**Status 2026-10-05:** The Codex-owned README, API, import, architecture and self-hosting content was updated to the current snapshot. Claude's design-system usage and keyboard-map section remains.

**Status 2026-10-05 (Claude): done.** `docs/architecture.md` now has a "Web UI and design system" section covering token flow, the component inventory, §4.10 geometry, theming, the design boundary and baseline workflow, and a keyboard map checked against the `useCommands` registry, including where it differs from SPEC §4.12.

### R10 — Owner decisions (§8)
Team-key rename behavior, PR-open status transitions, and the product name. "Velocity" is a working title; `BRANDING.md` lists every occurrence, so a rename is mechanical.

**Suggested order:** R1 + R2 (highest risk) → R6 + R3 → R4 → R5 → R7 (needs the owner) → R8 → R9.

---

## 7. Deviations from SPEC already made (document in `docs/architecture.md`)

- **Dark theme** comes from the current published `@atlaskit/tokens` `atlassian-dark` theme (SPEC §4.3: "published tokens win"). Light is SPEC-exact. Dark lozenge text is lightened for 4.5:1 contrast.
- **Extra tables:** `workspace`, `invites`, `team_counters`, `project_teams`, `issue_activity`, `favorites` (orderable), `mcp_sessions`, `import_items`, `exports`. `api_keys` also has a `prefix` column.
- **Tests** use a shared Postgres (`TEST_DATABASE_URL`) with a per-run template DB, not testcontainers.
- **Markdown sanitizer** escapes raw HTML instead of stripping it; unsafe URL schemes become `#`.
- **Webhook retries** use the app's own schedule (1m, 5m, 15m, 30m, 60m), then dead-letter.
- **Cycles:** hourly rotation sweep (per-team local midnight). A manual early close shortens `endsAt`.
- **GitHub:**
  - installation tokens are minted per call, never stored;
  - backfill links PRs without notifications or auto-close;
  - commits link on any reference but never close issues.
- **MCP** has 13 tool names (`get_project` and `list_projects` are separate).
- **API surface:** GraphiQL disabled (no third-party JS); introspection on; persisted documents not implemented.
- **Behavior choices:** `is:blocked` counts unresolved blockers only; `DISABLE_SIGNUP=false` enables open signup; rate limits are per process.
- **E2E** WebKit runs in Docker on non-Ubuntu hosts. Visual baselines are Chromium-only.

## 8. Open questions for the owner

- Should team-key renames keep old identifiers resolvable? Today a rename breaks old `ENG-123` references.
- On PR open, should the issue move to In Progress? Only auto-close on merge is implemented (SPEC §6.5.2).
- Product name: "Velocity" is a working title (SPEC §1.6).

---

## 9. Cross-team requests

Append rows; the owner of the target path marks them done.

| # | From → To | Request | Status |
|---|---|---|---|
| 1 | Claude → Codex | `uploadAvatar` mutation + `GET /avatars/:id` | **done** |
| 2 | Claude → Codex | Web build output `apps/web/dist` → Dockerfile `/app/web-dist` | **confirmed** |
| 3 | Lead (Claude) | `check-legal` ignores generated `apps/web/src/gql/` for the UI-copy rule | **done** |
| 4 | Claude → Codex | `auditLog(after, before)` date-range args | **done** |
| 5 | Claude → Codex | `removeAvatar` mutation + Profile "Remove" | **done** |
| 6 | Claude → Codex | CI: run E2E against source or bundle? | **decided:** CI builds and uses a fresh bundle; local runs use source |
| 7 | Claude → Codex | Deterministic seed option for visual baselines (R4) | **done** (Codex, `--deterministic`); mask removal + baselines with Claude |
