# Process Model

## Runner

```ts
spawn(javaExecutable, spawnArgv, { cwd, env, shell: false })
```

Settlement unique : `error` et `exit` ne produisent qu’**un** résultat terminal.

### Bind / exit race (0.5.0-beta.3)

`start()` ne résout **pas** tant que :

1. child a un PID valide
2. `onSpawned(gamePid)` a réussi

Un exit/error pendant `onSpawned` est **retenu** — il ne peut pas contourner le résultat du bind.

| Cas | Résultat |
|-----|----------|
| bind OK, process vivant | `start` résout ; completion plus tard |
| exit pendant bind, bind OK | `start` après bind ; completion déjà à l’exit |
| exit pendant bind, bind fail | `start` **rejette** (bind authoritative) |
| child error pendant bind | terminal retenu ; settlement unique après bind |

### GAME_PROCESS_STARTED

Événement **low-level** émis dès qu’un PID child existe — **avant** bind/`onSpawned`.

Ne pas le traiter comme PLAY RUNNING autoritatif.
`PLAY_PROGRESS` phase `RUNNING` est émis seulement après `runner.start()` réussi (bind OK).

## GameProcessLock (schemaVersion 3)

```json
{
  "schemaVersion": 3,
  "launcherPid": 123,
  "leaseId": "opaque-uuid",
  "gamePid": 456,
  "createdAt": "...",
  "owner": "launcher:123",
  "operation": "play"
}
```

- **Ownership** : `leaseId` (opaque) + `launcherPid` — same-process safe.
- **Liveness** : `gamePid` vivant → ACTIVE (même si Launcher mort).
- Réservation : `gamePid: null` + `launcherPid` vivant → ACTIVE.
- **Inspection fail-closed** : `ABSENT` | `ACTIVE` | `STALE` | `MALFORMED`
- Stale / malformed → bloqués par défaut ; clear seulement avec `forceStale` explicite.
- **ACTIVE** : `forceStale` ne peut **pas** override un process vivant.

API bas niveau :

```ts
lease = await lock.acquire(op, { forceStale? })
await lock.bindGamePid(lease, gamePid)
await lock.releaseLease(lease)  // exact match — requires InstanceLock for cross-process safety
```

### Cross-process ownership (0.5.0-beta.4)

`inspect → rm` n’est **pas** atomique entre processus.

Toute transition qui **crée / force-remplace / supprime** `game-process.lock.json` doit être sérialisée sous **InstanceLock** :

| Transition | Sérialisation |
|------------|---------------|
| PLAY acquire / force-take | sous InstanceLock |
| Mutate inspect gate | sous InstanceLock |
| PLAY exit release | `releaseGameProcessLockCoordinated` = InstanceLock court `game-cleanup` → exact release → InstanceLock release |

Si le cleanup ne peut pas obtenir InstanceLock (owner live) :

- **ne pas** unlink
- laisser le lock (souvent STALE)
- `PLAY_CLEANUP_WARNING` `{ reason: "game_lock_release_deferred" }`
- mutations futures fail-closed ; PLAY peut `forceStaleGameLock`

Same-process `withGameLockFileOp` reste un filet additionnel — **insuffisant** seul pour le cross-process.

## Ordre global des locks

**InstanceLock BEFORE GameProcessLock** — jamais l’inverse.

### PLAY lifecycle

```
START:
  InstanceLock
    → GameProcessLock acquire
  InstanceLock release
  → Minecraft runs

EXIT:
  InstanceLock acquire (game-cleanup, court)
    → exact GameProcessLock release
  InstanceLock release
```

### MUTATION

```
InstanceLock
  → GameProcessLock inspect
  → ABSENT only → mutate
```

## Play ownership boundary (beta.3 — preserved)

**PRE_SPAWN** : échec → cleanup réservation + argfile OK.

**PROCESS_STARTED** : lease + argfile → lifecycle `RunningGame` ; `lastUsed` / listeners non-fatals.

## Legacy runPreparedLaunch (0.3B)

API bas niveau **sans** InstanceLock. Non sûre pour orchestration multi-process concurrente.
Les workflows produit utilisent `startGame` / `playAndWait` (0.5B).

## Events

`PLAY_ACCOUNT_METADATA_WARNING` — `last_used_persist_failed`
`PLAY_CLEANUP_WARNING` — `game_lock_release_deferred`

`ProgressEmitter` isole les exceptions des listeners.

## Dry-run

`prepareLaunch` sans `runPreparedLaunch` = aucun spawn, aucun argfile.
