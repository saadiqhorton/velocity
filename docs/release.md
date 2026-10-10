# Release verification

Pushing a `v*` tag starts [CI](../.github/workflows/ci.yml). Its first job, `gate`, asks the Actions API whether a successful push run of the same CI workflow already exists for the tagged commit on `main`. If so (`verified=true`), every CI job is skipped and the release starts right away. Otherwise the full suite (lint, typecheck, unit tests, browser and visual tests, dependency audit, built-image Compose smoke test) runs on the tag, and the release starts only if every job succeeded. A failed job never releases. On branch pushes and pull requests `gate` outputs `false` and everything runs as usual. Tag runs are never cancelled by the concurrency group.

[The release workflow](../.github/workflows/release.yml) builds natively per platform: `build` runs `linux/amd64` on `ubuntu-latest` and `linux/arm64` on `ubuntu-24.04-arm` (no QEMU), each pushing an image by digest. `merge` combines the digests into one tagged manifest list on GHCR (`{{version}}`, `{{major}}.{{minor}}`, and `latest` for non-prerelease tags), generates an SPDX JSON SBOM, signs the merged digest and attaches the SBOM attestation with Cosign, then creates or updates the GitHub release with the SBOM asset. The stdio MCP client ships inside the image and is served at `/mcp/client-<hash>.tgz`; nothing is published to npm.

## Manual upgrade gate

Before pushing a release tag, run the upgrade and restore check from a clean checkout with full Git history and Docker access:

```sh
OLD_REF=9cf440d50d657b79cf1ebf26d56cb1925c0950bc scripts/deploy/upgrade-smoke.sh
```

The script builds the pinned baseline and current images, verifies an existing issue survives migration, checks the pre-migration dump, restores it into a separate database, and boots the current image against that restore. It reads the expected migration counts from each checkout's migration journal. This remains a manual gate because the historical checkout's dependency resolution and two image builds have not been verified on a clean CI runner.

## Local dry run (2026-10-05)

The release steps were exercised without registry or npm credentials:

- `docker buildx build --platform linux/amd64,linux/arm64 --output type=oci,dest=/tmp/velocity-release-dryrun.oci.tar --provenance=mode=max .` produced a 237 MB OCI archive. Its index contains both target architectures and their provenance manifests.
- Syft 1.54.0 scanned each platform from that archive with `--platform linux/amd64` and `--platform linux/arm64`, producing SPDX 2.3 JSON SBOMs (537 package entries each).
- Cosign 3.0.2 signed the OCI archive and both SBOM files as local blobs with an ephemeral key. `cosign verify-blob` returned `Verified OK` for all three. The private key was deleted after verification. Local blob signatures prove the artifact steps work.

## Published releases

`v1.2.0` through `v1.2.3` are published from `main`, and each tag run was verified afterwards:

- `docker buildx imagetools inspect ghcr.io/saadiqhorton/velocity:<version>` returns an OCI image index containing `linux/amd64`, `linux/arm64` and their provenance manifests.
- The GitHub release carries `sbom.spdx.json` as an asset.
- The registry holds the Cosign signature and the SBOM attestation for the published index digest, as `sha256-<digest>.sig` and `sha256-<digest>.att`.
- The package is publicly readable: an anonymous `ghcr.io` pull token lists the tags and fetches the manifest, so `docker pull` needs no credentials.

The 2026-10-05 dry run above shows the build, SBOM and signing steps work without registry credentials; the tag runs exercised the real registry push, keyless OIDC signing and publication.
