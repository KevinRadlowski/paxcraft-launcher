# Install / Update / Repair — Application Orchestrator (Lot 0.5A / 0.5.0-alpha.4)

Version **0.5.0-alpha.4**

## Architecture

`src/application/orchestrator/` is a thin orchestration layer above frozen 0.1–0.4 engines:

### Mutating flow (exclusive cleanup authority)

```
acquire InstanceLock (lease)
        ↓
cleanup safe orphans (PLANNED/ACQUIRING/FAILED/ABANDONED only)
        ↓
strict transaction scan
        ↓
corrupt → INSTANCE_RECOVERY_REQUIRED (CORRUPT_TRANSACTION)
risky (APPLYING/VERIFYING/COMMITTING) → INSTANCE_RECOVERY_REQUIRED
        ↓
inspect / resolveLatestRelease / re-read state
        ↓
transaction journal PLANNED → ACQUIRING
        ↓
prepareMinecraftRuntime (optional)
        ↓
applyInstallation({ deferStateCommit, lockLease })  // files only
        ↓
auditInstance (final)
        ↓
pending.commit()  // state.json THEN anti-rollback
        ↓
transaction COMMITTED + cleanup
        ↓
releaseLease
```

### STATUS (read-only)

```
paths
  ↓
inspect lock safely (validated schema)
  ↓
LIVE lock → BUSY immediately (no tx scan mutation)
MALFORMED lock → RECOVERY_REQUIRED (LOCK_MALFORMED)
  ↓
else strict transaction tree scan (no rm)
  ↓
corrupt / risky → RECOVERY_REQUIRED
safe orphans → non-blocking finding SAFE_ORPHAN_TX (cleanup deferred to mutate)
  ↓
state / resolve / audit as usual
```

STATUS never deletes transactions or clears locks. Stale locks are reported (`STALE_LOCK`); only mutating ops with `forceStale` may clear them.

No crypto, low-level HTTP, OAuth, or file-safety logic is reimplemented here.

## Deferred state commit (0.5.0-alpha.2)

**Root cause (alpha.1):** `applyInstallation()` wrote `state.json` before the orchestrator final audit.

**Fix:** additive options on apply:

- `deferStateCommit: true` + required `lockLease` → mutate files, return `pending.commit()`
- Legacy `applyInstallation()` (no defer) keeps immediate state commit + own lock

Invariant: **APPLY files → FINAL AUDIT → STATE COMMIT LAST**.

## Lock lifetime

Mutating operations hold `InstanceLock` for the **entire** critical section (acquire first, release last).
Nested locking is avoided via `InstanceLockLease` (leaseId in `lock.json`); apply validates the lease instead of re-acquiring.

`lock.json` is schema-validated. Malformed lock files fail closed (not treated as absent).

## Transaction model

```
<instance>/launcher/transactions/<uuid>/
  metadata.json   ← recovery state source of truth
  journal.json    ← diagnostic / audit companion only
```

**Journal corruption alone does not block recovery** — only `metadata.json` drives orphan/corrupt decisions.

**Staging truth (option 2):** transaction dirs do **not** stage pack bytes. Verified temp downloads remain under `launcher/tmp/` owned by DownloadEngine / Instance Manager.

Phases (durable boundaries):

| Phase | Meaning |
|-------|---------|
| `PLANNED` | Transaction metadata created |
| `ACQUIRING` | Planning / prep under lock |
| `APPLYING` | Pack filesystem mutations (state not yet committed) |
| `VERIFYING` | Final audit against TrustedResolvedRelease |
| `COMMITTING` | Writing state.json (+ anti-rollback next) |
| `COMMITTED` | Success; directory cleaned |
| `FAILED` | Early failure before APPLYING |

`STAGED` is retained in the type union for compatibility but is **not** used by the orchestrator.

**PLANNED observability:** `create` writes `PLANNED` then the mutating flow immediately advances to `ACQUIRING` before any public hook. There is no deterministic externally observable `PLANNED` window under a live lock; the ACQUIRING race test covers the active-safe-cleanup hazard.

## Corrupt transactions

Any transaction directory with missing / unreadable / malformed / schema-invalid / phase-invalid / `transactionId` mismatch metadata is **corrupt**.

- Never auto-deleted
- Never fabricated as `phase=FAILED`
- STATUS → `RECOVERY_REQUIRED` + finding `CORRUPT_TRANSACTION`
- Mutating ops → `INSTANCE_RECOVERY_REQUIRED` with `reason: CORRUPT_TRANSACTION`

## Anti-rollback order

1. Final audit succeeds  
2. Instance `state.json` commit succeeds  
3. Anti-rollback acceptance persisted  
4. Transaction `COMMITTED`

If anti-rollback persistence fails after state commit → `ANTI_ROLLBACK_PERSIST_FAILED`
(transaction remains `COMMITTING`). Subsequent mutate ops fail with `INSTANCE_RECOVERY_REQUIRED`
until explicit reconciliation. This is **not** a normal SUCCESS.

## Lock release

Orchestrator releases only via `releaseLease(lease)` (pid **and** leaseId).
No pid-only `release()` fallback after lease failure (same-process multi-lease safe).

## Status model

| Status | Meaning |
|--------|---------|
| `NOT_INSTALLED` | No installed pack identity in `launcher/state.json` |
| `READY` | Installed == channel tip and audit OK (unmanaged extras allowed) |
| `UPDATE_AVAILABLE` | Installed behind / different from channel tip |
| `REPAIR_REQUIRED` | Same release tip but missing/corrupt/stale managed files |
| `BUSY` | Valid live `launcher/lock.json` (PID alive) |
| `INCOMPATIBLE_STATE` | Corrupt state schema/JSON |
| `RECOVERY_REQUIRED` | Risky orphan, corrupt transaction, or malformed lock |

Risky/corrupt orphans are never auto-deleted.
Mutating ops fail closed with `INSTANCE_RECOVERY_REQUIRED` while they remain.

## Crash recovery

| Orphan phase | State authority | Action |
|--------------|-----------------|--------|
| PLANNED / ACQUIRING / FAILED / ABANDONED | unchanged | Safe cleanup **under exclusive lock only** |
| APPLYING | previous state | Keep; `RECOVERY_REQUIRED`; audit/repair |
| VERIFYING | previous state | Keep; audit/repair |
| COMMITTING | inspect state vs tx release identity | Keep; deterministic operator recovery |
| COMMITTED | matches release | Cleanup OK |
| Corrupt metadata | unknown | Keep; `CORRUPT_TRANSACTION`; never auto-delete |

## Operation semantics

### INSTALL / UPDATE
Runtime prep before pack apply. Pack state commit only after final audit.

### REPAIR
Restores integrity of the **installed** release when it matches the channel tip.
If an update is available → `INSTANCE_UPDATE_REQUIRED` (**intentional limitation**, not a bug — no silent update).

## Auth independence

```
AUTH STATUS: BLOCKED_EXTERNAL_APPID_APPROVAL
```

Install/update/repair do not require Minecraft login.

## CLI

```
pnpm launcher:status|install|update|repair -- --channel dev [--instance <path>] [--json] [--skip-runtime]
```
