# PACK-12B — Unsigned release pipeline + player distribution contract

**Date:** 2026-09-19  
**STARTING_HEAD:** `aeb32b35051f1a2798c5d83ea090470270053b27`  
**COMMIT:** `df6e7522de03299fb41c4f4eb0b6b3ab002233bd`  
**Message:** `feat(release): prepare unsigned player distribution`  
**NO PUSH / TAG / RELEASE / PUBLISH**

## Delivered

| Area | Path |
|------|------|
| Manifest schema + qualify | `scripts/release/manifest.mts` |
| CLI manifest | `scripts/release/generate-manifest.mts` (`pnpm release:manifest`) |
| Release body | `scripts/release/render-release-body.mts` + `docs/release/RELEASE_BODY.template.md` |
| Workflow | `.github/workflows/player-release.yml` |
| Player docs | `docs/PLAYER_INSTALL.md` |
| CI docs | `docs/CI.md` (Player Release section) |
| Tests | `tests/release/*.test.ts` |

## Manifest SoT

- SemVer / Windows PE ← `package.json` via `scripts/version/lib`
- buildCommit / buildId / dirty ← `readGitBuildInfo` (product dirty policy)
- artifact sha256/size ← exact setup file bytes
- `createdAt` = wall-clock production timestamp (not content identity)
- `signing.status` fixed `unsigned`

## Qualification fail-closed

Rejects: dirty, commit mismatch, SemVer/tag mismatch, missing setup, wrong filename, size≤0, malformed hash, signing≠unsigned, buildId shape mismatch.

## Workflow contract

- Triggers: `workflow_dispatch` (artifacts only if not a tag) + `push` tags `v*`
- Environment: `player-release`
- Permissions: default `contents:read`; job `contents:write`
- **draft: true**, `make_latest: false`, prerelease when tag contains `-`
- No OIDC / Azure / CSC_ / signing
- No `pull_request` release path
- ci-main unchanged (engineering unsigned artifact ≠ player Release)

## Local simulation (post-commit)

| Field | Value |
|-------|--------|
| setup | `SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` |
| sizeBytes | `86561457` |
| sha256 | `0c728d85cf16614dde183b5a1cdc2ac3eab2f65773661b1de55ec4e5b64d7295` |
| independent match | SHA + size **True** |
| buildCommit | `df6e7522de03299fb41c4f4eb0b6b3ab002233bd` |
| buildId | `0.6.0-rc.18@df6e7522de03` |
| dirty | `false` |
| signing | `unsigned` |
| CompanyName PE | **still `GitHub, Inc.`** (deferred PACK-12C) |
| Authenticode | NotSigned |

## Tests

- release: 14 PASS  
- desktop: 292 PASS  
- UI: 236 PASS  
- tests/**: 725 PASS (one intermittent download-hardening flake under parallel load; clean re-run PASS)  
- version:check / build: PASS  

## CompanyName

Unchanged — no `author` / PE publisher fix in this lot. Explicit input for **PACK-12C**.

## Human prerequisite before first tag

Create GitHub Environment **`player-release`** with required reviewers (otherwise tag workflow blocks).

## Ops

NO PUSH / TAG / RELEASE / PUBLISH / DEPLOY. Audits remain local-only.
