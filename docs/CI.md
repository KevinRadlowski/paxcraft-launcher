# Continuous Integration (PACK-10)

## Triggers

| Workflow | File | Event |
|----------|------|--------|
| CI PR | `.github/workflows/ci-pr.yml` | `pull_request` → `main` |
| CI Main | `.github/workflows/ci-main.yml` | `push` → `main` |

`pull_request_target` is **not** used.

## Runner / toolchain

- Runner: `windows-latest` (Windows Electron product)
- Node: `22.x` (explicit `setup-node`)
- pnpm: `9.15.0` (matches `packageManager` field)
- Install: `pnpm install --frozen-lockfile`
- Cache: pnpm store via `actions/setup-node` `cache: pnpm` (lockfile-keyed). Not cached: `node_modules`, `dist/`, `release/`, user data.

## PR gates

1. `pnpm version:check` (SemVer SoT strict; build provenance refreshed from HEAD — PACK-12F.1)
2. `pnpm build` (`dist/**` for packaged parity suites — PACK-12F.2)
3. `pnpm test` (full suite)

Packaging is **intentionally omitted** on PR (cost). Package + renderer smoke run on `main`.

## Main gates

1. `pnpm version:check` (SemVer SoT strict; build provenance refreshed from HEAD — PACK-12F.1)
2. `pnpm build` (produces `dist/**` required by packaged parity / fresh-firstrun suites — PACK-12F.2)
3. `pnpm test`
4. `pnpm desktop:package` (unsigned)
5. `pnpm desktop:package:renderer-smoke` (real Angular bootstrap — PACK-07A)

Optional CI artifact (main only):

- Name: `sweetcraft-launcher-main-unsigned`
- Content: NSIS setup under `release/`
- Retention: 7 days
- **Not** a GitHub Release; unsigned/internal only

## Explicitly out of scope (PACK-10)

- Windows code signing / Trusted Signing / OIDC
- GitHub Releases / tags
- Deployment / CDN / updater
- Legal publisher identity gate (`SWEETCRAFT_REQUIRE_LEGAL_IDENTITY`) — deferred to release qualification so ordinary CI stays green while `LEGAL_IDENTITY_REQUIRED` remains open

## Permissions

Both workflows:

```yaml
permissions:
  contents: read
```

No secrets. No `id-token: write`.

## Player Release (PACK-12B)

Workflow: `.github/workflows/player-release.yml` — **Player Release (unsigned draft)**.

This is **not** `ci-main`. `ci-main` remains the engineering unsigned NSIS artifact (7-day Actions upload). Player distribution uses a **separate** tag / `workflow_dispatch` workflow that:

- qualification order matches `ci-main` / `ci-pr` for shared gates: `version:check` → **build** → **full tests** → package → smoke (PACK-12G.1; `dist/**` required on clean runners)
- then player-only steps: provenance assert → `release:manifest` → `release:body` → draft Release **or** qualification artifacts
- fail-closes on dirty provenance / SemVer / SHA-256 (`pnpm release:manifest`)
- writes French notes (`pnpm release:body`) from `docs/release/RELEASE_BODY.template.md`
- on tag `v*`: creates a **draft** GitHub Release only (`draft: true`). A human publishes. Never auto-latest.
- on `workflow_dispatch` without a tag: **qualification dry-run** — upload Actions artifacts only, **no** GitHub Release

Intentional differences vs `ci-main`: `environment: player-release`, DIRTY/commit provenance gate, SemVer↔tag check, manifest + French body, draft Release (tag) vs Actions artifact upload (non-tag). No package/smoke skip.

GitHub Environment: `player-release` (required reviewers recommended).

Player install / SmartScreen: [PLAYER_INSTALL.md](PLAYER_INSTALL.md).

**PE branding (PACK-12C):** `package.json` `author.name` = `SweetCraft / XBASE` → PE CompanyName. Product branding only — **not** Authenticode / verified publisher. Windows code signing remains **out of scope** (PACK-11).
