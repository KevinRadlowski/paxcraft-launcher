# PACK-13D — SweetCraft player portal & download

**STATUS:** `PASS` (frontend WIP — no commit / no deploy)

**Date:** 2026-09-23  
**Site HEAD:** `034aabbc3168c9abaa4ebfb478e14204129865a3` (unchanged — no commit)  
**Branch:** `main` ahead 7 vs `origin/main`

## CTA

- Primary href (**always** verified RC — CMS cannot override):  
  `https://github.com/KevinRadlowski/SweetCraft-Launcher/releases/download/v0.6.0-rc.18/SweetCraft.Launcher-0.6.0-rc.18-win-x64-setup.exe`
- Precedence (PACK-13D-FIX): compile-time `SWEETCRAFT_LAUNCHER_RELEASE.setupDownloadUrl` only.
  CMS `launcherUrl` retained in API/admin but **ignored** for this integrity-bound CTA.
- Cutover flag `sweetcraftPortalCanonicalCutover`: **false** (unchanged).
- Subdomain: prepared via PACK-13B — **not live / not claimed**.

## Journey (section `#sc-launcher`)

RC badge, Windows x64, size, unsigned, primary download, Release + manifest links, SHA-256, install/SmartScreen (verify first), manual Launcher vs in-app pack updates, non-endorsement note.

## Validation

- Focused unit tests: PASS  
- `ng lint`: PASS (after unused-import fix)  
- `ng build`: PASS  
- `git diff --check` on touched files: PASS  

## Remaining (human / later packs)

- CMS may set `launcherUrl` to match verified URL (optional).  
- PACK-13E: DNS + Nginx subdomain.  
- Deploy site frontend build.  
- Third-party rights inventory: UNKNOWN (Launcher NOTICE).

NO COMMIT / PUSH / DNS / DEPLOY.
