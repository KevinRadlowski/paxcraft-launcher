# PACK-12C — Truthful Windows PE branding

**Date:** 2026-09-19  
**STARTING_HEAD:** `df6e7522de03299fb41c4f4eb0b6b3ab002233bd`  
**origin/main:** `aeb32b35051f1a2798c5d83ea090470270053b27` (ahead was 1)  
**COMMIT:** `62e18bdef8b22a8f001d2c04980b815f5027bb58`  
**Message:** `fix(packaging): set truthful Windows product branding`  
**NO PUSH / TAG / RELEASE / PUBLISH**

## Root cause (reconfirmed, electron-builder 26.15.3)

1. Stock `electron.exe` embeds `CompanyName = GitHub, Inc.`
2. `AppInfo.companyName` ← `package.json` / metadata `author.name`
3. `winPackager` writes PE `CompanyName` **only if** `companyName != null`
4. Absent author → stock Electron CompanyName survived

## Authoritative change

`package.json`:

```json
"author": { "name": "SweetCraft / XBASE" }
```

No email/url/legal suffix. Product branding only — **not** Authenticode / verified publisher.

Also: `electron-builder.yml` comment, `docs/VERSIONING.md`, `docs/CI.md`, regression test D2.

## PE inspection (clean package @ 62e18bd)

| Surface | ProductName | FileDescription | CompanyName | FileVersion | ProductVersion | Copyright | Authenticode |
|---------|-------------|-----------------|-------------|-------------|----------------|-----------|--------------|
| `SweetCraft Launcher.exe` | SweetCraft Launcher | SweetCraft Launcher | **SweetCraft / XBASE** | 0.6.0.18 | 0.6.0.18 | Copyright © SweetCraft / XBase | NotSigned |
| NSIS setup | SweetCraft Launcher | (description) | **SweetCraft / XBASE** | 0.6.0.18 | 0.6.0-rc.18 | Copyright © SweetCraft / XBase | NotSigned |
| `elevate.exe` (3rd party) | Elevate Application | — | Johannes Passing | — | — | — | NotSigned |

`GitHub, Inc.` **absent** from SweetCraft-owned primary PE CompanyName.

## Third-party exclusion

`elevate.exe` and Electron/Chromium/Microsoft runtime binaries retain upstream identity — not rebranded.

## NSIS / upgrade identity

Unchanged: `appId fr.xbase.sweetcraft.launcher`, `productName`/`executableName` SweetCraft Launcher, `perMachine: false`. No second product identity; upgrade-in-place preserved.

## Release simulation (PACK-12B)

| Field | Value |
|-------|--------|
| filename | `SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` |
| sizeBytes | `86561662` |
| sha256 | `44ab8ded8013a0dc06885891910b808c1e0deb520e2a6dd6c5056962461fa577` |
| independent match | True |
| buildCommit | `62e18bdef8b22a8f001d2c04980b815f5027bb58` |
| buildId | `0.6.0-rc.18@62e18bdef8b2` |
| dirty | false |
| signing.status | unsigned |

## Tests

desktop 293 · UI 236 · tests/** 726 · version:check · packaged smoke PASS

## GitHub, Inc. in project-controlled sources

Only intentional regression/docs mentions (`VERSIONING.md`, packaging identity test). No stale config claiming GitHub as publisher.

## Ops

NO PUSH / TAG / RELEASE / PUBLISH / DEPLOY. Audits local-only.
