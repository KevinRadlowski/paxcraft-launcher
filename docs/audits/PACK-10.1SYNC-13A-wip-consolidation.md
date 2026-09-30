# PACK-10.1SYNC-13A — WIP consolidation audit

**Date:** 2026-09-18  
**STARTING_HEAD:** `78bc1ddc8f26c6fd362b6c4ea3fe6cbbb669975c`  
**HEAD subject:** `feat: support versioned pack config migrations`  
**Mode:** read-only (no source mutation, no commit)

## Diff-stat (tracked vs HEAD)

```
24 files changed, 519 insertions(+), 84 deletions(-)
```

Untracked intentional sources/tests/tools: **17 paths** (see inventory).  
Ignored transient (sample): `dist/`, `dist-desktop/`, `/release/`, `*.log`, `docs.zip`.

---

## Full inventory & classification (A–G)

### Legend

| Code | Meaning |
|------|---------|
| A | Play/auth convergence |
| B | Config migration + missed-recovery + transition history |
| C | First-run Minecraft UX/ownership |
| D | Build/version/provenance/package parity |
| E | E2E verification/diagnostics |
| F | Packaging/build blocker fixes |
| G | Generated/transient/unrelated/UNKNOWN |

### Tracked modifications

| Path | Class | Provenance / notes |
|------|-------|-------------------|
| `ui/src/app/core/services/bootstrap.service.ts` | A | Auth→Play refresh on transition |
| `ui/package.json` | A+D | Adds `auth-play-convergence.test.ts` to UI test script; version → rc.18 |
| `src/instance/configMigration/apply.ts` | B | Versioned migration apply refactor (11D lineage) |
| `src/instance/state/instanceState.ts` | B+C | `appliedConfigMigrations`, `appliedFirstRunSeeds`, `priorPackVersions`, `mergePriorPackVersions` |
| `src/instance/apply/index.ts` | B+C | Migrations + reconcile hook + firstRun seeds + priorPackVersions on commit |
| `src/application/orchestrator/execute.ts` | B+C | Repair side-effects: missed recovery + firstRun seeds |
| `src/application/orchestrator/status.ts` | B+E+F | Missed-migration status findings; `last-non-ready-status.json`; TS narrowing fix (`status !== READY`) |
| `src/core/errors/index.ts` | C | `FIRST_RUN_SEED_FAILED` |
| `tests/instance/sync07-update-repair.test.ts` | C | Pre-marks `appliedFirstRunSeeds` for sentinel preservation |
| `package.json` | D | SemVer `0.6.0-rc.18`, shortVersion `0.6.0.18` |
| `ui/package.json` | D (+A) | SemVer rc.18 |
| `electron-builder.yml` | D | `buildVersion: 0.6.0.18` |
| `src/version.generated.ts` | D | Generated SoT (tracked pattern) |
| `desktop/shared/version.generated.ts` | D | Generated SoT |
| `scripts/version/lib.mts` | D | Build id generation helpers |
| `scripts/version-generate.mts` | D | Writes build.generated |
| `scripts/version-check.mts` | D | Validates build id coherence |
| `desktop/main/lifecycle.ts` | D | AppInfo exposes `buildCommit`/`buildId` |
| `desktop/shared/contract.ts` | D | DTO fields |
| `desktop/shared/validate.ts` | D | Normalize build fields |
| `tests/version/version-sot.test.ts` | D | rc.18 + build identity test |
| `tests/desktop/settings-page-contracts.test.ts` | D | Version string assertions → rc.18 |
| `tests/desktop/system-storage.test.ts` | D | Version string → rc.18 |
| `tests/desktop/windows-packaging-identity.test.ts` | D | Version assertions → rc.18 |
| `pnpm-lock.yaml` | G | Accidental `@electron/asar@4.3.0` **importer** drift (see lockfile verdict) |

### Untracked (should commit unless noted)

| Path | Class | Notes |
|------|-------|-------|
| `ui/src/app/core/services/auth-play-convergence.ts` | A | Pure helper |
| `ui/src/app/core/services/auth-play-convergence.test.ts` | A | Wired in `ui/package.json` test script |
| `src/instance/configMigration/missedRecovery.ts` | B | Transition-evidence gate |
| `tests/instance/missed-migration-recovery.test.ts` | B | A–H regression matrix |
| `tests/desktop/packaged-migration-parity.test.ts` | B+D | Dist parity incl. priorPackVersions gate strings |
| `src/instance/firstRun/**` | C | constants, optionsTxt, serversDat, seed, index |
| `tests/instance/first-run-seed.test.ts` | C | Fresh/legacy 12B |
| `src/build.ts` | D | Re-export of build.generated |
| `src/build.generated.ts` | D | Generated; commit like version.generated |
| `desktop/shared/build.generated.ts` | D | Generated twin |
| `scripts/e2e/verify-fresh-firstrun.ps1` | E | 12D verifier |
| `scripts/e2e/parse-servers-check.mjs` | E | Absolute module resolve |
| `tests/scripts/e2e-verify-fresh-firstrun.test.ts` | E | Helper contracts |

### Ignored / do not commit (G)

| Item | Reason |
|------|--------|
| `dist/`, `dist-desktop/`, `ui/dist/` | Build outputs (gitignore) |
| `/release/` installers, blockmaps, logs | Packaging artifacts (gitignore) |
| `*.log`, `docs.zip` | Transient |
| `electron-smoke.*.log` | Smoke temps |

No secrets/credentials detected in WIP paths (pattern scan of e2e/firstRun/missedRecovery).

---

## Lockfile verdict (11E debt)

**Current state:**  
- `package.json` does **not** declare `@electron/asar`.  
- HEAD lockfile already had **transitive** `@electron/asar@3.4.1` (via electron-builder).  
- Working tree adds a **direct importer** `@electron/asar@^4.3.0` (+ glob/lru-cache/path-scurry).  

**Verdict:** **Accidental certification drift** (G), almost certainly from `npx asar extract` / tooling during 11E/12C/12F asar inspection — **not** a legitimate product dependency.

**Action:** SYNC-13B — restore lockfile importer to HEAD (or `pnpm install` without asar) **before** including `pnpm-lock.yaml` in any commit. Do **not** commit current lockfile drift as-is.

---

## Version / provenance verdict

| Check | Result |
|-------|--------|
| Root SoT SemVer | `0.6.0-rc.18` (was rc.17 at HEAD) |
| UI package | `0.6.0-rc.18` |
| Windows shortVersion | `0.6.0.18` |
| electron-builder buildVersion | `0.6.0.18` |
| `version.generated.ts` | Synchronized rc.18 / 0.6.0.18 |
| Build provenance | `src/build.ts` + generated twins; `buildId=0.6.0-rc.18@78bc1ddc8f26+dirty` |
| Stale rc.17 in source SoT | Cleared in package/generated/tests inspected |
| Coherence | OK for intentional D commits |

Generated `*.generated.ts` are **authoritative outputs of `version:generate`** and are already a tracked pattern for version; build twins should follow the same commit policy.

---

## State-schema compatibility verdict

| Field | Optional? | Pre-field states |
|-------|-----------|------------------|
| `appliedConfigMigrations` | yes | Absent → treat as `[]` |
| `appliedFirstRunSeeds` | yes | Absent → seeds may run once (12B: existing files preserved + marker) |
| `priorPackVersions` | yes | Absent/empty → missed recovery `no_transition_evidence` (safe for fresh; historical unrecovered fieldless = debt, intentional) |
| `schemaVersion` | still `1` | No bump; additive optional fields |

Backward-compatible parsing confirmed in `parseInstanceStateJson`. No schema migration required for commits.

---

## Test-coverage gaps

| Area | Coverage |
|------|----------|
| A auth-play-convergence | Unit + UI test script entry |
| B missed recovery / priorPackVersions | Dedicated tests + sync07 + parity |
| C firstRun 12B | Dedicated tests + sync07 fixture |
| D version/build SoT | version-sot + packaging identity |
| E e2e verifier | tests/scripts |
| F status TS fix | Compile-only (no dedicated unit) |
| `last-non-ready-status.json` write | **Gap:** no focused unit test (behavioral via status path; human E2E validated absence on READY) |
| Lockfile asar | N/A product |

Packaging certification source delta beyond intended features: only the `status !== "READY"` narrowing fix (F) — covered by `tsc`.

---

## Cleanup required?

**YES — minimal SYNC-13B before treating the tree as fully commit-clean:**

1. Revert accidental `pnpm-lock.yaml` direct `@electron/asar@4.3.0` importer (keep transitive 3.4.1 via electron-builder).  
2. Optionally confirm `pnpm install --frozen-lockfile` (or equivalent) after restore.  
3. Do **not** delete/normalize other WIP in 13B.

After 13B: **commit-ready** for the ordered source commits below (excluding dirty lockfile).

Without 13B: source commits 1–6 can still proceed **if** `pnpm-lock.yaml` is **omitted** from those commits; do not ship lock drift.

---

## Proposed ordered commits

### Commit 1 — version bump
- **Purpose:** Publish SemVer SoT `0.6.0-rc.18` / Windows `0.6.0.18`.  
- **Files:** `package.json`, `ui/package.json` (version fields only ideally; test script list may wait for commit 5), `electron-builder.yml`, `src/version.generated.ts`, `desktop/shared/version.generated.ts`, desktop tests that only change version strings (`settings-page-contracts`, `system-storage`, `windows-packaging-identity`), partial `tests/version/version-sot.test.ts` version assertions.  
- **Note:** If splitting `ui/package.json` / `version-sot` is painful, fold UI test script + build identity tests into commits 2/5. Prefer keeping version literals coherent in one commit.  
- **Message:** `chore(release): bump launcher to 0.6.0-rc.18`  
- **Gate:** `pnpm version:check`; targeted version-sot / packaging-identity.

### Commit 2 — build provenance
- **Purpose:** Distinguish builds sharing SemVer via `buildCommit`/`buildId`.  
- **Files:** `scripts/version/lib.mts`, `scripts/version-generate.mts`, `scripts/version-check.mts`, `src/build.ts`, `src/build.generated.ts`, `desktop/shared/build.generated.ts`, `desktop/main/lifecycle.ts`, `desktop/shared/contract.ts`, `desktop/shared/validate.ts`, remaining `tests/version/version-sot.test.ts` build tests.  
- **Depends on:** Commit 1 (semver in buildId).  
- **Message:** `feat(desktop): embed buildCommit and buildId in AppInfo`  
- **Gate:** `pnpm version:check`; `pnpm exec tsx --test tests/version/version-sot.test.ts`.

### Commit 3 — missed migration + priorPackVersions
- **Purpose:** Durable transition evidence; repair-side recovery; non-READY snapshot.  
- **Files:** `src/instance/configMigration/missedRecovery.ts` (new), `src/instance/configMigration/apply.ts`, relevant hunks of `src/instance/state/instanceState.ts` (`appliedConfigMigrations`, `priorPackVersions`, `mergePriorPackVersions`), relevant hunks of `src/instance/apply/index.ts` / `execute.ts` / `status.ts`, `tests/instance/missed-migration-recovery.test.ts`, `tests/desktop/packaged-migration-parity.test.ts`.  
- **Coupling:** `apply/index.ts` / `execute.ts` / `state.ts` also contain firstRun — **prefer commit 3+4 as one** if hunk splitting is error-prone (see Combined 3/4 alternative).  
- **Message:** `feat(instance): recover missed config migrations with priorPackVersions evidence`  
- **Gate:** missed-migration + parity + sync07 (if not waiting for firstRun fixture line).

### Commit 4 — first-run UX
- **Purpose:** One-shot options/servers seed with 12B ownership.  
- **Files:** `src/instance/firstRun/**`, `FIRST_RUN_SEED_FAILED`, firstRun hunks in apply/execute/state, `tests/instance/first-run-seed.test.ts`, `tests/instance/sync07-update-repair.test.ts` seed markers.  
- **Message:** `feat(instance): seed Minecraft first-run options and servers safely`  
- **Gate:** first-run-seed + sync07 + instance suite subset.

### Alternative Combined 3+4 (recommended if splitting apply/execute/state is risky)
- **Message:** `feat(instance): first-run seeds and priorPackVersions missed-migration recovery`  
- **Files:** all of commits 3 and 4 together.  
- **Gate:** full `tests/instance/**` + application orchestrator tests.

### Commit 5 — Play/auth convergence
- **Purpose:** Refresh Play when auth becomes AUTHENTICATED from restoring/signed-out/reauth.  
- **Files:** `auth-play-convergence.ts`, `.test.ts`, `bootstrap.service.ts`, `ui/package.json` test script entry (if not in commit 1).  
- **Message:** `fix(ui): refresh Play eligibility on auth state transition`  
- **Gate:** `pnpm --dir ui exec node --import tsx --test src/app/core/services/auth-play-convergence.test.ts` (or ui test script).

### Commit 6 — E2E verifier tooling
- **Purpose:** Disposable fresh-instance certification helpers.  
- **Files:** `scripts/e2e/**`, `tests/scripts/e2e-verify-fresh-firstrun.test.ts`.  
- **Message:** `chore(e2e): add fresh first-run verification helpers`  
- **Gate:** `pnpm exec tsx --test tests/scripts/e2e-verify-fresh-firstrun.test.ts`.

### Explicitly excluded until 13B
- `pnpm-lock.yaml` (current WC)

### Never commit
- `/release/*`, `dist/`, `dist-desktop/`, logs, archives.

---

## Exact validation plan (post-commit sequence)

After **13B lockfile restore**:

1. `pnpm version:check`  
2. `pnpm build`  
3. `pnpm exec tsx --test tests/instance/**/*.test.ts tests/application/**/*.test.ts`  
4. `pnpm exec tsx --test tests/desktop/**/*.test.ts`  
5. `pnpm --dir ui run test` (or at least auth-play + install-play convergence)  
6. Optional: `pnpm desktop:package` only when producing a **clean** (non-dirty) evidence build — not required to land commits.

Per-commit gates listed above; full matrix after the series.

---

## Statistics

| Metric | Count |
|--------|-------|
| Tracked modified | 24 |
| Untracked keep | 17 |
| Insertions / deletions (tracked) | +519 / −84 |
| Classification A files | 4 |
| B-heavy | ~8 |
| C-heavy | ~8 |
| D-heavy | ~14 |
| E | 3 |
| F | 1 (status TS) |
| G lockfile | 1 (exclude) |
| Secrets found | 0 |

---

## Final git status confirmation (audit time)

HEAD `78bc1ddc8f26…` dirty working tree as inventoried; no commits created by this lot.

## Operations confirmation

NO SOURCE CHANGE (except this audit document).  
NO COMMIT / PUSH / TAG / RELEASE / DEPLOY.
