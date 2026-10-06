# Branding

"Velocity" is a **working title** (SPEC §1.6). Known name collisions exist, so the
name must stay rename-safe: it lives only in the places listed here, never in UI
strings scattered through components. A rename is one mechanical PR.

## Rules

- User-visible product name in the web app comes from a single constant
  (the branding/tokens layer under `packages/ui` / `packages/tokens`), never a string literal in a component.
- No logo or wordmark image is hard-coded outside `packages/ui`.
- Do not add the name to new places without adding it to the inventory below.
- No Linear name, logo, copy or asset anywhere (see CONTRIBUTING.md and NOTICE).

## Find every occurrence

```sh
grep -rIni velocity --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=.turbo --exclude=pnpm-lock.yaml --exclude=SPEC.md .
```

## Inventory (files containing the name, with match-line counts)

Generated from the command above on 2026-10-03. Re-run it to refresh.

```text
apps/mcp/package.json:4
apps/server/package.json:7
apps/web/package.json:4
Caddyfile:2
docker-compose.yml:10
Dockerfile:6
.env.example:8
eslint.config.js:4
package.json:8
packages/events/package.json:2
packages/events/src/listener.ts:1
packages/events/src/outbox.ts:1
packages/graphql/package.json:4
packages/graphql/src/dsl/chips.test.ts:2
packages/graphql/src/dsl/chips.ts:1
packages/graphql/src/dsl/errors.ts:1
packages/graphql/src/dsl/fields.ts:3
packages/graphql/src/dsl/parser.test.ts:2
packages/graphql/src/dsl/parser.ts:1
packages/graphql/src/dsl/README.md:3
packages/graphql/src/dsl/serialize.ts:1
packages/importers/package.json:3
packages/importers/src/client.ts:3
packages/importers/src/cli.ts:6
packages/importers/src/github.ts:2
packages/importers/src/import-flow.ts:3
packages/importers/src/infer.ts:2
packages/importers/src/jira-csv.ts:1
packages/importers/src/linear-api.ts:1
packages/importers/src/linear-csv.ts:1
packages/importers/src/mapping.ts:1
packages/importers/src/util.ts:1
packages/importers/test/cli.test.ts:1
packages/importers/test/fetchers.test.ts:1
packages/importers/test/infer-mapping.test.ts:1
packages/mcp-tools/package.json:1
packages/schema/drizzle.config.ts:1
packages/schema/migrations/0002_triggers_search.sql:10
packages/schema/package.json:1
packages/schema/src/tables.ts:1
packages/services/package.json:4
packages/services/src/api-keys.ts:2
packages/services/src/audit.ts:1
packages/services/src/auth.ts:1
packages/services/src/context.ts:1
packages/services/src/db.ts:1
packages/services/src/issues/filter-sql.ts:1
packages/services/src/labels.ts:4
packages/services/src/lib/crypto.ts:1
packages/services/src/lib/cycle-math.ts:1
packages/services/src/lib/identifiers.ts:1
packages/services/src/teams.ts:4
packages/services/src/users.ts:1
packages/services/src/workspace.ts:2
packages/services/test/lib/cycle-math.test.ts:8
packages/services/test/lib/issue-reference.test.ts:1
packages/tokens/package.json:1
packages/tokens/scripts/generate-ads.ts:1
packages/tokens/src/css.ts:1
packages/tokens/src/generated/ads-dark.ts:1
packages/ui/package.json:2
packages/ui/src/components/Avatar.tsx:1
packages/ui/src/components/Lozenge.tsx:1
packages/ui/src/components/StatusIcon.tsx:1
packages/ui/src/gallery/Gallery.tsx:1
packages/ui/src/styles/theme.css:2
SPEC.md (product name used throughout the specification)
```

## Categories to change in a rename

| Kind | Where | Example |
|---|---|---|
| npm scope and package names | every `package.json`, `pnpm-lock.yaml`, `@velocity/*` imports, `eslint.config.js`, `Dockerfile`/CI filters | `@velocity/server`, `velocity-mcp` bin, `velocity-import` bin |
| Env vars | `.env.example`, server config, compose, docs | `VELOCITY_ROLE`, `VELOCITY_BACKUP_BEFORE_MIGRATE`, `VELOCITY_URL`, `VELOCITY_API_KEY` (keep old names as aliases for one release) |
| Database identifiers | `packages/schema/migrations/*.sql` (already applied, add a new migration instead of editing), Postgres user/db name in `docker-compose.yml` | `velocity_events` NOTIFY channel, `velocity_*` trigger functions, `velocity` db/user |
| Container artefacts | `Dockerfile` labels, `docker-compose.yml` image name, `.github/workflows/release.yml` image path, `renovate.json` | `ghcr.io/saadiqhorton/velocity` |
| Docs and legal | `README.md`, `NOTICE`, `CONTRIBUTING.md`, `docs/*`, `SPEC.md`, `LICENSE` header notice | "Copyright (C) 2026 The Velocity Authors" |
| Code identifiers / strings | importer CLI help and User-Agent, GraphQL client type names, log/metric prefixes, key-derivation context strings | `VelocityClient`, `velocity-importer` |
| UI | web app title, logo, empty states | via the single constant described above |

Caveats for a rename:

- Key-derivation/context strings (for example the column-encryption HKDF info string)
  and API-key prefixes are persisted: changing them breaks existing data. Keep legacy
  values readable.
- Applied SQL migrations must not be edited; add a new migration that renames objects.

## Trademark clearance checklist (before a public launch under a final name)

- [ ] Shortlist 3 candidate names that are short, pronounceable, searchable.
- [ ] Search USPTO TESS/TSDR, EUIPO eSearch, WIPO Global Brand Database in classes 9, 42 (software) for identical and confusingly similar marks.
- [ ] Search GitHub, npm (including the scope), PyPI, Docker Hub, ghcr.io for existing projects with the name.
- [ ] Check domain availability (.com/.dev/.app) and social handles.
- [ ] Web search for the name plus "software", "issue tracker", "Linear", "Jira" to spot confusing similarity.
- [ ] Confirm it is not confusingly similar to Linear or any competitor (SPEC §1.5).
- [ ] Reserve the npm scope, GitHub org and ghcr namespace.
- [ ] Get counsel review if the project takes funding or a commercial hosting offering.
- [ ] Record the clearance result (date, searches, decision) in this file.
- [ ] Execute the rename PR from the table above; run `pnpm lint`, `pnpm typecheck`, `pnpm test`.
