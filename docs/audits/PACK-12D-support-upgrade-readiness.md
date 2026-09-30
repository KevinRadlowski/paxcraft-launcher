# PACK-12D — Support build diagnostics & upgrade readiness

**Date:** 2026-09-20  
**STATUS (automated):** PASS  
**STATUS (HUMAN E2E):** **FULL PASS** (PACK-12D.2, `kevin\sweetcraft-e2e`)  
**STARTING_HEAD:** `62e18bdef8b22a8f001d2c04980b815f5027bb58`  
**CLOSURE_HEAD:** `5938ab3897249fe6ee13d8c3b15fbd252cd05f49`  
**origin/main:** `aeb32b35051f1a2798c5d83ea090470270053b27`  
**NO PUSH / TAG / RELEASE / PUBLISH / DEPLOY**

## Objective

Make an external RC supportable (exact `buildId` / `buildCommit`) and document + qualify manual install-over / Windows uninstall without mutating the live SweetCraft instance.

## About / diagnostics

| Surface | Behavior |
|---------|----------|
| About | SemVer (`DESKTOP_PRODUCT_VERSION`) + **Build** from `store.info()?.buildId` (AppInfo IPC SoT). Hidden when unavailable. |
| Diagnostics UI | Shows `buildId`; shows full `buildCommit` when present. |
| Clipboard | `Build ID:` + `Build commit:` (+ `unavailable` degrade); instance location `default`/`custom` classification; no auth tokens. |
| Provenance | Single source: `getAppInfo` → `LAUNCHER_BUILD_*` → `buildSafeDiagnostics(info)`. No second metadata generator. |

### Security proof (automated)

- `assertNoSensitiveLeak` on DTO + clipboard text.
- Regression: forbidden keys (`accessToken`, `refreshToken`, `authorizationCode`, `codeVerifier`, …) absent from DTO JSON and clipboard.
- Path-like `buildId` / non-hex `buildCommit` stripped.

### HUMAN diagnostics (12D.2)

Version / Build ID / Build commit match CURRENT `@5938ab389724`; `Packaged: yes`; `Environment: production`; `Auth: SIGNED_OUT`; install not exercised. See `PACK-12D.2-human-e2e-closure.md`.

## Upgrade / uninstall contract findings

| Topic | Evidence | Doc |
|-------|----------|-----|
| Launcher update ≠ pack update | Distinct UI/install paths | `PLAYER_INSTALL.md` table |
| Manual install-over | Same `appId` / product; HUMAN A/B PASS | `PLAYER_INSTALL.md` |
| AppData on Windows uninstall | Builder + HUMAN C PASS | Preserved |
| Custom instance | HUMAN D PASS | Preserved outside install |
| Running app during setup | HUMAN E: NSIS dialog → close → continue | `PLAYER_INSTALL.md` note |
| In-app SAFE / COMPLETE | Runtime + docs | **Not re-proven** in 12D.2 populated worlds |
| Same SemVer / different build | HUMAN B PASS | Support via `buildId` |
| Downgrade | Unsupported | **NOT TESTED** |
| Auto-update | Not implemented | Documented |

## Automated matrix

| ID | Result |
|----|--------|
| Source NSIS AppData preserve | PASS |
| PLAYER_INSTALL contract markers | PASS |
| Diagnostics provenance single-source | PASS |
| About/diagnostics unit + desktop tests | PASS |

## HUMAN matrix (12D.2)

| ID | Result | Provenance |
|----|--------|------------|
| A same version | PASS | HUMAN_VERIFIED |
| B newer build | PASS | HUMAN_VERIFIED |
| C uninstall | PASS | HUMAN_VERIFIED |
| D custom instance | PASS | HUMAN_VERIFIED |
| E running app | PASS | HUMAN_VERIFIED |
| F downgrade | NOT TESTED | policy unsupported |
| Diagnostics | PASS | HUMAN_VERIFIED |

## Related audits

- `PACK-12D.1-support-e2e-prep.md` — packaging + isolation protocol  
- `PACK-12D.1-human-upgrade-uninstall-e2e.md` — safe checklist  
- `PACK-12D.2-human-e2e-closure.md` — authoritative HUMAN closure  
- `PACK-12-global-gate-inventory.md` — pre-release blockers  

## Commit (automated 12D)

- **SHA:** `5938ab3897249fe6ee13d8c3b15fbd252cd05f49`  
- **Message:** `feat(support): expose launcher build diagnostics`

## Ops

No push / tag / release / publish / deploy from this lot.  
**PACK-12D FULL: CLOSED PASS.**
