# Native Extraction

Extraction ZIP **dédiée** aux natives déjà téléchargées et hash-vérifiées.

Protections Zip Slip :
- pas d’absolu / drive / UNC
- pas de `..`
- pas de backslash
- exclusions `META-INF/` (et metadata extract.exclude)
- destination sous `nativesRoot` uniquement

Méthodes ZIP : STORE (0), DEFLATE (8).

Ne pas réutiliser pour resource packs (bytes opaques).
