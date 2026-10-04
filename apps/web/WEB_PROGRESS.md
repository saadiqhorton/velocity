# Web app progress (WP1 · WP2 · WP7a · WP9)

Owner: Claude (web/UI/design). This file is how the next agent picks up. Keep it current after every chunk of work.
Rules, contracts and environment: `HANDOFF.md` §0–§5 (your rows: §1 "Web app", §6 WP1/WP2/WP7a/WP9, §9). Backend status: `HANDOFF.CODEX.md`. Spec: `SPEC.md` (§4 binding).

## Handover log
- **Agent 1** built most of WP1, then stopped at a usage limit without notes (the lead reconstructed its state).
- **Agent 2 (Opus 5.5, 2026-10-04)** fixed lint, wrote the unit tests, built the settings shell, delegated and merged all WP2 screens, and built the E2E harness plus 13 specs. It stopped at an account session limit at a clean checkpoint: the app builds and the gates below are green. The pickup checklist below is the next agent's to-do list.
- **Codex / C checkpoint (2026-10-04):** Verified the 1,000-row CSV import from upload through mapping, dry run, live progress, completed 1,000/1,000 commit, and search visibility (`e2e/import.spec.ts`, Chromium, slot 3: setup + seed + import 3/3). Fixed missing mapping summary with a bounded metadata projection and historical closed-cycle import failures; `packages/services` core + importer DB tests 34/34, services/graphql typecheck and changed-file ESLint pass. `e2e/settings.spec.ts` is a draft: API key create/show-once/revoke passed in the first run; seven other cases are skipped pending verification. Settings click-through remains open, including profile/avatar, sessions, workspace deletion, members, teams/workflow/cycles, labels, webhooks, GitHub, MCP, export and audit. Rerun: `cd apps/web && E2E_SLOT=3 npx playwright test e2e/import.spec.ts --project=chromium`; `cd packages/services && pnpm exec vitest run test/db/core.test.ts test/db/importer.test.ts`. Re-enable each skipped settings case only as it is verified.
- **Codex / A checkpoint (2026-10-04):** Lane A's four specs passed on Chromium slot 1 across the final runs: board 3/3, bulk 4/4, reorder 3/3, infinite scroll 2/2 (plus setup/seed per run). Verified X/Shift+X, toolbar status/assignee/priority/labels/project, archive+undo, delete+confirmation, B, board drag and M, Alt+Up/Down and row drag persistence, and all 400+ virtualized rows without duplicate identifiers or index gaps. Fixed board-card focus tracking, reorder neighbor direction and optimistic edge ordering, and Enter activation in the bulk toolbar. The 16 original spec ESLint errors are gone; changed-file ESLint, web typecheck and build pass. **Open:** E2E seed has no ENG cycle, so the bulk cycle picker opens and shows only “No cycle”; assigning a real cycle remains unverified. The combined four-spec suite was not rerun after the last additions; passing results are from board, bulk, reorder and infinite-scroll runs plus the targeted bulk rerun. Rerun: `pnpm --filter @velocity/web build`; `cd apps/web && E2E_SLOT=1 npx playwright test e2e/bulk.spec.ts e2e/board.spec.ts e2e/reorder.spec.ts e2e/infinite-scroll.spec.ts --project=chromium --workers=1`; `pnpm exec eslint apps/web/e2e/{bulk,board,reorder,infinite-scroll}.spec.ts apps/web/src/components/issues/{IssueBoard,IssueList}.tsx apps/web/src/components/overlays/SelectionBar.tsx`.
- **Codex / B checkpoint (2026-10-04):** Initial Chromium slot-2 run passed offline 2/2 and realtime 2/2; panel 3/4 exposed an Esc bug in full-page issues. Fixed full-page Esc and verified its targeted regression. Added panel coverage for title, inline properties, subscription, activity, comment submit/edit/reaction/delete, sub-issues and relations; each new test passed separately under production CSP. Fixed reaction-chip accessible names. Web build and typecheck pass. The three-spec combined rerun after these changes remains open, as do cycle and milestone picker coverage, forced mutation rejection/rollback, and explicit offline reconnect refetch assertion. Rerun: `pnpm --filter @velocity/web build`; `cd apps/web && E2E_SLOT=2 npx playwright test e2e/panel.spec.ts e2e/realtime.spec.ts e2e/offline.spec.ts --project=chromium --workers=1`; `pnpm --filter @velocity/web typecheck`.
- **Impl / Lane F (2026-10-04, in progress, slot 8; DIAGNOSIS §5):** T1 done (F1): guard freezes after the context fixture's `use`; pi's WebKit `trace` override reverted; board + a11y 15/15 on Chromium and WebKit; a body-time inline `<style>` still fails on both. T2 done: pi's nonce rewrites removed from `static.ts`; new `apps/server/test/static.test.ts`; server 13/13. T3 done (F2, F3): `runInBackground`, prefetch `.catch`, `ChunkBoundary`; WebKit bulk + offline ×3 clean (the WebKit navigation-cancel log is tolerated narrowly in the guard). T4 done: `scripts/e2e-webkit-docker.sh`. T6 done (A5, B3, F5, F6, F7): bulk cycle assignment, unconditional panel cycle, rollback test, reconnect-refetch test plus its app fix in `lib/apollo.ts`, `visual.spec.ts` generation fix (normal run 8 skipped; an explicit update run writes baselines, proven into /tmp only); bulk + panel + offline 17/17 on Chromium and WebKit. Gates so far: web vitest 481/481, `pnpm typecheck` 13/13, `pnpm test` (Turbo) 13/13 tasks.

## Coordination (Codex QA lanes + Claude design; see `HANDOFF.md` §0 and `CODEX_WEB_QA.md`)

### Active claims
Add a row before editing a file under `apps/web/src`; remove it when done. Never edit a file someone else has claimed.

| Owner / lane | Files | Task | Since |
|---|---|---|---|
| Impl / Lane F (slot 8) | `e2e/support/fixtures.ts`, `playwright.config.ts`, `src/components/editor/LazyEditor.tsx`, `src/components/common/ChunkBoundary.tsx` (new), `src/components/shell/DetailPanel.tsx`, `src/lib/{apollo,realtime,mutation,errors}.ts(x)`, `src/components/issues/useIssueList.ts`, `e2e/{bulk,panel,offline,visual}.spec.ts`, `scripts/e2e-webkit-docker.sh`; `apps/server/src/http/static.ts` + `apps/server/test/` | DIAGNOSIS §5 T1–T10 | 2026-10-04 |

### QA findings
| ID | Lane | Screen / flow | Severity | Finding | Status / fix (+ test) |
|---|---|---|---|---|---|
| B1 | B | Full-page issue navigation | major | Esc did nothing on `/issue/:id`. | fixed in `GlobalCommands.tsx`; `panel.spec.ts` full-page test passes |
| B2 | B | Comment reactions | minor | A reaction chip's accessible name was only its count; the emoji was hidden from assistive technology. | fixed in `Comments.tsx` with an emoji-and-count label; `panel.spec.ts` comment test passes |
| B3 | B | Detail properties | minor | Cycle picker is absent for the wizard-created ENG team because cycles are disabled; enabled-cycle property editing remains untested. | fixed in test: the seed enables ENG cycles and `panel.spec.ts` now requires `prop-cycle` and checks it after reload (Impl/F) |
| C1 | C | Import mapping preview | major | All source summary counts and metadata were absent because slim import-run responses replaced `config` with `{}` before GraphQL derived `summary`. | fixed with compact teams/statuses/users/counts projection; `import.spec.ts` mapping assertions and `importer.test.ts` slim response assertions pass |
| C2 | C | Historical CSV import | major | 119 of 1,000 issues failed when their mapped historical cycles were closed. | fixed by allowing closed-cycle references only for the import actor while retaining normal validation; `import.spec.ts` 1,000/1,000 commit and `core.test.ts` actor distinction pass |
| A1 | A | Board keyboard M | major | Focusing a board card did not update the active issue, so M had no target. | fixed in `IssueBoard.tsx`; `board.spec.ts` keyboard move passes |
| A2 | A | Manual issue reorder | major | UI passed before/after neighbors in reverse order; Alt+Up failed at the top edge and optimistic open-end values were reversed. | fixed in `IssueList.tsx`; `reorder.spec.ts` up/down/drag persistence passes |
| A3 | A | Bulk toolbar keyboard | major | Enter on a focused toolbar button also opened the active issue through the list shortcut. | fixed in `SelectionBar.tsx`; `bulk.spec.ts` assignee and archive keyboard activation pass |
| A4 | A | Infinite scroll QA | minor | Earlier test counted mounted virtual rows and could pass without proving full pagination or uniqueness. | fixed test in `infinite-scroll.spec.ts`; all 400+ row indices and identifiers verified |
| A5 | A | Bulk cycle assignment | minor | Seeded ENG team has no cycles, so bulk cycle assignment to a real cycle was not exercised. | fixed in test: the seed enables ENG cycles; `bulk.spec.ts` "bulk bar edits status, assignee, project, and cycle" assigns the current cycle and checks it in the panel after reload (Impl/F) |
| C3 | C (opencode) | Team delete dialog | minor | The replacement-team `Select`s had no accessible names, so the spec (and screen readers) could not target them. | fixed (opencode): ids/labels on the `Select`s; `settings.spec.ts` team delete passes |
| C4 | C (opencode) | Webhooks / invite specs | minor | Test bugs: strict-mode locator collisions and test-delivery assertions in the webhook spec; the invite spec clicked "Accept invite" while the UI says "Create account". | fixed in the specs (opencode); `settings.spec.ts` 9/9 |
| D3 | D (opencode) | Move issue / cycle scope | major | `V` (move issue to another team, SPEC §4.12) and the per-row "added after start" marker were missing. | built (opencode): `IssueCommands.tsx`, `IssueContextMenu.tsx`, `IssueRow`/`TeamCycles`; `planning.spec.ts`, `workspace.spec.ts` pass |
| F1 | F | E2E harness (WebKit) | blocker | The CSP guard kept recording during fixture teardown; Playwright's pre-close `only-on-failure` screenshot injects `<style>body {}</style>` on WebKit, which the CSP blocks, so 66 of 70 WebKit tests failed falsely. | fixed in `e2e/support/fixtures.ts` (`guard.closed` after the context fixture's `use`); pi's WebKit `trace` override reverted. board + a11y 15/15 on both browsers; a body-time inline `<style>` still fails on both (T1) |
| F2 | F | Offline: editor prefetch | minor | `preloadEditor()` ran `import()` with no `.catch`; offline it raised "Unhandled Promise Rejection: Importing a module script failed" (WebKit). A failed lazy chunk also replaced the whole app with the route error screen. | fixed: `.catch` on the editor and detail-panel prefetches; `ChunkBoundary` + `retryableLazy` give inline retry (`ChunkBoundary.test.tsx`); WebKit `offline.spec.ts` ×3 clean |
| F3 | F | Refetch cancelled by navigation | minor | Fire-and-forget refetches (`apollo.ts`, `realtime.tsx`, `mutation.ts`, `useIssueList.ts`) had no `.catch`, so a reload during a refetch left an unhandled rejection. WebKit also logs "Fetch API cannot load … due to access control checks" for any fetch a navigation cancels, and Playwright reports that as a page error even when it is handled. | fixed: `runInBackground` in `lib/errors.ts` (`errors.test.ts`); the guard tolerates only that WebKit message, same-origin, within 3 s of a main-frame navigation (attached as `tolerated-page-errors`). WebKit `bulk.spec.ts` ×3 clean |
| F4 | F (pi) | `check-hex` | minor | `check-hex` scanned the E2E slot output dirs (`test-results_<n>`). | fixed by pi; `node --test scripts/*.test.mjs` 8/8 |
| F5 | F | Reconnect refetch | major | If the socket survived an outage (a short blip, or WebKit offline mode), events delivered while offline triggered refetches that failed, and nothing refetched on reconnect: the list stayed stale. | fixed in `lib/apollo.ts`: an offline→online transition refetches active queries (`apollo.test.ts`); new `offline.spec.ts` "reconnecting refetches what changed while offline" |
| F6 | F | Rollback coverage | minor | No test forced a server rejection. | added `panel.spec.ts` "a rejected edit applies optimistically, rolls back, and explains why in a flag" (GraphQL VALIDATION via `page.route`) |
| F7 | F | `visual.spec.ts` | minor | It skipped whenever baselines were missing, so `--update-snapshots` could never create the first ones. | fixed: skips only when baselines are missing and no update was requested (`--update-snapshots` or `VISUAL_UPDATE=1`); a normal run still skips and writes nothing |

### Design review queue (Claude)
Visual problems, plus minimal visual changes made during functional fixes. Claude reviews and fixes these at the source (`packages/ui`, tokens) during the design pass.

| ID | Logged by | Screen | What / where | Status |
|---|---|---|---|---|
| D1 | lead | All WP2 screens | Light theme + 1024 not yet reviewed (dark 1440 done) | open |
| D2 | lead | E2E visual baselines | Generate and approve `visual.spec.ts` baselines after the design pass | open |

## Current state (verified 02:30, 2026-10-04)
| Gate | Result |
|---|---|
| `apps/web` typecheck | clean on 2026-10-04 after Lane B's panel spec fix |
| `pnpm exec eslint apps/web packages/ui packages/tokens` | clean |
| `node scripts/check-hex.mjs` / `check-legal.mjs` | ok / ok (lines naming the importer source are tagged `check-legal-ignore`, SPEC §6.7) |
| Web unit tests `cd apps/web && npx vitest run` | **476/476**, ~4s |
| `packages/ui` vitest · typecheck | 32/32 · clean |
| Build `pnpm --filter @velocity/web build` | OK. **Initial JS 175.5 KB gzip** (`node scripts/bundle-size.mjs`, budget 350). Every route is its own chunk; the markdown editor is lazy (~144 KB gz) |
| `packages/graphql` web-parity (`npx vitest run test/web-parity.test.ts`) | 5/5 pass, including all new WP2 `.graphql` operations |
| E2E chromium, verified green | wizard (setup) + seed, keyboard-loop 4, palette 5, views 2, theme 2, layout 4 (1440/1024 × dark/light), a11y 10 screens with zero critical: **31 tests** |
| E2E written, not yet verified | `bulk`, `board`, `reorder`, `infinite-scroll`, `panel`, `realtime`, `offline` (the agents writing them hit the session limit) |
| E2E import verified | `import.spec.ts` 1,000-row CSV: upload, mapping, dry run, live commit, search visibility (Chromium slot 3: 3/3 including setup + seed) |
| E2E not yet written | visual snapshots (gallery + shell, both themes, 1440 + 1024), cycle rotate, GitHub installation link mock (configured-state mock is drafted/skipped in `settings.spec.ts`) |
| WebKit | not run yet |

The unit tests cover the keyboard engine (63), chips↔DSL↔URL view state (72), the optimistic wrapper with rollback/flag/pulse plus error mapping (36), client grouping and ordering against the server SQL (279, property-based with a seeded PRNG), selection (13) and fuzzy matching (13).
Bugs they found, all fixed:
- A cleared filter was lost when the screen's default filter was non-empty.
- uuid tie-breaks used a numeric collator, but Postgres compares bytes.
- Title ordering used natural-number collation.

## Pickup checklist (do in order)

> **Superseded on 2026-10-04.** Items 1–5, 7 and 8 are now split into Codex lanes A–F in `CODEX_WEB_QA.md`. Item 6 (design pass) stays with Claude. Kept below for reference.

1. **Environment**
   - Start the dev servers: `apps/web/.dev-data/start-api.sh` starts the API on :3100 against DB `velocity_dev_web` with `APP_URL=http://localhost:5173`. `start-vite.sh` starts Vite on :5173. `stop.sh` stops both.
   - PIDs are written to `.dev-data/*.pid`. Never `pkill -f`.
   - Login: `demo` / `correct-horse-battery-staple`. Other members: alex, sam, jordan, same password.
2. **Gates**
   - Run `packages/graphql` web-parity.
   - Re-run every gate in the table above.
3. **Unverified E2E specs**
   - Fix `e2e/panel.spec.ts:25` first: pass a file path or a context, not a Promise.
   - Then run each spec: `cd apps/web && E2E_SLOT=<n> npx playwright test <spec> --project=chromium`.
   - Fix test bugs in the spec. Fix real app bugs in the app.
   - Each spec targets these app files: bulk → SelectionBar/PickerHost; board → `components/issues/IssueBoard.tsx`; reorder → IssueList `⌥↑/↓` + drag; infinite-scroll → `useIssueList`; panel → IssueDetail + MarkdownEditor under CSP; realtime → `lib/realtime.tsx`; offline → `Banners.tsx` + `stores/sync.ts`.
4. **Missing specs**
   - `import.spec.ts`: generate the CSV with `packages/importers/scripts/generate-linear-csv.ts`, then walk the wizard at `/settings/import`. A 50-row run already completed by hand, so the flow works.
   - `visual.spec.ts`: `toHaveScreenshot` on `/__gallery?enable=1` and the shell, in both themes, at 1440 and 1024, Chromium only. Mask relative times.
   - Optional: cycle rotate, GitHub mock.
5. **Click-through verification of the WP2 screens.** They are built and screenshot-reviewed in dark at 1440 but not exercised end to end since the first build wave was cut off. Exercise each flow:
   - members/invites;
   - team create/edit/workflow editor;
   - labels CRUD;
   - API key create/reveal-once/revoke;
   - webhooks create/test/redeliver;
   - import wizard;
   - project create/edit/milestones;
   - cycles close/rotate dialogs (cancel; don't close the seeded cycle);
   - inbox E / mark all read;
   - search keyboard;
   - view save/share;
   - favorites reorder in the sidebar.
6. **Design pass**
   - Capture light and 1024 screenshots of every WP2 screen: `node scripts/screenshots.mjs --pages="name:/path,…" --out=/tmp/x --sizes=1440x900,1024x768 --themes=dark,light`. Then look at them.
   - Known nit: dark-1440 is polished; light and 1024 haven't been reviewed for WP2.
   - Responsive was checked at 1024, 800 and 390: the sidebar drawer works below 768, and tables now scroll horizontally on phones.
7. **Open functional gaps**
   - Cycle lists have no per-row "added after start" marker. Only a header summary exists; add an optional prop to `IssueRow`.
   - The `V` shortcut ("move issue, context menu", SPEC §4.12) is not implemented.
   - Audit-log date filter and avatar removal wait on backend (HANDOFF §9 rows 4–5).
8. **Finish**
   - Run WebKit: `npx playwright test --project=webkit`.
   - Do a final production-mode CSP check. It is covered by E2E (the API serves `dist`), but also open the app at `APP_URL=http://localhost:3100` once.
   - Update HANDOFF §1/§6 and this file.
   - Stop the dev servers.

## How work was organized (reuse it)
- The lead (Opus) integrates, reviews, fixes core files and owns `packages/ui`. Small, well-scoped tasks go to subagents:
  - Haiku through the Agent tool, `model: "haiku"`.
  - The user's local **opencode** server at `127.0.0.1:4096`, through `apps/web/.dev-data/oc.py`:
    - `start <name> <promptfile> [provider/model]` (default `opencode-go/gpt-5.6-luna`), then `status`, then `last <name>`;
    - sessions are tracked in `.dev-data/oc/sessions.json`.
  - opencode agents delivered views, theme, layout and a11y; all four were re-verified green by the lead.
- Briefs, all gitignored under `.dev-data/`:
  - `AGENT_BRIEF.md`: general rules, building blocks, verification for screen work.
  - `E2E_BRIEF.md`: one spec per agent, slot isolation, report format.
  - `oc/*.txt`: example prompts.
- Never let two agents edit the same file. Shared files (`src/i18n/en.ts`) get section-scoped appends only. New GraphQL operations go in a new file per area: `src/graphql/<area>.graphql`, then run `npx graphql-codegen --config codegen.ts`.

## Architecture map (apps/web/src)
- **App wiring**
  - `app/`: router (lazy routes), AuthGate (setup/login routing), workspace context (Bootstrap query → `useWorkspace()`).
  - `lib/`:
    - `apollo.ts`: CSRF, multipart uploads, WS split, cache policies, reconnect + refetch.
    - `mutation.ts`: the only `useMutation`; optimistic contract + rollback flag + sync pulse.
    - `issueCache.ts`, `realtime.tsx`: `workspaceEvents` → debounced refetch.
    - `viewState.ts` / `chips.ts`: URL ↔ chips ↔ DSL.
    - `grouping.ts`: client order mirrors the server SQL.
    - `navigation.ts`: `?issue=` panel.
    - `targets.ts`: which issues a shortcut acts on.
    - `errors.ts`, `format.ts`, `fuzzy.ts`.
  - `keyboard/`: engine (scopes global/list/panel, chords, registry) + React bindings (`useCommands`).
  - `stores/`: zustand stores for selection, active list, ui, theme, sidebar, listPrefs, sync, recent, connection, detail.
- **Components** (`components/`)
  - `shell/`: AppShell (sidebar | content | panel, no top bar), Sidebar, ViewHeader (48px), DetailPanel (400/360), Banners, MobileNav drawer, ShellSkeleton.
  - `issues/`: ListScreen (URL view state + FilterBar + DisplayOptions + list/board), IssueList (virtualized, sticky groups, J/K, X/⇧X, ⌥↑/↓, DnD), IssueRow (32px), IssueBoard, actions (optimistic hooks), pickers.
  - `issue-detail/`, `overlays/` (CreateIssueModal, PickerHost, SelectionBar, RelationDialog, DeleteConfirm), `palette/` (CommandPalette, ShortcutsHelp), `commands/` (Global + Issue command registrations), `editor/` (lazy tiptap, CSS injection off for CSP), `charts/` (SVG: DualLineChart, VelocityBars, Sparkline), `common/` (EntityIcons, FavoriteButton).
- **Screens** (`screens/`)
  - `auth/` (Setup wizard, Login, Invite), `team/` (Active, Backlog, All, Cycles), `issue/`, `project/` (list table, create modal, detail tabs, milestones timeline), `insights/`, `inbox/`, `search/`, `views/` (list + builder), `my-issues/`, `dev/` (gallery).
  - `settings/`: `Settings.tsx` (secondary nav + nested lazy routes, owner-only redirect) and `common.tsx` (SettingsPage/Section/Row). Sections live in `account/`, `workspace/`, `integrations/` and `data/`.
- **i18n:** `i18n/en.ts` is the typed catalog. The sections `settingsWorkspace`, `settingsAccount` and `settingsIntegrations` were added by WP2.
- **E2E**
  - `e2e/support/server.mjs`: recreates `velocity_e2e_web[_n]` and runs the API from source, serving `dist`.
  - `env.mjs`: `E2E_SLOT`, CI vs local.
  - `fixtures.ts`: the CSP/page-error guard, `newSession`, helpers.
  - `wizard.setup.ts` runs the first-run wizard through the UI; `seed.setup.ts` runs `seed-cli --issues 400`.
- **Scripts**
  - `scripts/screenshots.mjs`: built-in flows, or `--pages/--out/--wait/--full`.
  - `scripts/bundle-size.mjs`: initial-JS budget.

## Design decisions worth reviewing
- **Settings layout:** settings open inside the content region, with a secondary nav column in the content area (not a separate shell) and a breadcrumb header in place of a top bar (SPEC §4.11.9).
- **Responsive sizes:** sidebar 180 / panel 360 at 1024–1280 per §4.10.2. The layout test asserts 180±2 at 1024.
- **Tables on phones:** `packages/ui` `Table` gets `min-w-160` so tables scroll horizontally instead of crushing columns.
- **Hidden below breakpoints:** the team header's cycle progress bar is hidden below `lg`; "Show archived" on Projects is hidden below `sm`.
- **Audit log:** uses explicit pagination (§4.9.12). Its date presets filter on the client until HANDOFF §9 row 4 lands.
- **Import source names:** "Linear"/"Jira" appear in the import wizard copy as nominative names of import sources (SPEC §6.7). Those lines carry `check-legal-ignore`.
- **E2E server:** local E2E runs the API from source, because a stale `apps/server/dist` bundle once hid backend fixes. CI still uses the bundle it builds.

## Dev data notes
- `velocity_dev_web` is seeded: ~600 issues, teams ENG/WEB/OPS (ENG has an active cycle), projects including test ones ("Project 1–4"), and one test webhook (`https://example.com/hooks/velocity-test`).
- Two completed or canceled import runs exist (into WEB).
- Agent 2 deleted a leftover TMP team and reset the demo avatar.
- E2E databases `velocity_e2e_web` and `velocity_e2e_web_1…8` are disposable.
- Dev servers (API :3100, Vite :5173) were stopped at the agent 2 checkpoint; restart with the scripts above.
