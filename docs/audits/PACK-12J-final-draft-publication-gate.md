# PACK-12J — Final draft asset qualification / publication gate

**Date:** 2026-09-22  
**STATUS / VERDICT:** **READY_TO_PUBLISH**  
**Tag:** `v0.6.0-rc.18` → `c203dc0f077235b430bf200327fdcea3ea5aa542`  
**Draft workflow:** 35768992399 SUCCESS  
**NO REBUILD / RETAG / RELEASE EDIT / PUBLISH / DEPLOY** (this lot)

## Fresh inspection (read-only)

| Check | Result |
|-------|--------|
| HEAD / origin/main | `c203dc0f077235b430bf200327fdcea3ea5aa542` |
| Remote tag `v0.6.0-rc.18^{}` | `c203dc0f077235b430bf200327fdcea3ea5aa542` |
| Draft | `isDraft=true` |
| Prerelease | `isPrerelease=true` |
| Latest | none (GET `/releases/latest` → 404) |
| Tag name | `v0.6.0-rc.18` |
| Assets vs PACK-12I | unchanged (same asset IDs, digests, sizes, `updatedAt` 2026-09-22T18:47:10–13Z) |

## Final tag-built asset identity

| Field | Value |
|-------|--------|
| GitHub asset name | `SweetCraft.Launcher-0.6.0-rc.18-win-x64-setup.exe` |
| Manifest filename | `SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` |
| Size | `85858329` |
| SHA-256 | `080047ecdeb80a9c0a83b768e9c8f1a44f38696929f4ecf9b6717d0bd155524d` |
| buildId | `0.6.0-rc.18@c203dc0f0772` |
| buildCommit | `c203dc0f077235b430bf200327fdcea3ea5aa542` |
| dirty | `false` |
| signing | `unsigned` |

Independent re-download + local SHA-256: **exact match** to manifest and GitHub asset digest.

## Release notes hash consistency

Notes contain final tag-build SHA-256 `080047ec…15524d`.  
Do **not** contain older dispatch HUMAN-A hash `17805095…dddd27`.  
Also present: buildId `@c203dc0f0772`, full commit `c203dc0…`.

## HUMAN_VERIFIED (final Draft asset)

Isolated account smoke on the **exact** manually downloaded Draft EXE:

| Check | Result |
|-------|--------|
| Independent download size/SHA vs manifest | PASS (HUMAN) |
| Install | PASS |
| Launcher start | PASS |
| Version `0.6.0-rc.18` | PASS |
| Build ID `0.6.0-rc.18@c203dc0f0772` | PASS |
| Build commit `c203dc0f077235b430bf200327fdcea3ea5aa542` | PASS |
| production / win32 x64 / Packaged=yes | PASS |
| Configured custom instance remained valid | PASS |

## Known limitations (accepted for RC publish)

- Unsigned → SmartScreen possible  
- No automatic Launcher update  
- Auth live / complete pack install / Minecraft play **not** re-run in this final targeted smoke  
- GitHub Environment `player-release`: present, **protection_rules=0** (no required reviewers verified)

## Exact next publication action (NOT executed here)

On GitHub: open Draft Release `v0.6.0-rc.18` → **Publish release** (human only).  
Do not rebuild, retag, or replace assets. After publish, re-download once and re-hash `080047ec…`.

## Explicit

**NO REBUILD · NO RETAG · NO RELEASE EDIT · NO PUBLISH · NO DEPLOY**