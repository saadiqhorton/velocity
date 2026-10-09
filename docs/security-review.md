# Security review — 2026-10-05

Scope: SPEC §7.1, the production HTTP and WebSocket entry points, authentication and session services, outbound and GitHub webhooks, uploads, markdown, MCP HTTP, and the dependency and Git-history scans. This review covers the source tree at the R1 handoff; it is not a penetration test.

| Severity | Finding | Fix and verification |
| --- | --- | --- |
| High, fixed | Outbound webhook delivery checked a hostname with DNS, then `fetch` resolved it again. An attacker controlling DNS could return a public address at validation and a private address at connection time. | Delivery now connects to the validated address with a pinned DNS lookup, preserving the original host for HTTP Host and TLS SNI. Redirects remain disabled. `packages/services/test/lib/ssrf.test.ts` checks the resolved address and pinned connection; `apps/server/test/webhooks.test.ts` checks private-address rejection and delivery. |
| High, fixed | The GraphQL WebSocket subscription route accepted query and mutation operations. Those operations skipped the HTTP CSRF and request rate-limit pipeline, and API-key mutations skipped its generic audit hook. | WebSockets now accept subscription operations only and apply the same depth and complexity validation as HTTP. `apps/server/test/transports.test.ts` proves cookie-authenticated mutation and query frames are rejected without changing an issue, while a valid subscription still receives updates. |
| High, fixed | The deployed `sharp` range (`^0.34.0`) included libvips and libheif advisories [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) and [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). Upload and avatar decoding use this package. | Updated server and services to `sharp ^0.35.5`. `pnpm audit --prod --audit-level high` reports no high or critical production findings; services and server typecheck and tests pass. |
| High advisory, accepted for now | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects `braces <=3.0.3`. It is pulled only through the web app's development GraphQL code generator and its file globbing chain. The advisory lists no patched release. | No attacker-controlled glob patterns are passed to the generator in production. `pnpm-workspace.yaml` suppresses this advisory by its exact GHSA so the CI audit still fails on any other high finding. Remove the exception when a patched dependency is published. |
| High, fixed (2026-10-06) | [GHSA-7mx3-vvmw-hjmv](https://github.com/advisories/GHSA-7mx3-vvmw-hjmv): `@graphql-tools/utils <=12.0.0` prototype pollution in `mergeDeep`, reached at runtime through `graphql-yoga` (which pins `^11.2.0`) and in dev through GraphQL Codegen. | `pnpm-workspace.yaml` `overrides` forces `@graphql-tools/utils` to `^12.0.3`; its `graphql` peer range is compatible and no other code changed. `pnpm audit --audit-level high` passes again. Drop the override once graphql-yoga depends on a patched release. |
| Informational | Full-history gitleaks reported three nonsecrets: the `vel_your_api_key` placeholder in `docs/api.md`, and two test fixtures that trip the default `generic-api-key` rule (`apps/server/test/admin.test.ts` and `packages/services/test/db/github-app-manifest.test.ts`). | `.gitleaks.toml` allowlists those three, each keyed to its exact literal and path so a real secret in the same files is still reported. The full-history Docker scan of every commit then reported `no leaks found`. Re-run the scan before each release: the allowlist is narrow, and new test data can legitimately trip it again. |

## Controls reviewed

- **Sessions and CSRF:** Session tokens are random 128-bit values stored as SHA-256 hashes. Cookies are `HttpOnly` for the session, `SameSite=Lax`, and `Secure` when `APP_URL` is HTTPS. Cookie-authenticated HTTP POSTs require the session's CSRF token in `X-CSRF-Token`; WebSocket sessions require the configured app origin and now carry subscriptions only. Passwords and API keys use Argon2id; revocation clears the in-process caches. Password changes revoke other sessions. Login has a per-IP-plus-account progressive delay.
- **API keys and rate limits:** Key resolution checks expiration, revocation, suspension, and deletion before returning an actor. Scope enforcement occurs in service permissions. HTTP has per-member/key token buckets and a stricter credential-endpoint bucket; limits are per process as documented in `docs/architecture.md`.
- **Outbound webhooks:** Registration and delivery reject private, loopback, reserved, and mixed public/private DNS answers unless the explicit private-target option is enabled. Delivery now pins the validated address, signs the payload with HMAC-SHA256, limits the payload and timeout, and does not follow redirects.
- **Uploads:** The allowlist, size cap, magic-byte checks for images/PDF/ZIP, image re-encoding for PNG/JPEG/WebP, and optional ClamAV path were inspected. The scanner fails uploads closed when configured and unavailable. GIF and video are not re-encoded; ClamAV remains optional, so deployments without it do not have malware scanning.
- **Markdown:** Server sanitization escapes raw HTML and neutralizes unsafe destinations. Browser rendering also uses DOMPurify. The SPA CSP allows same-origin scripts, nonce-bearing styles, and no object embedding or framing.
- **GitHub intake:** The receiver checks HMAC-SHA256 against the raw body before parsing or enqueueing, limits body size, and deduplicates delivery IDs. GitHub app credentials are read from the environment; installation tokens are minted per call. Outbound webhook secrets are encrypted using AES-256-GCM under an app-secret-derived key.
- **MCP HTTP:** The route is enabled by default (`MCP_HTTP_ENABLED=0` disables it) and requires a personal API key. When `MCP_HTTP_TOKEN` is set it is also required as the bearer token. Sessions bind to that key and tools execute through the GraphQL auth and service-permission path.

## Commands run

```sh
pnpm audit --audit-level high               # passes with the exact dev-only GHSA exception
pnpm audit --prod --audit-level high        # 0 high/critical; 2 moderate remain
pnpm --filter @velocity/services typecheck
pnpm --filter @velocity/server typecheck
pnpm --filter @velocity/services test
pnpm --filter @velocity/server exec vitest run test/transports.test.ts test/webhooks.test.ts
docker run --rm -v "$PWD:/repo:ro" ghcr.io/gitleaks/gitleaks:latest git /repo --log-opts=--all --no-banner --redact
```
