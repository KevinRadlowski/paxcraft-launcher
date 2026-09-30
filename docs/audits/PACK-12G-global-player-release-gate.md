# PACK-12G — Global player release gate

**Date:** 2026-09-21  
**STATUS / VERDICT:** **BLOCKED**  
**STARTING_HEAD = ENDING_HEAD:** `3b9580627e3a2c365b35a9231f114d3748948f1b`  
**Branch:** `main` (== `origin/main`, ahead/behind `0/0`)  
**NO TAG / RELEASE / PUBLISH / DEPLOY** (audit only)

## Executive verdict

HEAD is **not** release-ready for tag → draft player Release until **P0** is fixed:

1. `.github/workflows/player-release.yml` still runs **Full test suite before Build** (pre–PACK-12F.2 order). Suites that require `dist/**` will fail-closed on a clean runner — draft creation cannot succeed.
2. After that fix: **minimal HUMAN requalification** on the **HEAD** installer is still required (security runtime changed since HUMAN @5938ab).

CI Main **35604454163 = SUCCESS** at exact HEAD is retained as automated packaging evidence.

---

## A — Delta `5938ab389724` .. `3b9580627e3a`

Commits:

| SHA | Summary |
|-----|---------|
| `9967ed6` | docs(support): close PACK-12D human E2E |
| `8034b64` | fix(ci): refresh build provenance in version:check |
| `3b95806` | fix(security): realpath identity + CI build-before-test |

### Classification

| Path | Class |
|------|--------|
| `docs/PLAYER_INSTALL.md`, `docs/VERSIONING.md`, `docs/CI.md`, `docs/audits/PACK-12*` | docs only |
| `.github/workflows/ci-main.yml`, `ci-pr.yml` | CI tooling only |
| `scripts/version-check.mts`, `tests/version/*` | CI/tooling (provenance refresh) |
| `tests/instance/path-security-windows.test.ts` | security tests |
| `src/instance/security/index.ts` | **security-sensitive runtime** (shipped in packaged asar) |

No NSIS / electron-builder packaging contract changes in this delta (`deleteAppDataOnUninstall: false`, user-scope, artifact naming unchanged).

### HUMAN evidence boundary

| Evidence | Status |
|----------|--------|
| PACK-12D.2 matrix A–E on `0.6.0-rc.18@5938ab389724` (SHA-256 `73cde686…d9d13`) | **HUMAN_VERIFIED — retained** for NSIS install-over / uninstall AppData / custom instance / running-app dialog |
| Diagnostics/About privacy contract @5938ab | **HUMAN_VERIFIED — retained** (docs-only / provenance tooling since) |
| Installer / runtime @ `3b9580627e3a` | **NOT HUMAN_VERIFIED** |
| Automated path-security regressions + CI Main package/smoke @ HEAD | **automated PASS** |

**Conclusion:** full A–E re-run is **not** automatically required for unchanged NSIS semantics. Because `src/instance/security/index.ts` is in the packaged launcher, a **minimal** HUMAN regression on a fresh HEAD installer **is** required before publish (not before fixing P0 workflow).

Minimum HUMAN (post-P0 fix, on HEAD setup):

1. Install `SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` (HEAD bytes / SHA below) on isolated account.
2. Confirm **À propos / diagnostics** `buildId` = `0.6.0-rc.18@3b9580627e3a`.
3. Reach READY path: login (if needed) + install/repair pack **or** open existing instance and exercise managed-file path under instance root.
4. Optional light B: install-over from prior `@5938ab` → HEAD (same SemVer) — recommended, not mandatory if step 1–3 PASS on clean account.

---

## B — Player release workflow

File: `.github/workflows/player-release.yml`

| Check | Result |
|-------|--------|
| Trigger `push: tags: v*` | OK |
| `workflow_dispatch` without tag → **no** GitHub Release (artifacts only) | OK (`if: github.ref_type == 'tag'` on create; upload when not tag) |
| `environment: player-release` | Declared |
| Permissions | default `contents: read`; job `contents: write` for draft only |
| `draft: true` | OK |
| `prerelease: contains(ref_name, '-')` | OK for `v0.6.0-rc.18` |
| `make_latest: false` | OK |
| DIRTY=false enforcement | OK (assert on `src/build.generated.ts`) |
| Manifest commit == tagged commit | OK (`--commit EXPECTED_COMMIT` + tag SemVer match) |
| SHA-256 from uploaded bytes | OK (`release:manifest` hashes setup file) |
| No signing / verified-publisher claim | OK (`signing.status: unsigned`) |
| Deterministic filename | OK `SweetCraft Launcher-${semver}-win-x64-setup.exe` |
| Partial publish | Fail-closed on step failure; draft only on success path |
| Auto-update promise | None |
| Tag SemVer `v0.6.0-rc.18` ↔ product `0.6.0-rc.18` | Enforced by `release:manifest --tag` |

### P0 — test/build order

`player-release.yml` order today:

1. version:check  
2. **Full test suite**  
3. **Build**  
4. package / smoke / manifest / draft  

`ci-main.yml` / `ci-pr.yml` were corrected in PACK-12F.2 to **Build then test**. Player-release was **not** updated. Tests such as `packaged-migration-parity` and `e2e-verify-fresh-firstrun` require `dist/**` → expected FAIL on clean GHA checkout → **cannot create draft**.

---

## C — GitHub Environment `player-release`

| Probe | Result |
|-------|--------|
| `GET .../environments` | `total_count: 0` |
| `GET .../environments/player-release` | HTTP **404** |
| Repo visibility | **private** |
| Plan/capability for required reviewers | **NON DETERMINABLE** (user plan null / org API unavailable) |

**Environment verdict: NOT CONFIGURED**

Policy assessment without changing settings: **draft-only creation + explicit human “Publish release”** remains an acceptable human publication gate. Required reviewers are **recommended** but not verified. Do not assume environment protection exists until operators create `player-release` and confirm protection rules in the UI.

---

## D — Final artifact identity (HEAD)

**Source of truth for this gate:** CI Main run **35604454163** unsigned artifact (local electron-builder NSIS failed mid-run on this machine; CI package SUCCESS at same HEAD).

| Field | Value |
|-------|--------|
| SemVer | `0.6.0-rc.18` |
| HEAD / buildCommit | `3b9580627e3a2c365b35a9231f114d3748948f1b` |
| Build ID | `0.6.0-rc.18@3b9580627e3a` |
| DIRTY | `false` (audits WIP ignored by provenance) |
| Setup filename | `SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` |
| Size (bytes) | `85858584` |
| SHA-256 | `b25e45764962596fd19e68f09c9626cdebd6e70db56929228fe2573c11dcb897` |
| Manifest | `release:manifest` OK + `assertManifestMatchesSetup` OK |
| Channel | `rc` |
| Signing | `unsigned` / Authenticode **NotSigned** |
| PE CompanyName | `SweetCraft / XBASE` |
| PE ProductName | `SweetCraft Launcher` |
| PE FileDescription | product description from `package.json` |
| PE FileVersion | `0.6.0.18` |
| PE ProductVersion | `0.6.0-rc.18` |
| NSIS | `perMachine: false`, `oneClick: false`, `allowElevation: false`, `deleteAppDataOnUninstall: false`, allow change install dir |

**Do not** ship older `@5938ab` setup (`73cde686…`, size `86561570`) as this RC’s final artifact.

Local `pnpm desktop:package:renderer-smoke` on `release/win-unpacked` (HEAD prepare): **PACK07_SMOKE_PASS**.

---

## E — Player docs contract

`docs/PLAYER_INSTALL.md` audited against behavior:

- Official Releases URL, unsigned/SmartScreen, hash verify, install/login/pack/play  
- Launcher update = manual install-over; pack update separate; no auto-update  
- AppData + custom instance preservation; uninstall table; downgrade unsupported  
- No verified-publisher wording  

Aligned with `electron-builder.yml` NSIS flags. Support diagnostics privacy: retained via PACK-12D HUMAN + docs (no secret/token exposure in About).

---

## F — Gates (this audit)

| Gate | Result |
|------|--------|
| `pnpm version:check` | PASS (`0.6.0-rc.18@3b9580627e3a`, DIRTY=false) |
| Path-security Windows tests | PASS (5) |
| Full `pnpm test` | PASS 740 + UI 237 |
| `release:manifest` / assert on CI setup | PASS |
| CI Main 35604454163 @ HEAD | SUCCESS (version, build, tests, package, smoke, upload) |
| Local full `desktop:package` NSIS | **FAIL/unstable** this session (truncated setup observed earlier) — non-blocking given CI artifact |

---

## Findings

### P0

1. **player-release.yml test-before-build** — blocks successful tag→draft. Fix: mirror `ci-main` order (build then test). Separate fix pack; not applied in 12G.

### P1

1. GitHub Environment `player-release` **NOT CONFIGURED** (create + optional required reviewers before first tag).  
2. Local NSIS packaging flake on auditor machine — use CI/player-release bytes; do not mix `@5938ab` setup.  
3. Minimal HUMAN requalification on HEAD installer (enumerated above).

### P2

1. Tag style (annotated vs lightweight) not mandated in `VERSIONING.md` — prefer **annotated** tag for operator clarity.  
2. Confirm `player-release` order fix in a follow-up commit before any tag.

---

## G — Operator runbook (DO NOT EXECUTE in 12G)

### 1. PRE-TAG

- `git fetch`; `HEAD == origin/main == 3b95806…` (or later commit that includes player-release order fix)  
- Resolve **P0** workflow order; CI green on that commit  
- Working tree product-clean (`DIRTY=false`)  
- Confirm SemVer `0.6.0-rc.18` in `package.json`

### 2. Minimal HUMAN (after P0; before or after draft, **before Publish**)

- Steps in §A (install HEAD setup, verify buildId, READY/instance path)

### 3. Tag policy

- Prefer: `git tag -a v0.6.0-rc.18 -m "SweetCraft Launcher 0.6.0-rc.18"` on the exact release commit  
- Tag name must be `v` + exact product SemVer

### 4. Push tag

- `git push origin v0.6.0-rc.18` (FF tag only; no force)

### 5. Player-release workflow

- Triggered by tag push; job uses `environment: player-release`  
- Expect draft Release only (`draft: true`, `make_latest: false`, prerelease for rc)

### 6. Inspect draft

- Title/name, assets: setup + `player-release-manifest-win-x64.json`, French body, SHA-256, buildId, unsigned language

### 7. Independent hash verify

- Download setup from **draft** assets; `Get-FileHash SHA256` must equal manifest / notes

### 8. HUMAN publish

- GitHub UI **Publish release** only after §2 + §7 PASS  
- Publishing is **not** automatic

### 9. Post-publication

- Re-download from published Release; re-hash; spot-check SmartScreen guidance still accurate

### 10. Rollback / withdraw

- If hash/buildId wrong: **unpublish** / delete release assets or mark draft again; do **not** leave a bad published Release; delete/retag only with explicit operator decision (no force-push of main)

---

## Remaining HUMAN / ops actions (exact)

1. **Fix P0** player-release build-before-test (engineering commit + CI green).  
2. Create GitHub Environment `player-release` (reviewers recommended).  
3. Minimal HUMAN install/smoke on HEAD setup (SHA `b25e4576…`).  
4. Then follow runbook tag → draft → verify → **human** publish.

---

## WIP

Untracked audits under `docs/audits/**` preserved (including this file). Not committed by 12G.

**NO TAG / RELEASE / PUBLISH / DEPLOY**