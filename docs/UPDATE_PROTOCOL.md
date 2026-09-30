# Protocole d’update (consommateur)

Contrats figés côté Pack Manager — le Launcher les applique sans les modifier.

## Schemas

| Artefact | Schema accepté | Autre |
|----------|----------------|-------|
| catalog (réf. Pack Manager) | 2 | — |
| channel | **1 uniquement** | autre → `UNSUPPORTED_SCHEMA` |
| release | **2 uniquement** | schema 1 → `UNSUPPORTED_SCHEMA` |
| manifest | **6** + legacy **5** | autre → `UNSUPPORTED_SCHEMA` |

`unsigned-dev` (channel ou release) : toujours `UNSIGNED_REFUSED` — jamais de `TrustedResolvedRelease`.

## URLs

Base produit : `https://cdn.xnosweet.fr/sweetcraft`

- Channel : `{base}/channels/{dev\|beta\|stable}.json`
- Release : `{base}/{releasePath}` ex. `releases/0.1.2/release.json`
- Manifest client : `{base}/releases/{packVersion}/client-manifest.json`
- Fichiers : `{base}/releases/{packVersion}/` + `configBase` (`files/`) + path

## Channel schema 1

Champs : `schemaVersion`, `channel`, `packVersion`, `releaseSequence`, `releasePath`, `releaseSha256`, `signature`.

`releasePath` doit matcher `releases/<packVersion>/release.json` (anti-traversal).

## Anti-rollback client

État local : `highestAcceptedReleaseSequence` **par channel**.

Contrat égalité :

- `sequence < highest` → `ROLLBACK_DETECTED`
- `sequence > highest` → OK (persister après apply réussi — apply hors lot 0.1)
- `sequence == highest` → OK **uniquement** si même identité (`packVersion`, `releasePath`, `releaseSha256`)

Persistance atomique (temp + rename).

## Config policies (client)

Modes `apply` acceptés : `force` | `if_missing` | `never_overwrite`.

Toute autre valeur → fail closed (`INVALID_CONFIG_POLICY`).

Policies Pack Manager interdites dans un manifest client : `EXCLUDED`, `COMMON_FORCE_REVIEW`, `NEVER_CLIENT_SECRET_REVIEW`, `CLIENT_DEFAULT_PRESERVE`.

## Resource packs (manifest v6)

`resourcePacks[]` : `id`, `displayName`, `version`, `targetPath`, `sha256`, `size`, `autoEnable`.

- IDs uniques
- `targetPath` sous `resourcepacks/`, finit par `.zip`, POSIX sûr
- Pas de `sourcePath`, pas de chemins absolus / traversal

Schema 5 : `resourcePacks` implicitement `[]`.

## Lot 0.2 scope

Après `TrustedResolvedRelease`, le Launcher planifie / télécharge / applique mods, configs et resource packs dans une instance isolée. Voir `INSTANCE_MODEL.md`.
