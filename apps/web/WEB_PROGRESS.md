# Web app progress (WP1 · WP2 · WP7a · WP9)

Owner: Claude (web/UI/design). This file is how the next agent picks up. Keep it current after every chunk of work.
Rules, contracts and environment: `HANDOFF.md` §0–§5 (your rows: §1 "Web app", §6 WP1/WP2/WP7a/WP9, §9). Backend status: `HANDOFF.CODEX.md`. Spec: `SPEC.md` (§4 binding).

## Handover log
- **Claude / R4, R5, R9 (2026-10-05, slot 7):**
  - **R4.** The shell baseline no longer masks the sidebar nav, issue list, count, cycle picker or cycle progress. Only `time` elements and dated titles (this year and last) stay masked, because seeded timestamps follow the run date.
    - The first unmasked full run showed that the suite's own data leaks into the shot. Earlier specs add issues and teams with random names (`uniqueTitle`, e.g. "In-cycle muv8luw56w", team "Cycle rotation CQ6W"), and the visual spec ran last.
    - The spec is now `e2e/0-visual.spec.ts` (baselines in `e2e/0-visual.spec.ts-snapshots/`). Playwright runs files in name order on one worker, so it runs straight after setup + seed against the deterministic data, in both Chromium-only and CI-shaped runs. There is no project dependency, so a visual failure never blocks the other specs.
    - Determinism: two fresh full runs gave identical light shell screenshots (AE 0). The dark ones differed by 7 and 18 antialiasing pixels (max channel delta 3/255), against a tolerance of about 2,600 pixels.
    - All 8 baselines were re-taken with `--update-snapshots=all` and reviewed. The 4 shell PNGs changed; the 4 gallery PNGs were pixel-identical and were not rewritten.
    - Normal full Chromium runs on two fresh databases: 83/83 both times.
  - **R5.** Below 768px the settings header now has a "Sections" menu button (`screens/settings/nav.tsx` `SettingsSectionMenu`, an ADS `DropdownMenu` grouped like the side list).
    - Keyboard: ArrowDown/Enter/Space opens the menu and focuses the first item; arrows, Home/End and typeahead move within it; Esc closes it.
    - The current section is marked with `aria-current="page"` and a check, using the new `MenuItem current` prop in `packages/ui`. Owner-only sections and empty groups are hidden for members.
    - After a pick, focus returns to the new page's menu button. The section data now lives in one place (`settingsNavGroups`) for both the side list and the menu.
    - Tests: `nav.test.tsx` (4), `packages/ui` `menu.test.tsx` (+1), and the E2E `layout.spec.ts` "phone settings".
    - Screenshots reviewed: `/tmp/r5/{dark,light}-390-*` and `-768-*` (owner, member, nested team page, menu open). At 768 the side list shows and the button is hidden.
    - D3 recheck of the chunk-load messages: the editor (1440) and panel (768) messages render well. At 390 the full-page issue route does not use `ChunkBoundary`, so it falls to the full route error (QA G1).
  - **Gates:**
    - Web typecheck clean; build OK; initial JS 176.6 KB gzip (budget 350).
    - Web vitest 487/487; `packages/ui` tests 33/33 and typecheck clean.
    - Whole-repo eslint (`--max-warnings=0`), `check-hex` and `check-legal`: all clean.
    - Full Chromium E2E 83/83 twice on fresh databases. Full WebKit Docker: 75 passed, 8 visual skips.
    - Dev servers stopped.
  - **R9.** Added a "Web UI and design system" section to `docs/architecture.md`: token flow, component inventory, §4.10 geometry, theming, design boundary and baseline workflow, and a keyboard map checked against the `useCommands` registry.
- **Codex release-hardening verification (2026-10-05, slot 4):** Full Chromium E2E 82/82 passed (including approved visual snapshots); full WebKit Docker E2E 74 passed, eight expected visual-only skips. Web build and bundle check passed (176.5 KB gzip initial JS). Whole-repo Turbo typecheck/tests passed 13/13 each; lint, check-hex, check-legal and diff check passed. No baselines were regenerated.
- **Codex / R4 (2026-10-05):** The E2E seed runs `seed-cli --deterministic`. Two fresh wizard+seed runs on isolated slot 5 produced byte-identical, unmasked 1440×900 dark shell screenshots (`sha256 244d8d9e77e924768409bcc3b1d614beafc7df0d782846516cdfbf440ae9fe82`, ImageMagick AE 0). Normalized issue content/timestamps from two independently seeded 400-issue databases also hashed identically. The visual baseline masks remain for the design owner to remove and approve; no baseline was regenerated.
- **Codex / R6 (2026-10-05):** `integrations.spec.ts` covers manual cycle close and carry-over, and signed GitHub PR-open/merge events through the webhook queue. The cycle test found and fixed a gap where early close left the pre-created next cycle in the future. Focused Chromium and WebKit Docker runs passed (4/4 including setup and seed), as did web/services typecheck and focused lint.
- **Codex / R5 (2026-10-05):** Editor and issue panel chunk failures now use specific catalog messages while keeping the inline Retry flow. `ChunkBoundary.test.tsx` and web typecheck pass. The mobile settings section menu remains with the design owner.
- **Agent 1** built most of WP1, then stopped at a usage limit without notes (the lead reconstructed its state).
- **Agent 2 (Opus 5.5, 2026-10-04)** fixed lint, wrote the unit tests, built the settings shell, delegated and merged all WP2 screens, and built the E2E harness plus 13 specs. It stopped at an account session limit at a clean checkpoint: the app builds and the gates below are green. The pickup checklist below is the next agent's to-do list.
- **Codex / C checkpoint (2026-10-04):** Verified the 1,000-row CSV import from upload through mapping, dry run, live progress, completed 1,000/1,000 commit, and search visibility (`e2e/import.spec.ts`, Chromium, slot 3: setup + seed + import 3/3). Fixed missing mapping summary with a bounded metadata projection and historical closed-cycle import failures; `packages/services` core + importer DB tests 34/34, services/graphql typecheck and changed-file ESLint pass. `e2e/settings.spec.ts` is a draft: API key create/show-once/revoke passed in the first run; seven other cases are skipped pending verification. Settings click-through remains open, including profile/avatar, sessions, workspace deletion, members, teams/workflow/cycles, labels, webhooks, GitHub, MCP, export and audit. Rerun: `cd apps/web && E2E_SLOT=3 npx playwright test e2e/import.spec.ts --project=chromium`; `cd packages/services && pnpm exec vitest run test/db/core.test.ts test/db/importer.test.ts`. Re-enable each skipped settings case only as it is verified.
- **Codex / A checkpoint (2026-10-04):** Lane A's four specs passed on Chromium slot 1 across the final runs: board 3/3, bulk 4/4, reorder 3/3, infinite scroll 2/2 (plus setup/seed per run). Verified X/Shift+X, toolbar status/assignee/priority/labels/project, archive+undo, delete+confirmation, B, board drag and M, Alt+Up/Down and row drag persistence, and all 400+ virtualized rows without duplicate identifiers or index gaps. Fixed board-card focus tracking, reorder neighbor direction and optimistic edge ordering, and Enter activation in the bulk toolbar. The 16 original spec ESLint errors are gone; changed-file ESLint, web typecheck and build pass. **Open:** E2E seed has no ENG cycle, so the bulk cycle picker opens and shows only “No cycle”; assigning a real cycle remains unverified. The combined four-spec suite was not rerun after the last additions; passing results are from board, bulk, reorder and infinite-scroll runs plus the targeted bulk rerun. Rerun: `pnpm --filter @velocity/web build`; `cd apps/web && E2E_SLOT=1 npx playwright test e2e/bulk.spec.ts e2e/board.spec.ts e2e/reorder.spec.ts e2e/infinite-scroll.spec.ts --project=chromium --workers=1`; `pnpm exec eslint apps/web/e2e/{bulk,board,reorder,infinite-scroll}.spec.ts apps/web/src/components/issues/{IssueBoard,IssueList}.tsx apps/web/src/components/overlays/SelectionBar.tsx`.
- **Codex / B checkpoint (2026-10-04):** Initial Chromium slot-2 run passed offline 2/2 and realtime 2/2; panel 3/4 exposed an Esc bug in full-page issues. Fixed full-page Esc and verified its targeted regression. Added panel coverage for title, inline properties, subscription, activity, comment submit/edit/reaction/delete, sub-issues and relations; each new test passed separately under production CSP. Fixed reaction-chip accessible names. Web build and typecheck pass. The three-spec combined rerun after these changes remains open, as do cycle and milestone picker coverage, forced mutation rejection/rollback, and explicit offline reconnect refetch assertion. Rerun: `pnpm --filter @velocity/web build`; `cd apps/web && E2E_SLOT=2 npx playwright test e2e/panel.spec.ts e2e/realtime.spec.ts e2e/offline.spec.ts --project=chromium --workers=1`; `pnpm --filter @velocity/web typecheck`.
- **opencode (DeepSeek V4.1 Flash, 2026-10-04 09:47–11:16), Lanes C/D/E/F:** finished C (`settings.spec.ts` 9/9: team-delete `Select` ids, webhook strict-mode/test-delivery assertions, invite button label "Create account"), D (`planning.spec.ts` 4, `workspace.spec.ts` 4, `V` move menu, "added after start" marker) and E (`auditLog(after, before)` with server-side date presets, `removeAvatar` + Profile "Remove"). It wrote `visual.spec.ts` and ran the full Chromium suite. Reconstructed from DIAGNOSIS §2.1/§3.2; it left no entry of its own.
- **pi (DeepSeek V4.1 Flash, 11:18–12:17), Lane F:** got full Chromium green (70 passed, 8 skipped), fixed `check-hex` for slot output dirs (F4), and started the WebKit pass in Docker. It was paused during a wrong-path CSP hunt; its speculative `static.ts` nonce edits and WebKit `trace` override were reverted in T1/T2 below (DIAGNOSIS §2.1, R2).
- **Impl / Lane F (2026-10-04 12:45–14:50, slot 8; DIAGNOSIS §5 T1–T10): done.**
  - T1 (F1): the guard freezes after the context fixture's `use`. pi's WebKit `trace` override is reverted. A temporary probe proved a body-time inline `<style>` still fails on both browsers.
  - T2: pi's nonce rewrites were removed from `apps/server/src/http/static.ts`; the meta tag keeps `property`/`nonce` (documented in HANDOFF §5). New `apps/server/test/static.test.ts`.
  - T3 (F2, F3): `runInBackground` (`lib/errors.ts`), `.catch` on prefetches, `ChunkBoundary` + `retryableLazy` (inline retry for the editor and panel). The guard tolerates only WebKit's navigation-cancel log.
  - T4: `scripts/e2e-webkit-docker.sh <slot> [spec…]`; set `PW_PROJECT=` (empty) for the CI-shaped run.
  - T5: final full Chromium 72 passed / 8 skipped, WebKit 72 / 8, CI-shaped 142 / 16. The first CI-shaped attempt (138 passed / 4 failed) found F8 (board stops loading past 500 issues, an app bug, fixed), F9 (theme/favorite state leaks between browser projects, fixed in specs) and F10 (flaky focus read).
  - T6 (A5, B3, F5, F6, F7): bulk cycle assignment, unconditional panel cycle, rollback test, reconnect-refetch test plus its app fix (F5, `lib/apollo.ts`), and the `visual.spec.ts` generation fix. An update run, proven into /tmp, generates; a normal run skips and writes nothing.
  - T7: production-mode pass, 0 CSP/console/page errors on Chromium and WebKit (see Current state).
  - T8: HANDOFF §9 row 6 decided (CI keeps the fresh bundle). The Codex profiler servers (PIDs 3674456 on :3017, 4034497 on :3019) are still running, awaiting the owner's OK.
  - T9: every gate is green (see Current state); WP6 docker build + compose verified.
  - T10: docs updated (this file, `HANDOFF.md` §1/§5/§6/§9, `HANDOFF.CODEX.md` §5–§6, `CODEX_WEB_QA.md`).
  - **Rerun:**
    - `pnpm --filter @velocity/web build`
    - `cd apps/web && E2E_SLOT=8 npx playwright test --project=chromium`
    - `apps/web/scripts/e2e-webkit-docker.sh 8`
    - `PW_PROJECT= apps/web/scripts/e2e-webkit-docker.sh 8`
  - **Open:** Claude's design pass (D1, D2, D3 below). Owner decisions are listed in the Lane F report.
  - **Leftovers in this environment:**
    - image `velocity:impl-wp6`;
    - DB `velocity_e2e_web_8`;
    - scratch in `/tmp/velocity-impl/`.

- **Claude design pass (Opus 5.5, 2026-10-04, D1–D4).** Screenshots: `/tmp/vel-design/r1` (built-in flows), `r2` (every settings section, project tabs, views, backlog, my issues, 404, cycles off), `r3` (setup, invite, loading, chunk failure, board loading-more, menus, empties), `r4`/`r6` (768/390), `r5`/`r6` (after fixes); capture script for states `scripts/screenshots.mjs` cannot reach: `/tmp/vel-design/cap.mjs`. Note: the Read tool mis-renders full-size 1440 dark PNGs as light; review them resized (`magick f -resize 1200x`).
  - Shared components: `Table` `inset` prop (full-bleed tables align with the 20px header gutter; Projects and Views use it), header cells nowrap, row focus ring inset; `Tabs` medium weight in every state (no sideways shift); `EmptyState` `fill` (page-level empties centred: search, inbox, cycles off, view not found); `InlineMessage` actions beside the text; `ContentSkeleton` `header={false}` under real headers and row anatomy aligned; issue-detail skeleton draws the 48px header.
  - Screens: one segmented-control style (`segmentClass` in `PresetTabs`; My issues/Inbox selected tab was invisible in light); settings pages share one left edge (forms keep a 3xl measure inside the 5xl column) and `SettingsRow` stacks via container query when narrow; issue rows drop labels/project/cycle by row width (container queries) so titles survive the open panel at 1024; full issue page uses the panel's label-left properties plus a Team row, and shows properties inline below 1024 (they were missing at 768/390); title, sections and tabs share one inset; project tabs content full width; search rows 32px with id baseline fixed; insights links unified, scope bars/legend visible; setup stepper aligned ("Owner"); cycles-off button hover; projects health/lead nowrap, "Show archived" from lg, icon-only create buttons below sm.
  - Gates (slot 7, 2026-10-04 ~16:00): web typecheck clean; whole-repo ESLint clean; check-hex/check-legal ok; scripts 8/8; web vitest 483/483; `packages/ui` typecheck + 32/32; build OK, initial JS 176.4 KB gzip; E2E Chromium **80 passed, 0 skipped** (visual now runs against approved baselines); WebKit Docker **72 passed, 8 skipped** (visual is Chromium-only). Dev servers stopped. Leftover: DB `velocity_e2e_web_7`, scratch `/tmp/vel-design/`.
  - Open for the owner: (1) the shell baseline masks seeded content, because the E2E seed is random and specs share one DB; a deterministic seed (`seed-cli` `--seed`) would let it pin real rows. (2) `ChunkBoundary` reuses `m.shell.loadError` ("Could not load this page…") inside the editor/panel; a part-specific sentence needs a catalog key plus the `ChunkBoundary.test.tsx` text. (3) Settings secondary nav is hidden below 768 with no in-page replacement (sections reachable from the sidebar Settings index only).

## Coordination (Codex QA lanes + Claude design; see `HANDOFF.md` §0 and `CODEX_WEB_QA.md`)

### Active claims
Add a row before editing a file under `apps/web/src`; remove it when done. Never edit a file someone else has claimed.

| Owner / lane | Files | Task | Since |
|---|---|---|---|

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
| F8 | F | Board with more than 500 issues | major | The board loads issues eagerly up to 500 and then stopped. Columns later in the server order (Done with `done=all`) showed a count and a permanent "Loading more issues" with no cards. Found by the CI-shaped run: after the 1,000-row import, `board.spec.ts` "move card to Done" failed on WebKit. | fixed: a column's "loading more" placeholder loads the next page while it is on screen (`useLoadWhenVisible`, `IssueBoard.tsx`; `useLoadWhenVisible.test.tsx`); CI-shaped run |
| F9 | F | E2E state leaks across browser projects | minor | In the CI-shaped run both browsers share one DB. `theme.spec.ts` left the owner's profile theme pinned to `dark` (WebKit `layout … light` then failed), and the favorites test toggled an already-favorited project off. | fixed in the specs: `theme.spec.ts` resets the profile theme to `system` after each test (`graphqlAs` helper in `fixtures.ts`); the favorites test starts from "not a favorite" |
| F10 | F | keyboard-loop (WebKit) | minor | `expect(await focusedLabel(page))` read focus once, a frame before WebKit moved it; flaky. | fixed: `expect.poll` in `keyboard-loop.spec.ts` |
| G1 | Claude (design) | Full-page issue on phones (`/issue/:id`) | minor | `screens/issue/IssuePage.tsx` loads `IssueDetail` with plain `lazy()`, not `retryableLazy` + `ChunkBoundary`. When that chunk fails on a phone, where the panel is a route, the whole shell is replaced by the route error "Could not load this page" instead of the inline "Could not load the issue" message with Try again. The panel (≥768) and editor are fine. | open (behavior; Codex). Use `ChunkBoundary frame` with `m.shell.panelLoadError` as in `DetailPanel.tsx` |

### Design review queue (Claude)
Visual problems, plus minimal visual changes made during functional fixes. Claude reviews and fixes these at the source (`packages/ui`, tokens) during the design pass.

| ID | Logged by | Screen | What / where | Status |
|---|---|---|---|---|
| D1 | lead | All WP2 screens | Light theme + 1024 not yet reviewed (dark 1440 done) | **done** (Claude design pass): every screen in both themes at 1440/1024, shell/list/settings at 768/390, auth, empty, loading and failure states. Fixes listed in the handover entry "Claude design pass" |
| D2 | lead | E2E visual baselines | Generate and approve `visual.spec.ts` baselines after the design pass | **done** (Claude): 8 baselines in `e2e/visual.spec.ts-snapshots/` (gallery + shell × dark/light × 1440/1024), each reviewed. Two fixes were needed: the gallery scrolled an inner container, so full-page shots were one viewport plus blank (now `GalleryScreen` scrolls the document via `html.document-scroll`); the shell shot compared random seed data and state left by earlier specs, so it now masks the primary sidebar nav, issue list, count, cycle picker and progress (`data-testid="cycle-progress"`) and pins geometry, chrome and theme |
| D3 | Impl/F | Issue detail panel, markdown editor | New `ChunkBoundary` (inline `InlineMessage` + Retry, reusing `m.shell.loadError`) shows when the editor or panel chunk fails to load, e.g. offline. Unstyled beyond the stock components; review its placement and spacing | **done**: the sentence is body text (not a bold title); the Retry action sits beside it, vertically centred (`InlineMessage` change, all inline messages); a failed panel chunk keeps a 48px panel header with a close button and pads the message (`ChunkBoundary` `frame` prop, `DetailPanel`) |
| D4 | Impl/F | Board columns | "Loading more issues" in a column now actually loads the next page when visible (F8); text unchanged. Consider a spinner or skeleton for that state | **done**: 16px `Spinner` + text, centred 32px row, `role="status"` (SPEC §4.9.11) |
| D5 | lead (R4) | E2E visual baselines | Remove the shell content masks now that the seed is deterministic, and re-take the baselines | **done** (Claude): masks only for times and dates; spec renamed `0-visual.spec.ts` so it runs before data-mutating specs; 8 baselines reviewed; 2 fresh normal runs pass |
| D6 | lead (R5) | Settings below 768 | Section list hidden on phones; sections reachable only via the Settings index | **done** (Claude): "Sections" `DropdownMenu` in the settings header (`md:hidden`), current item marked, owner-only sections hidden for members |
| D7 | Codex (R5) | Chunk-load error copy | Review the specific editor and panel chunk messages | **done**: both render well in the existing D3 layout. Phone full-page gap logged as G1 |

## Current state (verified 2026-10-04 ~14:40 EDT by Impl / Lane F, slot 8; design pass re-verified ~16:00 by Claude, slot 7: unit 483, Chromium 80/0 skipped, WebKit 72/8 visual-only skips)
| Gate | Result |
|---|---|
| `apps/web` typecheck | clean |
| `pnpm exec eslint . --max-warnings=0` (whole repo) | clean |
| `node scripts/check-hex.mjs` / `check-legal.mjs` / `node --test scripts/*.test.mjs` | ok / ok / 8/8 |
| Web unit tests `cd apps/web && npx vitest run` | **483/483** |
| Build `pnpm --filter @velocity/web build` | OK. **Initial JS 176.3 KB gzip** (`node scripts/bundle-size.mjs`, budget 350) |
| `pnpm typecheck` (Turbo) | 13/13 tasks |
| `apps/server` vitest | 13/13 (new `test/static.test.ts` pins the CSP/nonce contract) |
| `pnpm test` (Turbo, first full run) | 13/13 tasks: services 963, graphql 509 (DSL + API + web-parity), web 480 at the time (now 483), server 13, importers 76, tokens 42, mcp-tools 41, ui 32 |
| E2E Chromium, full (`E2E_SLOT=8 npx playwright test --project=chromium`) | **72 passed, 8 skipped** (4.6 min). The 8 skips are `visual.spec.ts` (no approved baselines yet, by design) |
| E2E WebKit, full (`scripts/e2e-webkit-docker.sh 8`) | **72 passed, 8 skipped** (7.0 min) |
| E2E CI-shaped (both browsers, one DB: `PW_PROJECT= scripts/e2e-webkit-docker.sh 8`) | **142 passed, 16 skipped** (13.2 min): setup + seed + 70 per browser; the 16 skips are `visual.spec.ts`. The first attempt found F8–F10 |
| Docker / compose (WP6) | `docker build .` OK (607 MB). Isolated compose stack: UI wizard → first issue through Caddy, 0 CSP/console errors; `scripts/deploy/smoke.mjs` passes |
| Manual production-mode pass | API serving `dist` from the fresh server bundle with `NODE_ENV=production`, slot 8: 32 scripted steps (login, list + keyboard, board, panel edit, markdown editor, full-page issue, palette, inbox/my-issues/insights/search/views/projects/cycles, all 14 settings sections, import upload → mapping → dry run, light theme). Chromium: 0 CSP violations, 0 console errors, 0 page errors. WebKit: 0 CSP violations, 0 console errors; one WebKit navigation-cancel log (F3), not an app error |

The unit tests cover the keyboard engine (63), chips↔DSL↔URL view state (72), the optimistic wrapper with rollback/flag/pulse plus error mapping (36), client grouping and ordering against the server SQL (279, property-based with a seeded PRNG), selection (13) and fuzzy matching (13).
Bugs they found, all fixed:
- A cleared filter was lost when the screen's default filter was non-empty.
- uuid tie-breaks used a numeric collator, but Postgres compares bytes.
- Title ordering used natural-number collation.

## Pickup checklist (historical; do not follow)

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
