# Launch Engine

Lot **0.3B** — `0.3.0-beta.2`

## Pipeline

```
RESOLUTION
→ buildLaunchSpec() / prepareLaunch()   # logique uniquement, pas d'argfile disque
→ validate readiness
→ runPreparedLaunch()
    → lease = GameProcessLock.acquire (reservation, schema v3)
    → materializeLaunchArguments()      # argfile juste avant spawn si planifié
    → spawn(shell:false) + bindGamePid(lease, gamePid)
    → cleanup argfile (toujours)
    → releaseLease(lease)              # exact ownership — no pid-only fallback
```

## Argfile (Windows)

- Planifié dans `ArgfilePlan` (lignes + tmpRoot) — **pas écrit** pendant prepare/dry-run.
- Matérialisé immédiatement avant spawn : `launch-args-<pid>-<uuid>.txt`.
- Contient éventuellement `auth_access_token` résolu — **durée = vie du process jeu uniquement**.
- Cleanup best-effort après exit / signal / spawn error ; `ARGFILE_CLEANUP_FAILED` sans contenu.
- `mode 0o600` best-effort ; **sur Windows ce n’est pas une ACL forte** (documenté, non prétendu).

`launcher:launch-plan` / prepare : **aucun fichier secret** sur disque.

## LaunchIdentity UUID

Format interne : UUID RFC **avec tirets**. Auth Microsoft future doit normaliser avant construction.

## Secrets

Toute sortie diagnostic / events = redacted. Spec en mémoire peut contenir le token.
