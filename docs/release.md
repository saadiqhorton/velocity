# Release verification

Pushing a `v*` tag starts [CI](../.github/workflows/ci.yml). Its first job, `gate`, asks the Actions API whether a successful push run of the same CI workflow already exists for the tagged commit on `main`. If so (`verified=true`), every CI job is skipped and the release starts right away. Otherwise the full suite (lint, typecheck, unit tests, browser and visual tests, dependency audit, built-image Compose smoke test) runs on the tag, and the release starts only if every job succeeded. A failed job never releases. On branch pushes and pull requests `gate` outputs `false` and everything runs as usual. Tag runs are never cancelled by the concurrency group.

[The release workflow](../.github/workflows/release.yml) builds natively per platform: `build` runs `linux/amd64` on `ubuntu-latest` and `linux/arm64` on `ubuntu-24.04-arm` (no QEMU), each pushing an image by digest. `merge` combines the digests into one tagged manifest list on GHCR (`{{version}}`, `{{major}}.{{minor}}`, and `latest` for non-prerelease tags), generates an SPDX JSON SBOM, signs the merged digest and attaches the SBOM attestation with Cosign, then creates or updates the GitHub release with the SBOM asset. The stdio MCP client ships inside the image and is served at `/mcp/client-<hash>.tgz`; nothing is published to npm.

## Upgrade gate

The upgrade and restore check runs on a clean CI runner every Monday and on demand through the [Upgrade gate](../.github/workflows/upgrade-gate.yml) workflow. That job needs full Git history — the script archives the pinned baseline commit out of the clone — and Docker for the two image builds, which is why it is separate from `ci.yml`. A measured CI run takes about two minutes (2m31s on 2026-10-10, 2m14s on 2026-10-11). First verified on a clean CI runner on 2026-10-10.

Run it from a clean checkout before pushing a release tag as well:

```sh
OLD_REF=9cf440d50d657b79cf1ebf26d56cb1925c0950bc scripts/deploy/upgrade-smoke.sh
```

The script builds the pinned baseline and current images, verifies an existing issue survives migration, checks the pre-migration dump, restores it into a separate database, and boots the current image against that restore. It reads the expected migration counts from each checkout's migration journal.

## Local dry run (2026-10-05)

The release steps were exercised without registry or npm credentials:

- `docker buildx build --platform linux/amd64,linux/arm64 --output type=oci,dest=/tmp/velocity-release-dryrun.oci.tar --provenance=mode=max .` produced a 237 MB OCI archive. Its index contains both target architectures and their provenance manifests.
- Syft 1.54.0 scanned each platform from that archive with `--platform linux/amd64` and `--platform linux/arm64`, producing SPDX 2.3 JSON SBOMs (537 package entries each).
- Cosign 3.0.2 signed the OCI archive and both SBOM files as local blobs with an ephemeral key. `cosign verify-blob` returned `Verified OK` for all three. The private key was deleted after verification. Local blob signatures prove the artifact steps work.

## Published releases

`v1.2.0` through `v1.2.7` are published from `main`, and each tag run was verified afterwards:

- `docker buildx imagetools inspect ghcr.io/saadiqhorton/velocity:<version>` returns an OCI image index containing `linux/amd64`, `linux/arm64` and their two provenance attestation manifests. `<version>` is the registry tag, which the metadata action writes without the `v` (`1.2.6`, `1.2`, `latest`); there is no `v1.2.6` registry tag, only the git tag.
- The GitHub release carries `sbom.spdx.json` as an asset.
- The registry holds the Cosign signature and the SBOM attestation for the published index digest. `1.2.0` through `1.2.4` expose them as `sha256-<digest>.sig` and `sha256-<digest>.att`; `1.2.5` and `1.2.6` expose a single `sha256-<digest>` tag. The verification below is done against the digest, so it does not depend on those tag names.

`v1.2.4` (2026-10-10) published index digest `sha256:3ac74b40464ebb948ff8f17f4eab879a19fcb2d84ed03f1ba73503c9ec1b4fcb`. Signing this repository's images keyless, the verification a user runs is:

```sh
cosign verify ghcr.io/saadiqhorton/velocity@sha256:3ac74b40464ebb948ff8f17f4eab879a19fcb2d84ed03f1ba73503c9ec1b4fcb \
  --certificate-identity-regexp '^https://github.com/saadiqhorton/velocity/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

It reports the signing certificate's subject as `https://github.com/saadiqhorton/velocity/.github/workflows/release.yml@refs/tags/v1.2.4`, the GitHub OIDC issuer, and `githubWorkflowSha` `b004ca4db044ef0b7d15b48587fb62b621da392d`, which is the tagged commit. `cosign verify-attestation --type spdxjson` against the same digest passes and returns the SPDX document, and an anonymous pull of both the index and the `linux/amd64` manifest returns `200`. The upgrade and restore gate passed on `b004ca4` before the tag was cut.
- The package is publicly readable: an anonymous `ghcr.io` pull token lists the tags and fetches the manifest, so `docker pull` needs no credentials.

`v1.2.5` (2026-10-11) published index digest `sha256:ba38a59c668a7365f4edfc91d17783cb942c94e497033d762ea2209f2f5fcd7e` from `cfee847`, which is also the digest `:latest` resolves to. Verification was pinned to the exact certificate rather than a pattern: `cosign verify` with `--certificate-identity https://github.com/saadiqhorton/velocity/.github/workflows/release.yml@refs/tags/v1.2.5`, `--certificate-oidc-issuer https://token.actions.githubusercontent.com` and `--certificate-github-workflow-sha cfee847b9af83cd88d8ba647d80526a5c16f9f80` exits 0, so the signing certificate is bound to that tag and that commit and no other. `cosign verify-attestation --type spdxjson` with the same pins exits 0 and returns an SPDX-2.3 document naming the index digest with 536 packages. The release carries `sbom.spdx.json` (5.2 MB), an anonymous pull of both the tag and the digest returns `200`, and the index holds `linux/amd64`, `linux/arm64` and their two provenance attestation manifests. The upgrade and restore gate passed on `cfee847` before the tag was cut. This is the first published release whose build and signing ran through actions off the retired majors (`checkout` v7, `setup-buildx` v4, `build-push` v7, `login` v4, `metadata` v6, `cosign-installer` v4.1.2).

`v1.2.6` (2026-10-11) is the first release carrying the installer fix, so `velocity update` moves the image pin instead of reporting success while the old image keeps running. It published index digest `sha256:27189f175206979ca6b131c32f9184b3818fc0a1fd2c251d7718e54509d0c577` from `eb400eb` (PR #2, squash-merged), which is also the digest `:latest` resolves to. The registry tags are `1.2.6` and `1.2`; the git tag is `v1.2.6`. `cosign verify` with `--certificate-identity https://github.com/saadiqhorton/velocity/.github/workflows/release.yml@refs/tags/v1.2.6`, `--certificate-oidc-issuer https://token.actions.githubusercontent.com` and `--certificate-github-workflow-sha eb400eb2ffc8a1dd448453e6637cf386a17a0791` exits 0, so the signing certificate is bound to that tag and that commit and no other. `cosign verify-attestation --type spdxjson` with the same pins exits 0 and returns an SPDX-2.3 document naming the index digest with 536 packages. The release carries `sbom.spdx.json` (5,196,610 bytes), an anonymous pull of the tag, of `1.2`, of `latest` and of the digest each returns `200`, and the index holds `linux/amd64`, `linux/arm64` and their two provenance attestation manifests. The upgrade and restore gate passed on `eb400eb` before the tag was cut (`9cf440d50d657b79cf1ebf26d56cb1925c0950bc` → current, issue preserved, restored app ready), CI was green on the merged commit, and the tag run's `gate` reported `verified=true` so the CI jobs were skipped as designed.

`v1.2.7` (2026-10-24) is the first release carrying the A1 interface refresh (SPEC §4.18) with inline property editing and the A2 issue workflows (§4.19), plus the presence-timer fix that could leave the issue panel open after Space/Esc and the dependency advisories recorded in docs/security-review.md. It published index digest `sha256:44c330d56d4eed7c9560c2f831f0c99e5481c20eee4eff90808e230aabfe5d60` from `b48d4e7`, which is also the digest `1.2` and `:latest` resolve to. `cosign verify` with `--certificate-identity https://github.com/saadiqhorton/velocity/.github/workflows/release.yml@refs/tags/v1.2.7`, `--certificate-oidc-issuer https://token.actions.githubusercontent.com` and `--certificate-github-workflow-sha b48d4e7b095769dceb9cbaecd75ac5564ef9d8b0` exits 0, and `cosign verify-attestation --type spdxjson` with the same pins exits 0 and returns an SPDX-2.3 document naming the index digest with 537 packages. The release carries `sbom.spdx.json` (5,196,993 bytes), an anonymous pull of `1.2.7` and of `latest` returns `200`, and the index holds `linux/amd64`, `linux/arm64` and their two provenance attestation manifests. The upgrade and restore gate passed on `b48d4e7` before the tag was cut, CI was green on that commit on `main` (the first green `main` run since `v1.2.6`: the A1 commits had left stale visual baselines, outdated E2E selectors and new audit advisories), and the tag run's `gate` reported `verified=true` so the CI jobs were skipped as designed.

The 2026-10-05 dry run above shows the build, SBOM and signing steps work without registry credentials; the tag runs exercised the real registry push, keyless OIDC signing and publication.
