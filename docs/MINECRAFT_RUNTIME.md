# Minecraft Runtime

Lot **0.3A** / correctif **0.3.0-alpha.2** — installation/vérification du runtime Minecraft (sans launch).

## Source de vérité

- Versions MC / Fabric : `TrustedResolvedRelease` / client manifest (jamais hardcodées comme vérité moteur).
- Artefacts officiels : métadonnées Mojang / Fabric exactes (jamais « latest »).

## Flux

RESOLUTION → PLAN → DOWNLOAD → INSTALL → AUDIT

## Intégrité des metadata version (bloquant)

Le `version_manifest_v2` Mojang fournit un `sha1` par entrée. Flux obligatoire :

1. FETCH version manifest (bytes) → JSON.parse → modèle
2. Sélection **exacte** de la version demandée
3. FETCH version JSON **as bytes**
4. Vérifier SHA-1 exact contre `entry.sha1`
5. Seulement ensuite `JSON.parse` → `parseVersionMeta`

Une entry **sans** `sha1` est refusée (`MINECRAFT_METADATA_SHA1_MISSING`).  
Un hash incorrect → `MINECRAFT_METADATA_HASH_MISMATCH` **avant** tout parsing fonctionnel.

### Parents (`inheritsFrom`)

Même contrat : le parent doit exister dans le **même** manifest → fetch bytes → verify `parent.sha1` → parse/merge.  
Parent absent du manifest → fail closed (`MINECRAFT_VERSION_NOT_FOUND`).

## Asset index

1. FETCH asset index as bytes  
2. Vérifier `size` puis SHA-1 (`assetIndex.sha1`)  
3. JSON.parse → `parseAssetIndex`  
4. Seulement ensuite construire les objets à télécharger  

Erreurs : `ASSET_INDEX_SIZE_MISMATCH`, `ASSET_INDEX_HASH_MISMATCH`.

## Abstraction bytes

`FetchedMetadata { bytes, contentType?, url? }` — séparer FETCH BYTES / VERIFY / PARSE JSON / VALIDATE DOMAIN.

## Layout

```
<runtimeRoot>/
  minecraft/versions|libraries|assets|natives
  java/runtimes
  launcher/runtime-state.json|lock.json|tmp
```

`--runtime-root` obligatoire. Jamais `.minecraft` implicite.

## Intégrité artefacts

- SweetCraft : SHA-256
- Mojang artefacts : SHA-1 officiel (`IntegrityExpectation`)

## Inheritance

Merge déterministe root→leaf ; cycle / profondeur max → fail closed. Voir `resolveVersionInheritance`.

## Rules

Sans rules ⇒ allow. Avec rules ⇒ départ disallow, dernière règle matchante gagne.  
Rules malformées au parse → `INVALID_MINECRAFT_METADATA` (pas de TypeError JS).

## Nombres Mojang

`size`, `totalSize`, `javaVersion.majorVersion` : finite, integer, ≥ 0, safe integer.

## Audit

OK / MISSING / CORRUPT / INVALID_METADATA / MISSING_JAVA / INCOMPATIBLE_JAVA
