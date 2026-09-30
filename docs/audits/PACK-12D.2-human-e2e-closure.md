# PACK-12D.2 — HUMAN E2E closure

**Date:** 2026-09-20  
**STATUS:** **FULL PASS** (HUMAN_VERIFIED)  
**HEAD at closure:** `5938ab3897249fe6ee13d8c3b15fbd252cd05f49`  
**origin/main:** `aeb32b35051f1a2798c5d83ea090470270053b27` (ahead 3 at record)  
**Evidence provenance:** **HUMAN_VERIFIED** (Kevin, compte isolé) — no invented screenshots/hashes/machine observations.  
**NO PUSH / TAG / RELEASE / PUBLISH / DEPLOY**

## Isolation (executed)

| Field | Observed |
|-------|----------|
| Windows account | `kevin\sweetcraft-e2e` (standard local) |
| AppData | Distinct from production Kevin profile |
| Preexisting SweetCraft install on account | None |
| Protocol | PACK-12D.1 (one active install; no live profile) |

## Setup identity (HUMAN-confirmed SHA-256)

| Role | buildId | SHA-256 |
|------|---------|---------|
| CURRENT | `0.6.0-rc.18@5938ab389724` | `73cde6863a48d36e80cb3eb2971a6cdf919a9b06554341b818d3d3fdd37d9d13` |
| PREVIOUS | `0.6.0-rc.18@62e18bdef8b2` | `44ab8ded8013a0dc06885891910b808c1e0deb520e2a6dd6c5056962461fa577` |

## Matrix A–E (expected vs observed)

### A — SAME VERSION install-over (CURRENT → CURRENT)

| | |
|--|--|
| Expected | Install-over succeeds; Build = CURRENT; AppData marker unchanged |
| Observed | PASS |
| Provenance | HUMAN_VERIFIED |

### B — NEWER BUILD install-over (PREVIOUS → CURRENT, same SemVer)

| | |
|--|--|
| Expected | Install-over succeeds; final Build = CURRENT; marker unchanged |
| Observed | PASS |
| Provenance | HUMAN_VERIFIED |
| Note | Same SemVer `0.6.0-rc.18`; support identity = `buildId` |

### C — Windows uninstall

| | |
|--|--|
| Expected | App removed; AppData preserved (`deleteAppDataOnUninstall: false`); uninstall registry clean |
| Observed | `InstallationExists=False`, `AppDataExists=True`, `MarkerExists=True` (unchanged), `UninstallEntriesCount=0` |
| Result | PASS |
| Provenance | HUMAN_VERIFIED |

### D — Custom instance survives Windows uninstall

| | |
|--|--|
| Expected | Custom instance path persists across restart; survives Windows uninstall; AppData remains |
| Observed | Configured path `C:\Users\Public\SweetCraft-E2E\custom-instance-D-empty` persisted across Launcher restart; after uninstall, custom directory + marker intact; AppData remained |
| Result | PASS |
| Provenance | HUMAN_VERIFIED |
| Note | Path is **test evidence** on isolated account — not a player-facing diagnostics recommendation |

### E — Running app during setup

| | |
|--|--|
| Expected | Document actual NSIS behavior without force-kill of live prod |
| Observed | NSIS detected running Launcher; explicit dialog requesting closure; human clicked OK; Launcher closed; install completed; relaunch Build = CURRENT |
| Result | PASS |
| Provenance | HUMAN_VERIFIED |

### F — Downgrade

| | |
|--|--|
| Policy | Unsupported for players (`PLAYER_INSTALL.md`) |
| Result | **NOT TESTED** — policy retained |

## Diagnostics (HUMAN_VERIFIED excerpt)

Safe fields observed (no full clipboard / no Support ID in this audit):

| Field | Value |
|-------|-------|
| Version | `0.6.0-rc.18` |
| Build ID | `0.6.0-rc.18@5938ab389724` |
| Build commit | `5938ab3897249fe6ee13d8c3b15fbd252cd05f49` |
| OS | `win32 x64` |
| Environment | `production` |
| Packaged | `yes` |
| Instance location | `custom` |
| Default instance (test path) | `C:\Users\Public\SweetCraft-E2E\custom-instance-D-empty` |
| Auth | `SIGNED_OUT` |
| Install | `NOT_INSTALLED` |
| Pack installed | `none` |
| Last auth/install/play error | `none` |

## Explicitly untested (do not claim)

- Downgrade workflow (F)
- Full Microsoft auth / Minecraft ownership live path
- Pack install, update, repair, Play to game running
- In-app SAFE / COMPLETE uninstall against a populated instance with worlds
- SmartScreen behavior on a published GitHub Release asset (local setup only)

## Doc reconciliation

| Doc | Action |
|-----|--------|
| `PLAYER_INSTALL.md` | Align running-app note with E (NSIS asks to close) |
| PACK-12D readiness | HUMAN → FULL PASS |
| PACK-12D.1 prep / checklist | HUMAN closed |
| This file | Authoritative HUMAN closure record |

## PACK-12D FULL

**CLOSED PASS** — automated (12D) + packaging protocol (12D.1) + HUMAN A–E + diagnostics (12D.2).
