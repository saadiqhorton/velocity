# Architecture

Velocity is a TypeScript monorepo. PostgreSQL is the database, full-text search engine, durable job store, and realtime notification bridge. The default deployment runs Caddy, one Node.js app, and PostgreSQL. The app serves the API and built SPA, runs background jobs, and optionally exposes MCP over HTTP. Attachments and exports use mounted local storage.

## Request and event flow

```text
Browser / API client / MCP / importer
                 │ GraphQL HTTP or WebSocket
                 ▼
       apps/server (GraphQL + auth)
                 │
                 ▼
       packages/services (domain)
                 │ transaction + outbox
                 ▼
              PostgreSQL
          ┌──────┴─────────┐
          │                │
       pg-boss       LISTEN/NOTIFY
          │                │
    background work   GraphQL subscriptions
```

Domain mutations live in `packages/services`. The GraphQL schema in `packages/graphql` is shared by the web client, public API, MCP tools, and importer. Mutations write domain changes and outbox events in one transaction; the server consumes those events for subscriptions and queued side effects.

## Repository packages

| Path | Responsibility |
|---|---|
| `apps/web` | React SPA and browser client |
| `apps/server` | GraphQL HTTP/WS server, auth, static hosting, jobs, webhook receiver |
| `apps/mcp` | MCP stdio server and optional HTTP process entry point |
| `packages/schema` | PostgreSQL schema, migrations, domain types and enums |
| `packages/events` | Event contracts and transactional outbox listener |
| `packages/services` | Domain services, permissions, storage, import and integration logic |
| `packages/graphql` | Pothos schema, typed errors, filter DSL and generated SDL |
| `packages/importers` | Linear/Jira CSV parsers, Linear/GitHub fetchers, CLI |
| `packages/mcp-tools` | MCP tool definitions and shared GraphQL executor |
| `packages/tokens` | Design tokens and generated CSS |
| `packages/ui` | Shared interface components |

The dependency direction is `schema ← events ← services ← graphql ← apps`, with `ui ← tokens`; apps do not import one another. See `SPEC.md` for product architecture requirements.

## Runtime and operations

- PostgreSQL 16 hosts application data, migrations, pg-boss queues, and outbox signaling. There is no Redis or separate object store in the default setup.
- Jobs run in the app process by default. `VELOCITY_ROLE=worker` supports a separate worker profile when scaling.
- The app uses local disk for attachments and export files. Persist the configured data directories with backups.
- Rate limiting and realtime process state are in memory / per process. Multiple app instances therefore have independent rate limit buckets.
- `MCP_HTTP_ENABLED` is on by default (`=0` opts out). The server also serves the bundled stdio client at `/mcp/client-<hash>.tgz`; there is no npm package.
- The Docker Compose configuration sets `TRUST_PROXY=1` behind Caddy, and Caddy blocks `/metrics` from public requests. Direct deployments should set proxy trust only when the app is behind a trusted reverse proxy.
- Security and deployment configuration are documented in [.env.example](../.env.example) and [self-hosting.md](self-hosting.md).

## Web UI and design system

The interface uses the published Atlassian Design System (ADS) look on a layout with Linear's geometry (SPEC §4.2–§4.10). Two packages own it, and `apps/web` consumes them:

### How tokens flow

```text
@atlaskit/tokens (atlassian-dark)    SPEC §4.2 light values
      │ pnpm --filter @velocity/tokens generate      │ src/light.ts
      ▼                                              ▼
packages/tokens/src/generated/ads-dark.ts  ──►  src/css.ts
      │ pnpm --filter @velocity/tokens build
      ▼
packages/tokens/dist/tokens.css      --ds-* custom properties under [data-theme='dark'|'light']
      ▼
packages/ui/src/styles/theme.css     Tailwind v4 @theme: --ds-* → utilities (bg-surface, text-fg-subtle,
      │                              border-border, h-8 …); default palette, radii and shadows reset
      ▼
packages/ui components + apps/web/src/styles/app.css (@import tailwindcss, tokens.css, theme.css)
```

- Components use only the token utilities (or `var(--ds-*)`). Tailwind's own palette is unset, so a raw color cannot be reached by accident.
- `scripts/check-hex.mjs` fails on any hex literal outside `packages/tokens`. Spacing is a 4px grid (`--spacing: 4px`, so `h-8` = 32px and `w-55` = 220px). There are no arbitrary pixel values, gradients, blur or glass, and radius stays at 12px or less (SPEC §4.17).

### Component inventory (`packages/ui`)

| Area | Components |
|---|---|
| Actions | `Button`, `IconButton`, `DropdownMenu` / `Menu` / `MenuGroup` / `MenuItem` / `SubMenu` / `MenuSeparator` |
| Forms | `Field`, `TextField`, `TextArea`, `Select` (native, 15 options or fewer), `PopupSelect` + `OptionList` (searchable, multi, creatable), `Checkbox`, `Radio` / `RadioGroup`, `Switch` |
| Feedback | `FlagProvider` / `Flag` (toasts), `InlineMessage`, `Banner`, `Modal`, `ConfirmDialog`, `Spinner`, `Skeleton`, `ProgressBar`, `EmptyState`, `Tooltip` |
| Display | `Avatar`, `Badge`, `Lozenge`, `StatusDot`, `Kbd`, `Icon` (Font Awesome subset, `iconMap`), `PriorityIcon`, `StatusIcon`, `Table`, `Pagination`, `Tabs` |
| Navigation | `SideNav` / `SideNavItem` / `SideNavGroup`, `Breadcrumbs` |
| Primitives | `Portal`, `Popover` (+ `computePosition`), `useControllableState`, `useEnterStyle` |

`ComponentGallery` renders every component in both themes. The web app serves it at `/__gallery?enable=1`, and it is part of the visual baseline.

### Shell geometry (SPEC §4.10, binding)

| Element | ≥1280 | 1024–1280 | 768–1024 | <768 |
|---|---|---|---|---|
| Sidebar | 220px, full height, `surface-sunken` | 180px | 180px | drawer (menu button in each view header) |
| Detail panel | 400px, 1px left border | 360px | overlays content | becomes a route (`/issue/:id`) |
| View header | 48px | 48px | 48px | 48px |
| Issue row | 32px | 32px | 32px | 32px |

- There is no top bar. Workspace name, search, `+ New`, Settings and the account live in the sidebar.
- `e2e/layout.spec.ts` asserts these constants: no wide fixed top element, the sidebar and panel widths, header and row heights, and the order of the sidebar sections.
- Settings keep their own 200px section list from 768px up. Below that, a "Sections" menu button in the settings header switches sections, and members don't see owner-only sections.

### Theming

- `tokens.css` defines the dark theme on `:root` and on `[data-theme='dark']`, with `[data-theme='light']` overriding it.
- `public/theme-init.js` sets `data-theme` before first paint (from `localStorage` `vel.theme`, otherwise `prefers-color-scheme`). It is an external script because of the strict CSP.
- After sign-in the profile's saved theme (`dark`, `light` or `system`) wins and is stored on the profile. The palette command "Switch theme" toggles it.
- Light values are the SPEC values. Dark values are generated from the published `atlassian-dark` theme (see deviations below).

### Design boundary and visual baselines

- The design owner owns `packages/ui`, `packages/tokens`, the visual layer of `apps/web` and the visual baselines. Other contributors fix behavior without restyling and report visual issues as separate changes.
- `apps/web/e2e/0-visual.spec.ts` snapshots the component gallery and the shell (`/team/ENG/active`) in both themes at 1440×900 and 1024×768, on Chromium only. The baselines are in `e2e/0-visual.spec.ts-snapshots/` and the tolerance is `maxDiffPixelRatio` 0.002.
- The shell shots compare real content: the E2E seed runs `seed-cli --deterministic`, and the spec's `0-` prefix makes it the first file to run, before any spec adds randomly named data. Only relative times and absolute dates are masked, because they follow the run date.
- Without approved baselines the spec skips. A normal run never writes baselines.
- Font rasterization differs between hosts, so the baselines are captured and checked only inside the official Playwright image (`mcr.microsoft.com/playwright:v1.63.0-noble`, matching `@playwright/test`). CI's `visual` job runs the spec in that image; the `e2e` job runs everything else on ubuntu-latest with `--grep-invert @visual` (the spec is tagged `@visual`). Locally, `apps/web/scripts/visual-docker.sh <slot>` runs the spec in the same image; host runs use `--grep-invert @visual`.
- To update after an intended visual change:
  1. Rebuild (`pnpm --filter @velocity/web build`).
  2. Run `apps/web/scripts/visual-docker.sh <n> --update`. Never regenerate with a host Playwright run.
  3. Have the design owner look at every changed PNG before accepting it.
  4. Run `apps/web/scripts/visual-docker.sh <n>` (no `--update`) and confirm it passes against the new baselines.
  5. When Playwright is upgraded, bump the image tag in `apps/web/scripts/e2e-webkit-docker.sh` (which `visual-docker.sh` wraps), in `.github/workflows/ci.yml` (`visual` job) and here, then regenerate.

### Keyboard map

This table is checked against the command registry: the `useCommands` registrations in `components/commands/GlobalCommands.tsx`, `IssueCommands.tsx`, `components/issues/IssueList.tsx`, `IssueBoard.tsx`, `ListScreen.tsx`, `components/issue-detail/IssuePageHeader.tsx` and `screens/inbox/Inbox.tsx`.

- One global listener (`keyboard/react.tsx`) resolves keys by layer: text field, then modal, then panel or list, then global.
- Commands with keys show in the `?` help. Most also appear in the ⌘K/Ctrl+K palette, which additionally lists keyless actions: Go to Insights, Switch theme, New team/project/view, Duplicate issue, Copy issue ID/link, Set project/cycle/estimate, Log out, and per-team "Go to" entries.

| Keys | Action | Where |
|---|---|---|
| `Mod+K` | Command palette (works in text fields) | global |
| `C` | Create issue | global |
| `/` | Focus search | global |
| `?` | Keyboard shortcuts help | global |
| `Esc` | Close the peek panel, else clear selection; closes menus and modals. On the issue page: back to the list | global, issue page |
| `G` `I` / `G` `M` / `G` `A` / `G` `P` / `G` `S` / `G` `V` | Go to Inbox / My issues / All issues / Projects / Settings / Views | global |
| `G` `C` / `G` `B` / `G` `T` | Go to the current team's Active / Backlog / current cycle | global |
| `J` `K` or `↓` `↑` | Move focus (hold to repeat) | list, board, inbox |
| `←` `→` | Move between board columns | board |
| `Enter` / `Mod+Enter` | Open the full issue page (inbox: `Enter` opens the panel) | list, board |
| `Space` | Peek in the side panel; `Space` again (or `Esc`) closes it | list, board |
| `J` `K` or `↓` `↑` / `⌫` | Next / previous issue of the list the page came from; back to that list | issue page |
| `Mod+Alt+P` / `Mod+Shift+.` / `Mod+.` / `Mod+Shift+,` | Copy as prompt / branch name / ID / link (work in text fields) | issue page, focused row, peek panel |
| `Mod+Alt+.` (configurable) | Open in the first coding tool (Settings › Coding tools) | issue |
| `Shift+F10` / Menu key, right-click | Issue context menu | row, card, issue |
| `X` / `Shift+X` / `Mod+A` | Toggle selection / select range / select all | list (`X` on board too) |
| `Alt+↑` / `Alt+↓` | Reorder within the group | list |
| `B` | Toggle board and list | issue views |
| `E` | Mark done or reopen (inbox: mark read or unread) | focused, selected or open issue |
| `I` | Assign to me (again to unassign) | issue |
| `A` / `L` / `P` / `S` / `R` | Assignee / label / priority / status / relation picker | issue (`R`: one issue) |
| `M` | Move to team (board: move to column) | issue |
| `V` | Issue context menu | issue |
| `Y` | Archive | issue |
| `#` | Delete with confirmation (inbox: `#` or `Delete` removes the notification) | issue |
| `Mod+Enter` | Submit comment | markdown editor |

Roadmap v1.2 (U1/U2) changed `Enter` from the panel to the full page, added `Space` peek and the copy and menu keys; `.` and `,` under a modifier are read by physical key (`event.code`), so `Mod+Shift+.` never collapses into `Mod+.`. Compared with SPEC §4.12, the registry adds `G` `C` (Active), `G` `V` (Views), `Mod+A`, the board's arrow keys and `M` for move to column. Inside menus, listboxes and popups, arrow keys, `Home`/`End` and typeahead belong to that widget, which the engine does not intercept.

## Recorded deviations from the specification

These implementation choices are documented for transparency; `SPEC.md` remains the target contract unless noted.

- The light theme follows the specified values. The dark theme uses the published `@atlaskit/tokens` `atlassian-dark` theme, as allowed by the specification's published-token rule. Dark lozenge text is lightened to maintain 4.5:1 contrast on a 15% tint.
- The schema contains additional tables for singleton workspace state, invites, team counters, project-team links, issue activity, ordered favorites, MCP sessions, import items, and exports. API keys also store a lookup/display prefix.
- Team keys are stored in a permanent alias table. Renaming a team changes its displayed issue prefix while old identifiers continue to resolve to that team; old keys cannot be assigned to another team. The aliases survive soft deletion so moved-issue pointers keep resolving.
- Database tests use shared PostgreSQL configured by `TEST_DATABASE_URL` and clone a per-run template database rather than starting testcontainers.
- Markdown sanitization escapes raw HTML (so text such as `Map<string, number>` remains visible); unsafe URL schemes such as `javascript:` and `data:` are replaced with `#`.
- Outbound webhook retries use the app schedule of 1, 5, 15, 30, and 60 minutes, then dead-letter. pg-boss retry is disabled for that queue.
- Cycle rotation runs as an hourly sweep to honor each team's local midnight. Manual early close sets `endsAt` to now; catch-up windows are inserted already closed.
- GitHub installation tokens are minted per call and are not stored. Backfill links PRs without notifications or automatic issue closing. Issue-sync deduplication uses an activity marker. Commits link when they reference an issue but never close it.
- The MCP implementation has 13 tool names because project retrieval and project listing are separate tools.
- GraphiQL is disabled; GraphQL introspection remains enabled. Codegen creates a persisted-operation manifest and adds `__typename` for Apollo's cache. The browser sends hashes for ordinary app operations (uploads and WebSocket subscriptions send full documents); the server resolves hashes from its bundled manifest. Full documents remain accepted for the public API and for clients during rolling upgrades. Avatar upload is implemented with decoded and re-encoded PNG/JPEG/GIF/WebP images, metadata removal, and a 256px maximum dimension; `GET /avatars/:id` requires member authentication.
- `is:blocked` counts unresolved blockers only. `DISABLE_SIGNUP=false` enables open signup. Rate limits are per process.
