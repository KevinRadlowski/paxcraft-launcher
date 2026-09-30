# PACK-12A — Unsigned Distribution Readiness Audit

**Date:** 2026-09-18  
**Mode:** READ-ONLY  
**STARTING_HEAD / origin/main:** `aeb32b35051f1a2798c5d83ea090470270053b27` (match — OK)  
**Product:** SweetCraft Launcher `0.6.0-rc.18` · Electron 35.7.5 · electron-builder 26.15.3 · NSIS x64 user-scope  
**Signing:** DEFERRED / OPTIONAL (not a V1 blocker; PACK-11A remains future architecture)

---

## Executive answer

**Can the current launcher, after only free fixes, be responsibly distributed to SweetCraft players?**

**Yes — after a small set of free P0 fixes**, as an **explicit unsigned RC**, with transparent SmartScreen guidance, published SHA-256, corrected PE CompanyName (branding, not Authenticode claim), and a draft GitHub Release process.

It is **not** responsible to distribute **as-is** while PE still shows `CompanyName = GitHub, Inc.`, with no player install guide, no published hash, and only a 7-day CI artifact as “download channel.”

Paid signing is **not** required for that bar.

---

## 1. Current player journey (map + frictions)

```
official download (?) 
→ SmartScreen / Windows warning (unsigned)
→ NSIS setup (user-scope, choose dir)
→ first launch
→ Microsoft login
→ pack install (CDN, channel default "dev")
→ Play
→ later: launcher upgrade (manual reinstall today)
→ pack update / repair (in-app)
→ uninstall / reinstall
```

| Step | Status today | Blocker / friction for normal player |
|------|--------------|--------------------------------------|
| Official download | **No stable public URL/Release** — only local builds + CI artifact 7d | **P0** — no durable player channel |
| SmartScreen | Expected for unsigned; **no player instructions** | **P0** — abandon risk / wrong “bypass” folklore |
| Trust of file | No published SHA-256 | **P0** |
| Setup UX | NSIS wizard, user-scope, changeable dir | OK |
| Publisher shown in Properties | `GitHub, Inc.` | **P0/P1** — misrepresentation |
| First launch / login / pack / Play | Validated in prior E2E | OK for RC |
| Pack update / repair | Implemented | OK |
| Launcher upgrade | **No self-update** — re-download setup | **P1** process/docs (not P0 if manual path documented) |
| Uninstall | App removed; AppData + custom instance preserved | OK if documented (**P1** docs) |

---

## 2. Windows identity (unsigned) — findings

### Configured / observed

| Field | Source | Current |
|-------|--------|---------|
| ProductName / FileDescription | `productName` | SweetCraft Launcher |
| executableName | `electron-builder.yml` | SweetCraft Launcher |
| appId | `fr.xbase.sweetcraft.launcher` | OK (upgrade identity) |
| copyright | `electron-builder.yml` | Copyright © SweetCraft / XBase |
| CompanyName (PE) | **Not set** | **`GitHub, Inc.`** on live EXE |
| package.json `author` | — | **absent** (`undefined`) |
| Shortcuts / uninstallDisplayName | NSIS | SweetCraft Launcher |
| UI “Éditeur” | i18n | “Maidenhead” (branding only) |
| Authenticode | — | NotSigned (accepted for V1) |

### Root cause of `GitHub, Inc.` (proven)

1. Stock `electron.exe` PE embeds `CompanyName = GitHub, Inc.` (verified on `node_modules/electron/dist/electron.exe`).
2. electron-builder `AppInfo.companyName` = `metadata.author.name` (or null).
3. With **no author**, `companyName` is **null**.
4. `winPackager` only writes `versionStrings.CompanyName` **if** `appInfo.companyName != null`.
5. Therefore rcedit updates ProductName/copyright/versions but **leaves Electron’s CompanyName intact**.

Evidence: `app-builder-lib@26.15.3` `out/appInfo.js` (`get companyName`) + `out/winPackager.js` (conditional CompanyName assignment).

### Three-way separation (must stay explicit in player docs)

| Layer | Meaning | Current |
|-------|---------|---------|
| **PE metadata** | File Properties strings | Wrong CompanyName |
| **Authenticode signer** | Cryptographic publisher | None (unsigned) |
| **SmartScreen “verified publisher”** | Microsoft reputation / signing | Not available unsigned |

### Smallest truthful unsigned identity model (proposal — not implemented)

**Do not invent a legal entity / do not claim verified publisher.**

Minimal remediation once humans accept a **product brand string** already used in-repo (copyright / productName), e.g. set `package.json` `author.name` to that **brand** so PE CompanyName overwrites `GitHub, Inc.`:

- Candidate brand strings already appearing: `SweetCraft`, `SweetCraft / XBase`, or productName `SweetCraft Launcher`.
- Final choice is a **human branding decision** (not Authenticode legal enrollment).
- Player-facing notice must still say: *unsigned build; Windows may warn; PE company is product branding, not a verified publisher certificate.*

Until that brand string is explicitly approved, leave CompanyName unfixed rather than inventing “Maidenhead SARL” or similar.

UI “Maidenhead” remains **separate** marketing copy; optionally align later (P2) to reduce confusion.

---

## 3. Installer / uninstaller findings

| Topic | Finding |
|-------|---------|
| Scope | User (`perMachine: false`), `allowElevation: false` |
| Directory | Changeable (`allowToChangeInstallationDirectory: true`) |
| oneClick | false (wizard) |
| Upgrade | Same `appId` → NSIS upgrade-in-place (electron-builder default). **No custom NSIS scripts.** Exact downgrade edge cases: **UNKNOWN** without dedicated matrix (treat carefully for RC). |
| Running app during upgrade | Typical Windows file-lock risk — document “close Launcher first” (**P1** docs) |
| Duplicate installs | Same appId tends to one uninstall entry — **UNKNOWN** multi-dir edge cases |
| `deleteAppDataOnUninstall` | **false** — `%APPDATA%\SweetCraft Launcher\` survives |
| Custom instance path | Outside AppData → survives uninstall |
| In-app uninstall pack | SAFE/COMPLETE ≠ Windows uninstall — document difference (**P1**) |
| Accidental data loss | Low for NSIS uninstall; higher if player deletes instance folder or uses COMPLETE uninstall | 

---

## 4. Artifact matrix

| Artifact | Player need | Class |
|----------|-------------|-------|
| `SweetCraft Launcher-<semver>-win-x64-setup.exe` | Primary install | **REQUIRED NOW** |
| SHA-256 of that exact setup | Trust / verify download | **REQUIRED NOW** |
| Short install + SmartScreen notice (README/Release body) | Survive unsigned warning | **REQUIRED NOW** |
| Provenance (`buildId` / `buildCommit` / `dirty=false`) in Release notes | Support + anti-stale | **REQUIRED NOW** |
| `.blockmap` | Delta updates | **REQUIRED FOR FUTURE AUTO-UPDATE** only (not for first RC if no updater) |
| `win-unpacked` zip | Dev/debug | **NOT NEEDED** for players |
| CI `upload-artifact` 7d | Internal | **NOT** player distribution channel |

---

## 5. Release manifest design (free, deterministic)

Publish alongside setup (Release asset or `manifest-win-x64.json`):

```json
{
  "schemaVersion": 1,
  "product": "SweetCraft Launcher",
  "semver": "0.6.0-rc.18",
  "windowsFileVersion": "0.6.0.18",
  "buildCommit": "<full sha>",
  "buildId": "0.6.0-rc.18@<short>",
  "dirty": false,
  "channel": "rc",
  "platform": "win32",
  "arch": "x64",
  "artifact": {
    "filename": "SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe",
    "sizeBytes": 86561484,
    "sha256": "<hex of final setup bytes>"
  },
  "signing": { "status": "unsigned" },
  "createdAt": "<ISO from release job clock — label as build-time, not reproducible bit-identical>"
}
```

Rules:
- Hash **after** final setup bytes (no post-hash mutation).
- Reject `dirty=true` for any player-facing Release.
- Optional: second line in Release body for human copy-paste.

---

## 6. GitHub draft-release design (unsigned, free)

Current: `ci-main` packages + uploads unsigned artifact; **no** Releases; `permissions: contents: read`; `publish: null`.

### Minimal safe architecture

```
tag vX.Y.Z(-rc.N) on canonical commit
  OR workflow_dispatch with explicit ref
→ windows-latest job
→ environment: player-release (recommended reviewers; free)
→ permissions: contents: write, id-token: NOT required
→ version:check + test + build + desktop:package + renderer-smoke
→ assert dirty=false + buildCommit == tag commit
→ compute SHA-256 + write manifest
→ softprops/action-gh-release (or gh) create **--draft**
     assets: setup.exe + manifest.json (+ optional .blockmap)
→ STOP: human publishes draft
```

| Control | Recommendation |
|---------|----------------|
| Trigger | Tag `v*` and/or `workflow_dispatch` only — **not** every push to main |
| Keep `ci-main` | Unsigned CI artifact for engineering; separate from player Release |
| Draft semantics | Always draft first; no `latest` auto-promote |
| Accidental publish | Environment required reviewers; no `prerelease: false` auto |
| Retention | GitHub Release assets (durable) vs 7d Actions artifact |
| Signing/OIDC/Azure | None |

---

## 7. Version / channel strategy (keep simple)

| Kind | SemVer example | Tag | Who |
|------|----------------|-----|-----|
| Internal eng build | `0.6.0-rc.N` dirty or CI artifact | none / CI only | Dev |
| Player RC | `0.6.0-rc.N` clean, draft→published prerelease | `v0.6.0-rc.N` | Selected players |
| Stable V1 | `0.6.0` or `1.0.0` (product choice) clean | `v0.6.0` / `v1.0.0` | All players |

- Pack CDN channel stays **`dev`** until product publishes more (existing default) — do **not** invent beta/stable launcher channels unless CDN needs them.
- Installer filename already includes SemVer — keep.
- Upgrade ordering: higher SemVer preferred; document that RC → stable is supported via install-over; **downgrade not supported** as player guidance.
- Avoid parallel “beta launcher channel” complexity for V1.

---

## 8. Launcher self-update findings

| Question | Answer |
|----------|--------|
| electron-updater / autoUpdater / app-update.yml | **Absent** (repo search empty; no dependency) |
| `publish` | `null` |
| Blockmap produced? | Yes by electron-builder — **unused** without updater |
| Pack update | **Implemented** (CDN protocol) |
| Launcher app update | **Manual reinstall only** |

**Decision:** Self-update is **safely deferable** before first player RC (**not P0**), **recommended before long-lived stable V1** (**P1**), if RC duration is short and Upgrade docs are clear.

---

## 9. Manual upgrade path (zero-cost while deferred)

1. Player learns via Discord/site/Release “pre-release” + in-app optional later banner (**P2**).
2. Official source: GitHub Release for this repo only (HTTPS).
3. Close Launcher → download new setup → verify SHA-256 → run installer (same appId upgrades).
4. Preserved: AppData (`launcher-data`, DPAPI auth, settings), custom instance path.
5. Rollback: install previous Release setup (keep prior Release assets); pack state usually intact; **UNKNOWN** rare Windows file locks — close app first.

---

## 10. SmartScreen / unsigned UX (accurate, free)

Do **not** teach security bypass tricks beyond the normal Windows “More info → Run anyway” path for an **expected** unsigned app from a known HTTPS source.

Free improvements:
- Official GitHub Release URL only  
- Publish SHA-256 + filename  
- Transparent “Unsigned Windows build” notice in Release body  
- Correct PE CompanyName (branding) so Properties ≠ GitHub  
- Consistent artifact naming (already good)

---

## 11. Support / diagnostics

| Capability | Today | Gap |
|------------|-------|-----|
| About SemVer | Yes | — |
| buildId / buildCommit in AppInfo IPC | Yes (main) | **Not shown** in About/diagnostics UI copy |
| Support ID | Ephemeral session | OK |
| Copy diagnostics | Yes | Should include buildId (**P1**) |
| Logs | Open instance logs | No dedicated main log file — note in support doc |
| `last-non-ready-status.json` | On instance | Mention in support bundle checklist |

Minimum support bundle for player failure reports:
1. SemVer + **buildId**  
2. Support ID (if session alive)  
3. Screenshot of error  
4. SHA-256 of downloaded setup (if install-time)  
5. Optional: copy-diagnostics paste + whether custom instance path  

---

## 12. Security / privacy / legal (concrete, distribution-relevant)

| Topic | Finding | Gap |
|-------|---------|-----|
| Microsoft OAuth | Public client + PKCE; refresh in DPAPI CurrentUser under `launcher-data/secure/` | Document in player privacy blurb (**P1** short) |
| Tokens | Not in renderer; not in accounts.json | OK |
| External URLs | Allowlisted (product CDN / community sites) | OK |
| Telemetry / crashReporter | **No** product crash/telemetry service found | OK — say so if asked |
| Licenses | Electron/Chromium license files in install tree | Root product LICENSE / notices page optional (**P2**) |
| PE pretending GitHub | Misattribution | **P0/P1** fix CompanyName branding |

Not expanded into generic compliance frameworks.

---

## 13. Threat / failure review

| Scenario | Mitigation |
|----------|------------|
| Tampered download | HTTPS GitHub + published SHA-256 |
| Wrong/stale Release | buildId in notes; mark older RC as superseded |
| dirty build shipped | Gate `dirty=false` on release job |
| Obsolete RC in wild | Release title + Discord pin; deprecate assets |
| Upgrade failure | Close app; reinstall; keep prior Release |
| Corrupted installer | Hash mismatch → re-download |
| Launcher vs pack update confusion | Docs + wording in Release (“Launcher setup” vs in-app pack) |
| Uninstall deletes player worlds | NSIS preserves AppData; warn about deleting instance folder |
| Official link changes | Single canonical Releases URL |
| GitHub unavailable | Mirror later (**P2**); short-term accept risk |

---

## 14. P0 / P1 / P2 roadmap

### P0 — blocks first external RC

| # | Problem | Concrete fix | Regression risk | Validation | Sub-lot |
|---|---------|--------------|-----------------|------------|---------|
| P0.1 | No durable player download channel | Draft GitHub Release workflow (unsigned) + human publish | Low if draft-only | Tag dry-run → draft assets | **12B** |
| P0.2 | No integrity proof | Post-package SHA-256 + manifest asset | Low | Hash matches file | **12B** |
| P0.3 | SmartScreen abandonment / bad advice | Player-facing install notice (Release body + short PLAYER_INSTALL.md) | None | Human review FR | **12B** |
| P0.4 | PE `CompanyName=GitHub, Inc.` | Set approved **brand** `author.name` (or equivalent) so PE overwrites; docs clarify ≠ Authenticode | Low–med (ARP Publisher string changes) | PE Properties check on new package | **12C** |

### P1 — before stable V1

| # | Problem | Fix | Risk | Validation | Sub-lot |
|---|---------|-----|------|------------|---------|
| P1.1 | Support can’t distinguish same SemVer builds | Show buildId in About + diagnostics copy | Low | UI test | **12D** |
| P1.2 | Manual upgrade unclear | Document close→install-over→data preserved | None | Human dry-run upgrade | **12B/D** |
| P1.3 | Uninstall data expectations | Document AppData + instance survival vs COMPLETE pack uninstall | None | Checklist | **12B** |
| P1.4 | Short privacy note (MSA tokens local) | ½-page in Release/docs | None | Legal skim | **12D** |
| P1.5 | No launcher self-update | Either implement electron-updater **or** accept manual + in-app “new launcher available” link | Med if updater | Update E2E | **12E** (or defer with banner only) |
| P1.6 | Downgrade/running-file lock unknowns | Small upgrade test matrix | Low | Manual matrix | **12D** |

### P2 — useful later

| # | Item | Sub-lot |
|---|------|---------|
| P2.1 | Align UI “Maidenhead” vs PE brand string | 12F |
| P2.2 | Product LICENSE / OSS notices UI | 12F |
| P2.3 | Mirror if GitHub outage | later |
| P2.4 | Launcher auto-update + blockmap | 12E+ |
| P2.5 | Signing (PACK-11) when budget exists | PACK-11* — **not** distribution blocker |

**Paid signing: not classified P0/P1.**

---

## 15. Recommended PACK-12 sequence

| Lot | Scope |
|-----|--------|
| **12A** | This audit |
| **12B** | Unsigned draft-release workflow + manifest/SHA-256 + player install/SmartScreen notes |
| **12C** | PE CompanyName brand overwrite (approved string only) + package verification |
| **12D** | buildId in About/diagnostics + upgrade/uninstall support docs + light upgrade matrix |
| **12E** | Decide: manual-upgrade banner vs electron-updater |
| **12F** | Branding/license polish |

---

## STOP conditions (before publishing any player RC)

- HEAD ≠ intended release commit  
- `dirty=true`  
- PE still shows `GitHub, Inc.` as CompanyName  
- No SHA-256 published for the exact setup bytes  
- Release is non-draft without human publish intent  
- Player docs claim “verified publisher” / signed status  
- Invented legal entity name without human approval  

---

## Operations confirmation

- No source/config mutation except writing this audit under `docs/audits/**`  
- No instance/AppData mutation  
- No package / tag / release / publish / deploy / commit / push  

## Final git status (expected)

`main` = `origin/main` = `aeb32b35051f…` with local `?? docs/audits/` (+ possible ignored generate dirt).
