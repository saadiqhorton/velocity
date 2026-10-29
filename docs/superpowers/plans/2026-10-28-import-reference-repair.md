# Import Reference Repair Implementation Plan

> **For agentic workers:** Implementation is approved. Work task-by-task and keep the acceptance checks in this plan current.

**Goal:** Make imported issue references exact and retry-safe, then let workspace owners preview and apply provenance-gated repairs to historical import text.

**Architecture:** Import runs persist source-key-to-UUID mappings with all issue shells before a dedicated Markdown rewrite phase. Historical repair is a run-scoped persisted preview/apply state machine in services, exposed through typed pg-boss jobs and GraphQL, with an owner-only settings route.

**Tech Stack:** TypeScript, pnpm/Turbo, Drizzle/PostgreSQL, pg-boss, Pothos GraphQL, React/Apollo, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-linear-import-reference-repair-design.md`

## Global Constraints

- Follow `AGENTS.md`, `SPEC.md`, `CONTRIBUTING.md`, and `docs/architecture.md`.
- Domain mutations and permissions belong in `packages/services`; no `any` in schema/events/services/graphql.
- Every web mutation uses `apps/web/src/lib/mutation.ts`.
- Use semantic ADS tokens and existing UI patterns.
- Generate schema/migrations and GraphQL artifacts with repository commands; never edit an applied migration.
- Do not touch live Velocity or Linear data.
- Keep existing local edits outside this feature untouched; stage only feature paths.

## Review Focus

- Markdown constructs that resemble identifiers: prove fenced, indented, inline code, URL and link destination contents stay byte-identical.
- Identifier overlap across teams/numbers: prove exact map lookup and reject suffix/prefix inference.
- Repeated/concurrent retries: prove issue/comment rewrite and completion markers cannot duplicate or rewrite again.
- Content edited between scan and apply: prove expected-hash mismatch skips the target without mutation.
- Removed or remapped imported entities: prove missing/ambiguous mappings warn and preserve source text.

## File map

- `packages/schema/src/tables.ts`, `enums.ts`, `index.ts`, generated migration: import mapping/repair persistence.
- `packages/services/src/importer.ts`, new focused Markdown reference module, typed job contracts and service exports: import phases, scan/apply operations, queue payloads.
- `apps/server/src/jobs.ts`: pg-boss registration.
- `packages/graphql/src/refs.ts`, `types/platform.ts`, generated `schema.graphql`: repair objects and owner operations.
- `apps/web/src/graphql/settings.graphql`, generated `gql/`, settings data screens/routes/i18n: owner preview/apply UI.
- `packages/services/test/db/` and pure helper tests; GraphQL/UI tests for permissions and flow.
- `docs/superpowers/specs/2026-10-28-linear-import-reference-repair-design.md`: approved design.

### Task 1: Exact Markdown reference scanner

- [ ] Add pure scanner/rewrite tests for exact cross-team IDs, adjacent and repeated matches, code fences/indented/inline spans, URLs/link destinations, and absent mappings.
- [ ] Implement byte-preserving rewrite that accepts only an exact source identifier map and emits unresolved diagnostics; add export through the existing package boundary.
- [ ] Run focused helper tests.

### Task 2: Import issue-shell and rewrite phases

- [ ] Add DB regression fixtures proving source issue map is persisted before descriptions/comments rewrite and destination keys are resolved from UUIDs at write time.
- [ ] Refactor commit into shell creation, mapping persistence, then text rewrite; persist per-target rewrite completion markers through `import_items` and make every phase resume-safe.
- [ ] Verify descriptions/comments, forward references, missing mapping warnings, team/key collisions, and rerun idempotence.

### Task 3: Historical preview/apply storage and service

- [ ] Add migration and schema for one active repair per import run, immutable preview hash/version, repair targets and expected content hashes/status/context.
- [ ] Add DB tests for owner permissions, provenance-only scanning, grouped skip categories, preview mismatch, stale/missing target skips, retry safety, and rescan.
- [ ] Implement service API and audit writes; no client-supplied replacement content.

### Task 4: Typed background jobs and GraphQL

- [ ] Add discriminated pg-boss payloads and handlers for scan/apply; test handler/service integration and retry behavior.
- [ ] Add owner-protected GraphQL queries/mutations and generated schema artifacts; test non-owner denial and preview/apply lifecycle.

### Task 5: Owner repair flow

- [ ] Add route entry from completed import results/history and a dedicated preview route.
- [ ] Show before/after context, counts, grouped skips, explicit confirmation, apply results and rescan; use existing ADS tokens and mutation conventions.
- [ ] Add UI tests for owner-only controls, review/confirm, stale outcomes and rescan.

### Task 6: Full verification and delivery

- [ ] Run migration/codegen, focused tests, then applicable typecheck/lint/build/test commands; record exact outputs and any DB/env limitation.
- [ ] Review changed paths and stage only feature files; commit, push, create a draft PR against `main`, and attach it in Codex if credentials/tools allow.
- [ ] Never merge or access live Velocity/Linear data.
