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
- `MCP_HTTP_ENABLED` is off by default. MCP stdio clients communicate with the server API.
- The Docker Compose configuration sets `TRUST_PROXY=1` behind Caddy, and Caddy blocks `/metrics` from public requests. Direct deployments should set proxy trust only when the app is behind a trusted reverse proxy.
- Security and deployment configuration are documented in [.env.example](../.env.example) and [self-hosting.md](self-hosting.md).

## Web interface status

The design system is implemented in `packages/tokens` and `packages/ui`. The application UI in `apps/web` covers the screens in the v1 specification and has Chromium and WebKit E2E coverage. The design owner maintains the design-system usage and keyboard map; current browser verification is recorded in [HANDOFF.md](../HANDOFF.md).

## Recorded deviations from the specification

These implementation choices are documented for transparency; `SPEC.md` remains the target contract unless noted.

- The light theme follows the specified values. The dark theme uses the published `@atlaskit/tokens` `atlassian-dark` theme, as allowed by the specification's published-token rule. Dark lozenge text is lightened to maintain 4.5:1 contrast on a 15% tint.
- The schema contains additional tables for singleton workspace state, invites, team counters, project-team links, issue activity, ordered favorites, MCP sessions, import items, and exports. API keys also store a lookup/display prefix.
- Database tests use shared PostgreSQL configured by `TEST_DATABASE_URL` and clone a per-run template database rather than starting testcontainers.
- Markdown sanitization escapes raw HTML (so text such as `Map<string, number>` remains visible); unsafe URL schemes such as `javascript:` and `data:` are replaced with `#`.
- Outbound webhook retries use the app schedule of 1, 5, 15, 30, and 60 minutes, then dead-letter. pg-boss retry is disabled for that queue.
- Cycle rotation runs as an hourly sweep to honor each team's local midnight. Manual early close sets `endsAt` to now; catch-up windows are inserted already closed.
- GitHub installation tokens are minted per call and are not stored. Backfill links PRs without notifications or automatic issue closing. Issue-sync deduplication uses an activity marker. Commits link when they reference an issue but never close it.
- The MCP implementation has 13 tool names because project retrieval and project listing are separate tools.
- GraphiQL and persisted documents are not implemented; GraphQL introspection remains enabled. Avatar upload is implemented with decoded and re-encoded PNG/JPEG/GIF/WebP images, metadata removal, and a 256px maximum dimension; `GET /avatars/:id` requires member authentication.
- `is:blocked` counts unresolved blockers only. `DISABLE_SIGNUP=false` enables open signup. Rate limits are per process.
