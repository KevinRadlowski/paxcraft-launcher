# Play Orchestration (Lot 0.5B / 0.5.0-beta.4)

Version **0.5.0-beta.4**

Backend PLAY workflow above frozen 0.1–0.5A engines. No Electron/UI yet.

## Contract

PLAY **never** auto INSTALL / UPDATE / REPAIR.

| Status (0.5A) | PLAY error |
|---------------|------------|
| NOT_INSTALLED | `PLAY_INSTALL_REQUIRED` |
| UPDATE_AVAILABLE | `PLAY_UPDATE_REQUIRED` |
| REPAIR_REQUIRED | `PLAY_REPAIR_REQUIRED` |
| RECOVERY_REQUIRED | `INSTANCE_RECOVERY_REQUIRED` |
| BUSY | `INSTANCE_BUSY` |
| INCOMPATIBLE_STATE | `INSTANCE_STATE_INVALID` |
| READY | continue |

## Lock ordering (complete lifecycle)

```
PLAY START:
  InstanceLock
    ↓
  GameProcessLock acquire
    ↓
  InstanceLock release
    ↓
  Minecraft runs  (no InstanceLock held)

PLAY EXIT:
  argfile cleanup (independent)
    ↓
  InstanceLock acquire (short "game-cleanup")
    ↓
  exact GameProcessLock releaseLease
    ↓
  InstanceLock releaseLease (exact)

MUTATION:
  InstanceLock
    ↓
  GameProcessLock inspect → ABSENT only
```

Every ownership transition on `game-process.lock.json` is serialized through InstanceLock.

### Deferred cleanup

If InstanceLock cannot be acquired at exit (valid foreign owner after brief retries):

- do **not** unlink the game lock
- emit `PLAY_CLEANUP_WARNING` `{ reason: "game_lock_release_deferred" }`
- completion still resolves
- leftover STALE blocks UPDATE/REPAIR
- PLAY may later clear with explicit `forceStaleGameLock`

Intentional: safer than deleting a newer lease.

## Account / lastUsed (beta.3 preserved)

`lastUsed` best-effort after spawn+bind.
Failure → `PLAY_ACCOUNT_METADATA_WARNING` `{ reason: "last_used_persist_failed" }` — not a PLAY failure.

## Session restore

AbortSignal propagated (beta.2). Abort ≠ invalid_grant.

## RunningGame API

```ts
startGame(req, deps) → RunningGame
playAndWait(req, deps) → PlayResult (EXITED)
```

## Auth AppID blocker

Live auth remains `BLOCKED_EXTERNAL_APPID_APPROVAL`.
