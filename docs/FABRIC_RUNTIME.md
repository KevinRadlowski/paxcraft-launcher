# Fabric Runtime

Resolver exact : `minecraftVersion` + `fabricLoaderVersion` depuis le release trusted.

Endpoints (prod) : `meta.fabricmc.net/v2/versions/loader/...`

Erreurs : `FABRIC_LOADER_NOT_FOUND`, `INVALID_FABRIC_METADATA`.

Le profile fournit `mainClass` + libraries. Merge avec vanilla : collision de path + hash différent → `RUNTIME_LIBRARY_COLLISION`.

Aucun loader « plus récent » automatique. Un seul `fetchFabricProfile` par résolution normale.

## Frontière de trust actuelle (0.3.0-alpha.2)

Fabric Meta **ne fournit pas** le même contrat de hash externe que Mojang (`version_manifest_v2.sha1`) pour ses JSON metadata.

Trust aujourd’hui :

| Contrôle | Statut |
|----------|--------|
| HTTPS strict | oui |
| Host / base officiel configuré (`DEFAULT_FABRIC_META_BASE`) | oui |
| Exact `minecraftVersion` | oui |
| Exact `fabricLoaderVersion` | oui |
| Validation structurelle du profile | oui |
| Cohérence id / versions dans le profile | oui |
| Hash/signature externe du JSON Fabric | **non** (protocole officiel n’en fournit pas) |

Les réponses sont fetchées en **bytes** (`FetchedMetadata`) puis parsées — architecture prête pour un renforcement ultérieur (hash/signature) **sans inventer** de donnée absente du protocole.

Ne pas inventer de signature/hash Fabric.
