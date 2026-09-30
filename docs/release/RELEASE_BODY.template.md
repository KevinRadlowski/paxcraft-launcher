# SweetCraft Launcher {{SEMVER}}

{{CHANNEL_NOTE}}

**Canal :** `{{CHANNEL}}`  
Les valeurs de cette note (`SemVer`, `buildId`, hash, taille) sont injectées depuis le manifeste de qualification (`player-release-manifest-win-x64.json`) par `pnpm release:body`. Ne pas y coller une version en dur.

## Build non signé (Windows)

Ce fichier **n’est pas signé**. Windows SmartScreen peut avertir. Ce n’est **pas** un éditeur vérifié Microsoft, et ce n’est **pas** une preuve Authenticode.

1. Téléchargez **uniquement** depuis cette Release GitHub officielle.
2. Vérifiez le nom de fichier et le SHA-256 ci-dessous.
3. SmartScreen : **Informations complémentaires** → **Exécuter quand même** — **uniquement** après cette vérification.
4. **Ne désactivez pas SmartScreen** au niveau du système.

Guide joueur : [{{INSTALL_DOC}}]({{INSTALL_DOC}})

## Provenance

| Champ | Valeur |
|-------|--------|
| SemVer | `{{SEMVER}}` |
| buildId | `{{BUILD_ID}}` |
| commit | `{{BUILD_COMMIT}}` |
| Date de qualification | `{{CREATED_AT}}` |

## Installeur

| Champ | Valeur |
|-------|--------|
| Fichier | `{{SETUP_FILENAME}}` |
| Taille (octets) | `{{SIZE_BYTES}}` |
| SHA-256 | `{{SHA256}}` |

PowerShell :

```powershell
Get-FileHash -Algorithm SHA256 ".\\{{SETUP_FILENAME}}"
```

## Mise à jour du Launcher ≠ mise à jour du pack

- **Launcher** : fermer l’application, télécharger un installeur plus récent, vérifier le hash, installer par-dessus. AppData, compte Microsoft et instance personnalisée sont conservés. Ne pas supprimer le dossier Minecraft. Le downgrade n’est pas pris en charge.
- **Modpack** : utiliser les boutons de mise à jour / réparation **dans** le Launcher.

## Désinstallation

La désinstallation **Windows** retire le programme et **conserve** en principe `%APPDATA%\SweetCraft Launcher\` ainsi qu’une instance personnalisée.  
La désinstallation **COMPLETE dans l’application** n’est pas la même opération : elle vise les fichiers d’instance gérés par le Launcher.

Détail : [docs/PLAYER_INSTALL.md]({{INSTALL_DOC}})
