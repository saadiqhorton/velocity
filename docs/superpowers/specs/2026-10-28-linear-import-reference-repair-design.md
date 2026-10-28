# Linear Import Reference Repair Design

**Date:** 2026-10-28
**Status:** Approved for implementation by task instruction
**Scope:** Import-time reference rewriting and owner-controlled repair of historical imported issue text.

## Intent

Preserve references between issues when importing Linear data into Velocity, including references in issue descriptions and comments. Provide an owner-only way to preview and repair references in already completed import runs without guessing mappings or overwriting text that changed after preview.

## Goals

- Persist an exact, run-scoped source issue key to destination issue UUID mapping before rewriting any prose.
- Create all destination issue shells first, then run a dedicated rewrite phase across descriptions and imported comments.
- Preserve Markdown bytes except for explicitly mapped issue references. Never infer targets from numeric suffixes or prefixes.
- Ignore matches inside fenced, indented, or inline code, URLs, and Markdown link destinations.
- Make import completion markers and every retry/resume idempotent through `import_items`.
- Report unresolved references as warnings.
- Support a historical repair workflow: scan one completed run, persist a preview, then apply only after explicit owner confirmation.
- Bind apply to the preview version/hash and each target’s expected content hash. Skip stale targets and make retries safe.
- Never rewrite prose without provenance from the selected import run.
- Expose the repair flow through service API, typed pg-boss work, GraphQL, and owner-only UI.

## Non-goals

- Rewriting ordinary issues, text from other import runs, or text without import provenance.
- Guessing an issue by key prefix, numeric suffix, nearby numbers, or a single candidate among unrelated runs.
- Changing Markdown rendering, editor behavior, reference syntax globally, or imported content outside the selected run.
- Automatically applying a preview or mutating live data outside the normal user-driven application path.

## Constraints and current architecture

- `packages/services` owns domain mutations; `packages/schema` owns Drizzle tables and migrations; `packages/graphql` exposes the shared API; `apps/server` registers pg-boss handlers; `apps/web` owns the SPA.
- `import_runs` stores the normalized bundle and owner; `import_items` currently stores `(run_id, kind, external_id, entity_id)` with a composite primary key and is the durable retry marker.
- Import commits are chunked and resumable. Existing phases create teams, statuses, labels, projects, cycles, issues, comments, parents, and relations.
- Historical repair is new, persisted domain state. Add repair run/target tables with a uniqueness constraint allowing only one active repair per import run. Store preview version/hash, per-target expected content hash, before/after text and context, status, and grouped skip/warning reason.
- UI must follow existing import wizard/report patterns and ADS semantic tokens. No restyling of shared UI packages.

## Approaches

1. **Rewrite while creating each issue.** This is simpler for small imports but cannot resolve forward references reliably and makes retries depend on partial entity creation order.
2. **Two-pass import (selected).** Create all issue shells, persist exact source-key mappings, then rewrite descriptions/comments in a dedicated phase. It resolves forward references, can resolve UUIDs at write time, and naturally supports completion markers and resumes.
3. **Post-import heuristic cleanup.** It might recover some historical text but cannot safely identify mappings, distinguish code/URLs, or prove provenance; rejected.

Historical repair uses a persisted preview/apply state machine. A scan is run-scoped and read-only against content plus provenance. The preview records exact proposed changes and skips. Apply requires the preview hash/version and explicit confirmation; each target is rechecked against its expected hash before writing.

## Reference scanning and rewrite behavior

- The scanner preserves all original text and replaces only exact matched source keys for which this import run has an exact destination UUID.
- Resolve the destination identifier from its UUID immediately before emitting the replacement, so current identifier changes do not stale stored mappings.
- Do not infer by numeric suffix or team-prefix similarity. Ambiguous or absent mappings remain unchanged and produce warnings.
- Exclude fenced code blocks, indented code, inline code spans, URL text, and Markdown link destinations. Preserve the delimiters and all untouched bytes.
- Handle adjacent and repeated references independently and deterministically.
- The import and repair paths share the scanner/rewrite implementation so their matching rules cannot drift.

## Historical repair lifecycle

1. Owner starts a scan from a completed import run or its history entry.
2. Persist a preview and target rows with before/after content, surrounding context, expected hash, match counts, and explicit status/reason.
3. Group skips for already-correct references, unmapped keys, ambiguous matches, stale preview data, missing targets, and code-excluded references.
4. Owner reviews counts and preview, then explicitly confirms apply. Verify the submitted preview hash/version; reject a mismatched preview.
5. For each target, verify row still exists, import provenance still points to the selected run, and live content hash still equals the recorded expected hash. Apply only exact planned changes; mark stale/missing records skipped.
6. Persist target outcomes so retries are idempotent. Completion is recorded as an `import_items` marker. Provide results and allow a fresh rescan.

Use a typed pg-boss payload and bounded retry behavior consistent with existing queue patterns. Service entry points enforce workspace-owner permissions; GraphQL checks are defense in depth. Repair API operations are auditable and do not accept arbitrary replacement text from the client.

## UI

- Add a repair entry point to completed import results and import history.
- Add a dedicated repair route under the existing data/import settings surface.
- Show target/reference totals, grouped skips, and before/after context; clearly label unchanged and excluded content.
- Require explicit confirmation before apply. Display applied/stale/missing/skipped outcomes and offer rescan.
- Reuse existing import table, warning, confirmation, and navigation patterns. Keep all controls owner-only and use existing design tokens.

## Acceptance criteria

- Exact cross-team source keys resolve to their UUID-mapped destination; no suffix or prefix inference.
- Adjacent/repeated references rewrite; fenced, indented, inline code, URLs, and link destinations remain byte-identical.
- Descriptions and comments are both processed after all issue shells and mappings are persisted.
- Retry/resume does not duplicate comments, rewrite twice, or lose mappings; completion markers are durable.
- Missing/ambiguous references produce warnings and remain unchanged.
- Historical preview is persisted and owner-only; apply rejects preview-version/hash mismatches and skips changed/missing targets.
- Apply is retry-safe, provenance-gated, auditable, and refreshable with a rescan.
- Tests cover cross-team keys/numbers, code contexts, adjacent/repeated refs, no suffix inference, descriptions/comments, rerun idempotence, stale preview, and missing mapping.

## Implementation calls

- Use a shared pure Markdown scanner/rewrite helper in the package layer available to both import and repair services.
- Reuse `import_items` for exact issue mappings and add dedicated kinds for rewrite-phase and repair completion markers.
- Keep preview records immutable after apply begins; a rescan creates a new preview/version.
- Keep the repair logic in `packages/services`, schema and migration in `packages/schema`, typed queue contracts in `packages/services`, registration in `apps/server`, GraphQL in `packages/graphql`, and user flow in `apps/web`.
- Generate GraphQL artifacts and migrations using repository commands; never edit applied migrations.

## Concurrency and queue behavior references

- pg-boss 12.36 supports sending through a Drizzle transaction adapter; the job insert rolls back with the application transaction. Queue sends that return `null` are treated as rejected when the caller requires a job: [pg-boss Drizzle adapter](https://github.com/timgit/pg-boss/blob/12.36.0/docs/api/adapters.md#drizzle), [pg-boss jobs API](https://github.com/timgit/pg-boss/blob/12.36.0/docs/api/jobs.md).
- Existing queue configuration is changed with `updateQueue`; dead-letter queues must exist before the source queue references them. Expiration and heartbeat handle distinct failure cases, and bounded apply continuations keep each job below the configured expiry: [pg-boss queues API](https://github.com/timgit/pg-boss/blob/12.36.0/docs/api/queues.md#dead-letter), [pg-boss workers API](https://github.com/timgit/pg-boss/blob/12.36.0/docs/api/workers.md).
- PostgreSQL transaction-scoped advisory locks serialize scan submissions; row locks serialize scan deliveries/finalization. Conditional `UPDATE ... WHERE content = expected` prevents a concurrent edit from being overwritten at Read Committed: [PostgreSQL 16 explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS), [PostgreSQL 16 UPDATE](https://www.postgresql.org/docs/16/sql-update.html), [PostgreSQL 16 Read Committed](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED).
