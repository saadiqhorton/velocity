# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately: open the **Security** tab of this repository and choose
**Report a vulnerability** (GitHub private vulnerability reporting). Please do not open a public
issue for a security problem.

Include what you can of: the version (`velocity status` prints it), how you deployed (installer or
manual Compose), and a minimal reproduction. Describe a setup rather than pasting credentials from a
live instance.

This is a single-maintainer, self-hosted project. Expect an initial reply within a few days. There
is no bug-bounty programme.

## Supported versions

Only the newest published release tag receives security fixes. Fixes ship as a new tag, and an
installer-managed instance takes them with `velocity update` (which installs the newest release tag).

## What counts as a vulnerability

In scope:

- Authentication, sessions, API keys, and CSRF
- Authorization between members of a workspace
- Injection (SQL, command, template), SSRF, path traversal, and stored XSS
- The installer, and the release artifacts themselves (image, signature, SBOM)
- Secret handling, including encryption at rest of integration credentials

Out of scope — these are operator choices, documented in
[docs/self-hosting.md](docs/self-hosting.md):

- Deliberately relaxing the defaults: publishing the Postgres port, setting
  `ALLOW_PRIVATE_WEBHOOK_TARGETS=1`, or leaving MCP HTTP reachable from an untrusted network
  without `MCP_HTTP_TOKEN`
- Denial of service by an authenticated member of your own workspace
- Vulnerabilities in third-party images (Caddy, Postgres, ClamAV) — report those upstream
- Anything that requires the ability to modify the host or the `.env` file

## Hardening checklist for operators

- Terminate TLS in front of the instance, and never publish the Postgres port.
- Leave `ALLOW_PRIVATE_WEBHOOK_TARGETS=0` (the default) unless you run internal receivers.
- Set `MCP_HTTP_TOKEN` when `/mcp` is reachable from an untrusted network.
- Take a backup (`velocity backup`) before every upgrade: migrations are forward-only, and rollback
  means restoring a backup and reinstalling the previous tag.
- If you pull the image by hand, verify it first: releases are signed with Cosign (keyless) and carry
  an SBOM attestation — see [docs/release.md](docs/release.md).

## Documented exceptions

The dependency audit carries one exact, dev-only advisory exception and one transitive override.
Both are recorded with their reasoning in [docs/security-review.md](docs/security-review.md).
