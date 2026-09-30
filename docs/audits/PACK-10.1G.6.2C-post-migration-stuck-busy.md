# PACK-10.1G.6.2C — Post-location-migration stuck-busy diagnostic

**Date:** 2026-09-18  
**STARTING_HEAD:** `aa484f7e60dce8c0d432ef47d91e9b44f7f8b93a` (ahead 1, not pushed)  
**Packaged buildId:** `0.6.0-rc.18@aa484f7e60dc`  
**Mode:** READ-ONLY — Launcher left running; no Repair/move/settings mutation

---

## Live evidence (non-mutating)

| Item | Finding |
|------|---------|
| Settings file | `%APPDATA%\SweetCraft Launcher\launcher-data\settings.json` (157 B, 2026-09-18) |
| Configured path | `sweetcraftInstancePath` = `E:\Jeux\SweetCraft-E2E-PROGRESS` |
| Destination tree | **Exists** — full mods/config/launcher/… |
| Source `E:\Jeux\SweetCraft-E2E-FRESH-2` | **Absent** (`Test-Path` → False) |
| Dest `launcher/state.json` | pack **0.1.4**, schema 1, releaseSeq 5, firstRun seeds `mc-options-firstrun` + `mc-servers-sweetcraft`, `updatedAt` 2026-09-18T14:28:53.262Z |
| `last-non-ready-status.json` | **Absent** |
| Open move/install transactions | Dir `launcher/transactions` exists, **empty** (no open tx) |
| Launcher process | **Running** — lockfile present; PIDs 8096, 36364, 42724, 49580 (`SweetCraft Launcher`) — **not killed** |
| Product logs | No dedicated main operation log retained (Chromium Session Storage only; auth material not inspected) |

**Transaction phase reached (proven):** at least **D (settings commit) + E (source cleanup) + F (move returned success path)**.  
UI symptoms match **G incomplete / poisoned** (post-operation renderer status), not an in-flight copy.

---

## Pipeline (code)

Settings `modifyInstanceLocation` → `gateway.instance.move` → `InstanceLocationService.moveInstance` → `moveInstanceTree` (PREPARING→COPYING→VERIFYING→**COMMIT_LOCATION**→CLEANUP_SOURCE→FINALIZING) → `onLocationChanged` (`getStatus` + send status) → **`onProgress(COMPLETED 100%)`** → Settings toast + `settings.refresh` + `refreshStorage` (**no** install status refresh).

Critical order in `instance-location-service.ts`:

```text
await onLocationChanged();           // status READY / IDLE
onProgress({ phase: "COMPLETED", percent: 100 });  // AFTER status
```

Renderer `AppStore.setInstallProgress`:

```ts
status: s.status ? { ...s.status, progress, readiness: 'BUSY' } : s.status
```

**Every progress event forces `readiness: 'BUSY'`**, including terminal `COMPLETED` / `FAILED`.

CTA/badge: `isInstallMutationBusy` ⇔ mutation op **or** `readiness === 'BUSY'` → « En cours » / « Opération en cours ».

---

## Busy ownership

| Owner | Post-migrate (evidence + code) |
|-------|--------------------------------|
| Backend `moving` | Cleared in `finally` after return — **not** still migrating (source gone) |
| Install Main `op` | Move does not use install mutation mutex |
| Settings `locationBusy` | Cleared in `finally` after toast/refresh |
| **Renderer `status.readiness`** | **Stuck BUSY** via last COMPLETED progress |
| **Renderer `installProgress`** | Stuck at COMPLETED / 100% / « Terminé » |
| Backend active migrate | **NO** (disk + code) |
| Renderer busy stale | **YES** |

---

## Root cause (proven)

**Migration completed successfully on disk.** Destination is authoritative; source cleaned.  

**Stuck UI is renderer lifecycle poisoning:** terminal `COMPLETED` progress is applied **after** a READY status refresh and **unconditionally sets readiness to BUSY**. Settings post-move path never calls `install.getStatus()` / `applyInstallStatus` to clear it.

This is **not** “100% means still running”; progress terminal ≠ busy clear.

---

## Relation to G.4.1

| | G.4.1 | This issue |
|---|--------|------------|
| Symptom | False « installation déjà en cours » | Sticky « En cours » after success |
| Mechanism | Non-awaited location refresh → CHECKING race vs install | COMPLETED progress → force BUSY after READY |
| Scope | First Home install / setLocation | Existing-instance **move** completion |
| Class | Same family (location lifecycle × busy) | **New subclass** — post-success completion race / sticky terminal progress |

**Not a regression of the exact G.4.1 bug**; G.4.1 fix (await `onLocationChanged` before return) is present and insufficient for this path.

---

## Data-loss risk

**Low for content.** Destination holds 0.1.4 instance; source removed by successful cleanup (G.5: dest authoritative after commit).  
**Risk if user re-migrates / Repair / reinstall without understanding state:** unnecessary churn, not proven data loss from this sticky UI alone.

---

## Safe HUMAN recovery (current stuck session)

Do **not** Repair/re-migrate as first step.

1. Prefer: Home **Revérifier** / status refresh CTA if available (triggers `getStatus` → `applyInstallStatus` with READY + clears progress when IDLE).  
2. Or: navigate away and force an install status refresh path.  
3. Or: **restart Launcher only** (cold bootstrap reloads status) — destination path already correct in settings.  
4. Do **not** point location back to deleted FRESH-2.  
5. Do **not** delete PROGRESS.

---

## Minimal fix scope (propose only — not implemented)

1. **`setInstallProgress`:** do **not** force `readiness: 'BUSY'` for terminal phases `COMPLETED` / `FAILED` (or clear readiness from last authoritative status).  
2. **and/or** after move success: emit status refresh **after** final progress, or omit COMPLETED progress and rely on status-only convergence (match install mutation pattern).  
3. Settings move success: `await installActions.refreshStatus()` (or equivalent) after move.  
4. Prefer (1)+(3) for defense in depth.

---

## Required regression tests

1. Move success: final store readiness is READY (or non-BUSY), CTA not IN_PROGRESS.  
2. Progress COMPLETED does not leave readiness BUSY.  
3. Order: status READY then COMPLETED → still converges (or COMPLETED does not override).  
4. FAILED progress does not permanently stick BUSY without status apply.  
5. Contrast with install mutation path (already clears via getStatus after IDLE).  
6. Optional: Settings move calls install status refresh.

---

## Operations

NO SOURCE CHANGE / COMMIT / PUSH / PACKAGE / TAG / RELEASE / DEPLOY.  
Launcher **not** restarted/killed. Instance trees **not** modified.
