# Modèle d’instance (Lot 0.2)

## Layout

```
<instanceRoot>/
  mods/
  config/
  resourcepacks/
  logs/
  launcher/
    state.json
    lock.json
    downloads/
    tmp/
```

Aucune écriture hors `instanceRoot`. Les chemins issus du manifest passent d’abord par les validateurs Core, puis `resolveSafeInstancePath` (anti-`..`, absolus, symlink/junction escape).

## InstanceState

`schemaVersion`, `installedPackVersion`, `installedReleaseSequence`, `installedReleaseSha256`, `installedManifestSha256`, `channel`, `productBase`, `files[]`, `updatedAt`.

Chaque fichier managed : `type`, `logicalId`, `targetPath`, `sha256`, `size`, `policy?`, `autoEnable?`, `source: "manifest"`.

Écriture atomique (temp → fsync → rename). State corrompu → `CORRUPT_STATE` (jamais cru silencieusement).

## Managed vs unmanaged

- **Managed** : présent dans `state.files` (installé par le Launcher).
- **Unmanaged** : fichier local (ex. `.jar` utilisateur) hors state — **jamais** supprimé automatiquement.
- **Stale managed** : dans state mais absent de la nouvelle release → `DELETE_MANAGED`.

## Config policies

| apply | Absent | Présent |
|-------|--------|---------|
| `force` | installer | hash ok → KEEP ; sinon REPLACE |
| `if_missing` | installer | conserver (même hash différent) |
| `never_overwrite` | installer (seed) | conserver — **mêmes sémantiques disque** que `if_missing` ; différence = intention catalogue CLIENT_PRESERVE |

## Crash safety

DOWNLOAD → VERIFY → APPLY mutations → WRITE STATE last.

Échec avant state : release non déclarée installée ; temps nettoyés.

## Locks

`INSTANCE_LOCKED` si PID vivant. Lock stale (PID mort) : refuse sauf `forceStale` explicite — jamais voler un lock vivant.

## Dry-run

Plan uniquement : aucun download, aucune mutation disque.
