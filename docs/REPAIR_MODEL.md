# Audit / Repair (Lot 0.2)

## auditInstance()

Statuts :

| Status | Signification |
|--------|----------------|
| OK | hash conforme (force/mod/rp) |
| MISSING | absent, à télécharger |
| CORRUPT | présent mais hash/size incorrect |
| PRESERVED | if_missing / never_overwrite — fichier utilisateur conservé |
| UNMANAGED | jar/fichier hors state — signalé, non touché |
| STALE_MANAGED | managed obsolète → candidat DELETE |

## planRepair()

Utilise **exactement** `buildInstallationPlan` (mêmes policies/trust). Aucune réparation « devinée ».

Appliquer un repair = `applyInstallation` avec la même `TrustedResolvedRelease`.

## Progress events

`PLAN_*`, `DOWNLOAD_*`, `FILE_*`, `STATE_WRITTEN`, `INSTALL_COMPLETE`, `AUDIT_*`, `REPAIR_*` — données structurées, pas de copy UI.
