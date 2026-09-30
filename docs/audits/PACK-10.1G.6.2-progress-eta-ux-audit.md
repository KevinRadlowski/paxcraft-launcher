# PACK-10.1G.6.2 — Progress / ETA UX audit

**Date:** 2026-09-18  
**STARTING_HEAD / origin/main:** `893dcfe43e01d0cb7348e22cda3b4b4810afab4b`  
**Launcher:** `0.6.0-rc.18`  
**Mode:** read-only (no source mutation)

---

## 1. Pipeline map (end-to-end)

| # | Stage | Primary files / symbols |
|---|--------|-------------------------|
| 1 | Planned download bytes (G.6) | `src/instance/plan/plannedDownloadBytes.ts` → `summarizePlannedDownloadBytes` |
| 2 | HEAD Content-Length enrich (G.6.1) | `src/download/planning/probeContentLength.ts`; `enrichPackPlanDownloadSizes`; `enrichRuntimePlanDownloadSizes` |
| 3 | Plan events | Pack `PLAN_READY` (`src/instance/plan/index.ts`); runtime `RUNTIME_PLAN_READY` (`src/minecraft/runtime/plan.ts`) |
| 4 | Orchestrator phases | `src/application/orchestrator/execute.ts` + `progress.ts` |
| 5 | Download engine | `src/download/engine/index.ts` — `DOWNLOAD_STARTED` / `DOWNLOAD_PROGRESS` / `DOWNLOAD_VERIFIED` |
| 6 | Pack apply | `src/instance/apply/index.ts` (+ `FILE_*`) |
| 7 | Aggregator + speed/ETA | `desktop/main/install/install-progress-aggregator.ts`; `install-progress-speed.ts` |
| 8 | DTO normalize | `desktop/main/install/install-progress.ts` → `normalizeInstallProgress` |
| 9 | Desktop emit | `real-install-backend.ts` → `install-desktop-service.ts` (`emitProgress` **and** `emitStatus` with progress) |
| 10 | IPC | `sc:event:installProgress` (+ mirrored on status) |
| 11 | Angular | `install-actions.service.ts` → store → `home.page.ts` → `install-progress-format.ts` + `sc-progress-bar` |

**Fresh-install phase order (engine):**  
`INSPECTING` → `RESOLVING` → `PLANNING` → **`PREPARING_RUNTIME`** (MC/Fabric downloads) → **`DOWNLOADING`** (pack) → `VERIFYING` → `COMMITTING` → `CLEANUP` → `DONE`.

---

## 2. Field semantics

| Concept | Meaning today |
|---------|----------------|
| **downloaded / completedBytes** | Sum of in-flight + completed download `bytesReceived` / verified sizes within the **current download epoch** (runtime **or** pack). |
| **planned / totalBytes** | Locked from `PLAN_READY` / `RUNTIME_PLAN_READY` when `hasUnknownDownloadSize === false`. Immutable for that epoch. KEEP excluded. |
| **percentage** | `Math.floor((completed/total)*100)` clamped 0–100 when byte (or file) plan known; else indeterminate. |
| **bytesPerSecond** | Rolling window endpoints only (see §4). No EMA. |
| **etaSeconds** | `ceil(remainingBytes / bps)` only when byte plan known **and** rate defined **and** download/runtime phase. |
| **current phase** | Orchestrator `OperationPhase` → UI `InstallProgressPhase` via `PHASE_MAP`. |
| **metricScope** | `"download"` during byte-eligible download epochs; `"files"` during apply/verify when file plan known. |
| **epoch transition** | Entering `DOWNLOADING` / `PREPARING_RUNTIME` clears download map + **resets** speed tracker. |
| **unknown size** | No byte denominator, no %, no ETA; may fall back to download file counts. |

**Pause:** AbortSignal / stop-after-artefact architecture exists; **no** user Pause UI and **no** HTTP Range resume (G.6.1 Classification B). Not an ETA issue.

---

## 3. ETA estimator (math)

Source: `desktop/main/install/install-progress-speed.ts`

| Parameter | Value |
|-----------|--------|
| Window | 3000 ms rolling samples |
| Min span | 500 ms |
| Samples required | ≥ 2 |
| Rate | `(last.bytes − first.bytes) / (dtMs/1000)` — **first/last endpoints only** |
| Counter regression | `reset()` → undefined rate |
| Stall (`dBytes ≤ 0`) | undefined rate → ETA hidden |
| ETA | `Math.ceil(remaining / bps)` |
| Shown only if | `bytePercentEligible` ∧ `bps` defined ∧ remaining &gt; 0 |

**Scope truth:** ETA is **phase/epoch download remaining**, never whole-install remaining.  
**Wording lie:** UI says `≈ … restantes` with no phase qualifier → reads as global install ETA.

---

## 4. Micro-stutter root-cause ranking (evidence)

| Rank | Cause | Evidence | Likely human impact |
|------|--------|----------|---------------------|
| **1** | CSS `width` transition **280 ms** vs ~**100 ms** DTO ticks | `progress-bar.component.ts` + `--sc-duration-slow: 280ms` | Fill lags / fights stepped updates → perceived stutter |
| **2** | Dual coalesce **100 ms** (engine + aggregator) | `DownloadEngine.minProgressEmitIntervalMs`; `minEmitIntervalMs` | ~10 authoritative updates/s still stepped |
| **3** | `Math.floor` percent | `install-progress.ts` / aggregator helpers | Integer jumps; small byte deltas invisible then snap |
| **4** | Epoch boundary reset | `transitionPhase` → `speedTracker.reset()` + `downloads.clear()` | Bar/ETA drop at runtime→pack boundary |
| **5** | Dual IPC (`INSTALL_PROGRESS` + status with progress) | `install-desktop-service.ts` | Double Angular store updates per tick |
| **6** | Inter-file verify stalls | `dBytes ≤ 0` → rate/ETA flicker off | Text flash / bar pause |
| **7** | ETA `ceil` + coarse window | `computeEtaSeconds` | Second-scale text chatter (secondary to bar) |

Angular OnPush alone is **unlikely** primary cause (event-driven already coalesced).

---

## 5. FR/EN wording findings

| Surface | Today | Scope | i18n? |
|---------|--------|-------|-------|
| Phase titles | `install.progress.*` FR catalog | Phase | yes (`fr.json`) |
| Elapsed | `Temps écoulé : {duration}` | Global elapsed OK | yes |
| Scope labels | `Téléchargement` / `Fichiers` | Epoch metric | yes |
| Speed | `formatSpeedFr` hardcoded | Download | **no** |
| **ETA** | ``≈ ${formatDurationFr(s)} restantes`` | **Sounds global; is phase** | **no** |
| EN | Product FR-primary; no EN ETA string | — | absent |

**Proposed truthful copy (intent):**
- FR: `Temps restant pour cette étape : ≈ {duration}`
- EN (if bilingual later): `About {duration} left in this step`

Optional shorter FR: `≈ {duration} restantes pour cette étape`

Also noted (adjacent debt, not blocking G.6.2): download file-count line may append `fichiers` twice via template + hardcoded unit.

---

## 6. Smoothing options (evaluate only — no implement)

| Option | Idea | Truthfulness | Monotonicity | Cost | Complexity | Verdict |
|--------|------|--------------|--------------|------|------------|---------|
| **A** | CSS interpolate between authoritative % samples | High if transition ≤ tick or disabled when reducedMotion | Visual only; cannot outrun if width bound to last % | Low | Low | **Recommended primary for bar** |
| **B** | Renderer interpolate toward confirmed target at higher Hz | Risk if poorly bounded; invariant forbids outrunning bytes | Need hard clamp to last confirmed | Medium | Medium | Reject for G.6.2 (risk/complexity) |
| **C** | Change coalesce interval (e.g. 150–200 ms) | Unchanged truth | Fewer jumps | Slightly fewer emits | Low | Optional secondary |
| **D** | Rate/ETA hysteresis / EMA | Text only | Reduces ETA flicker; not bar | Low | Low–med | **Recommended for ETA text** |
| **E** | No change | — | — | — | — | Reject: wording debt confirmed |

**Minimal preferred combo:** truthful ETA wording (**must**) + **A** (shorten/disable fill transition or use `--sc-duration-fast`) + optional light **D** if ETA chatter remains.

Do **not** invent bytes/% ahead of confirmed samples.

---

## 7. Recommended minimal G.6.2 implementation

1. **Wording (required):** Change `formatEtaFr` / move to i18n key `install.progress.detail.eta_phase` with phase-scoped FR copy. Wire `home.page` / `buildInstallProgressDetails` only as needed.  
2. **Bar smoothness (minimal):** Reduce or remove `width` transition on `.fill` for determinate progress (keep reducedMotion = 0). Prefer token tweak scoped to progress-bar, not global hero.  
3. **Optional small D:** Soften ETA updates (e.g. hold last ETA unless Δ ≥ 1–2 s or rate changes &gt; threshold) — only if wording+CSS insufficient.  
4. **Out of scope for minimal:** denominator/transfer/HEAD/Abort/Pause UX; dual-IPC redesign; renderer byte interpolation.

### Likely files

- `ui/src/app/shared/install-progress-format.ts`
- `ui/src/assets/i18n/fr.json`
- `ui/src/app/shared/components/progress-bar/progress-bar.component.ts` (and/or local style)
- Tests: `ui/.../install-progress-format.test.ts`, `install-progress-ui.test.ts`
- Optional: `desktop/main/install/install-progress-speed.ts` (+ `install-progress-speed.test.ts`)

---

## 8. Deterministic test plan

| # | Assertion |
|---|-----------|
| T1 | Progress % never &gt; 100; never exceeds authoritative completedBytes/totalBytes |
| T2 | Denominator `totalBytes` stable within a download epoch |
| T3 | No backwards % except documented new-epoch semantics (runtime→pack reset) |
| T4 | ETA undefined before minSpan/confidence; hidden on stall (`dBytes≤0`) |
| T5 | ETA reappears after stall recovery with valid window |
| T6 | ETA string is phase-scoped (contains étape / step language); never implies whole install |
| T7 | Unknown total → indeterminate; no fabricated %/ETA |
| T8 | Terminal COMPLETED → exact 100% |
| T9 | Burst of engine events → aggregator emits ≤ ~1 / minEmitIntervalMs (existing coalesce tests) |
| T10 | (Optional CSS) fill transition duration ≤ tick or 0 under reducedMotion |

---

## 9. Human / packaged smoke

**Yes — one later packaged/human install smoke** after implementation.

Automated tests cover arithmetic, coalesce, and wording units; they cannot prove perceived micro-stutter on a real ~406 MB install.

---

## 10. Risks / regressions

| Risk | Mitigation |
|------|------------|
| Users relied on reading ETA as “total install left” | Explicit phase wording; optional UI note that apply/verify follow |
| Removing CSS transition feels “harsher” | Prefer shorter duration (e.g. 80–120 ms) over hard 0 unless reducedMotion |
| ETA hysteresis hides real slowdown | Cap hold time; always hide on stall |
| Touching dual-IPC | Defer — higher regression surface |

---

## 11. Final git status (audit time)

```
## main...origin/main
?? docs/audits/
```

HEAD unchanged `893dcfe…`. No product WIP. This artifact is local-only evidence.

---

## Operations

NO SOURCE CHANGE (except this audit document).  
NO COMMIT / PUSH / PACKAGE / TAG / RELEASE / DEPLOY.
