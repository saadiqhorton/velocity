# Release verification

Pushing a `v*` tag starts [CI](../.github/workflows/ci.yml), which runs lint, typecheck, unit tests, browser and visual tests, dependency audit, and a built-image Compose smoke test. Only after every job passes does CI call [the release workflow](../.github/workflows/release.yml). The image job builds `linux/amd64` and `linux/arm64`, pushes to GHCR, generates an SPDX JSON SBOM, signs the image digest and attaches the SBOM attestation with Cosign. After those steps succeed, it creates or updates the GitHub release with the SBOM asset. The npm job then builds and publishes `@velocity/mcp` with provenance. It waits for the image job, so a failed image release cannot publish the npm package.

## Manual upgrade gate

Before pushing a release tag, run the upgrade and restore check from a clean checkout with full Git history and Docker access:

```sh
OLD_REF=b62299922fe2721dc74ac01a5e2907853c0209b5 scripts/deploy/upgrade-smoke.sh
```

The script builds the pinned baseline and current images, verifies an existing issue survives migration, checks the pre-migration dump, restores it into a separate database, and boots the current image against that restore. It reads the expected migration counts from each checkout's migration journal. This remains a manual gate because the historical checkout's dependency resolution and two image builds have not been verified on a clean CI runner.

## Local dry run (2026-10-05)

The release steps were exercised without registry or npm credentials:

- `docker buildx build --platform linux/amd64,linux/arm64 --output type=oci,dest=/tmp/velocity-release-dryrun.oci.tar --provenance=mode=max .` produced a 237 MB OCI archive. Its index contains both target architectures and their provenance manifests.
- Syft 1.54.0 scanned each platform from that archive with `--platform linux/amd64` and `--platform linux/arm64`, producing SPDX 2.3 JSON SBOMs (537 package entries each).
- Cosign 3.0.2 signed the OCI archive and both SBOM files as local blobs with an ephemeral key. `cosign verify-blob` returned `Verified OK` for all three. The private key was deleted after verification. Local blob signatures prove the artifact steps work; the workflow's keyless signing of a pushed image digest still needs a registry and GitHub OIDC run.
- `pnpm --filter @velocity/mcp build` and `pnpm --filter @velocity/mcp publish --dry-run --access public --no-git-checks` passed. The dry run skipped publishing.

For the final tag, the repository owner must provide GHCR package access through `GITHUB_TOKEN`, an `NPM_TOKEN` allowed to publish `@velocity/mcp`, and a GitHub environment that permits OIDC signing. Check the image digest, both platforms, SBOM release asset, Cosign signature and attestation, and npm package after the workflow completes. The local dry run did not exercise remote pushes, keyless identity or real publication.
