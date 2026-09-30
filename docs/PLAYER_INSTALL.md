# Installer SweetCraft Launcher (Windows)

Guide court pour un joueur. **Source officielle unique :** la page [Releases](https://github.com/KevinRadlowski/SweetCraft-Launcher/releases) du dépôt **SweetCraft Launcher** (fichiers publiés par l’équipe). Ne téléchargez pas l’installeur depuis un miroir, un Discord inconnu, ou un site de « cracks ».

Cette version Windows est **non signée** (pas de certificat Authenticode). Windows peut afficher SmartScreen. Ce n’est **pas** un « éditeur vérifié ».

## SmartScreen (avertissement Windows)

1. Confirmez d’abord que le fichier vient **uniquement** de la Release GitHub officielle, et que le nom + SHA-256 correspondent (ci-dessous).
2. Dans SmartScreen : **Informations complémentaires** → **Exécuter quand même**.
3. **N’essayez jamais de désactiver SmartScreen globalement** pour « faire passer » l’installeur. Ce n’est ni nécessaire ni recommandé.

## Vérifier le fichier avant d’installer

1. Le nom doit être exactement celui indiqué dans la Release, de la forme  
   `SweetCraft Launcher-<version>-win-x64-setup.exe`
2. Comparez le **SHA-256** publié dans les notes de Release (et dans `player-release-manifest-win-x64.json`) avec celui de **votre** fichier.

PowerShell :

```powershell
Get-FileHash -Algorithm SHA256 ".\SweetCraft Launcher-<version>-win-x64-setup.exe"
```

Si le hash ne correspond pas : **n’installez pas**. Re-téléchargez depuis la Release officielle.

## Première installation

1. Fermez d’éventuelles copies du Launcher.
2. Lancez l’installeur NSIS (installation **utilisateur**, pas besoin d’admin).
3. Choisissez le dossier d’installation si vous le souhaitez, puis terminez l’assistant.
4. Ouvrez **SweetCraft Launcher**.
5. Connectez-vous avec votre compte **Microsoft** (compte Minecraft).
6. Installez le pack SweetCraft proposé, puis cliquez **Jouer**.

## Mise à jour manuelle du Launcher

Ce n’est **pas** la même chose que la mise à jour du **modpack** dans l’application.

| Action | Où | Ce que ça change |
|--------|----|------------------|
| Mise à jour du **Launcher** | Nouvel installeur GitHub (cette page) | L’application Windows |
| Mise à jour du **pack / mods** | Boutons dans le Launcher | Fichiers du jeu / instance |

Il n’y a **pas** de mise à jour automatique du Launcher dans cette version. Toujours passer par un nouvel installeur officiel.

**Pour mettre à jour le Launcher :**

1. Fermez complètement SweetCraft Launcher (recommandé avant de lancer le setup).
2. Téléchargez le **nouvel** installeur depuis la Release officielle plus récente.
3. Vérifiez le nom de fichier et le SHA-256.
4. Relancez l’installeur : il s’installe **par-dessus** (même `appId` / produit Windows).
5. Si le Launcher est encore ouvert, l’installeur NSIS peut afficher une boîte de dialogue demandant de le fermer : confirmez pour continuer (comportement observé sur RC).
6. **Conservés** (contrat actuel NSIS `deleteAppDataOnUninstall: false` + données hors dossier d’install) :
   - `%APPDATA%\SweetCraft Launcher\` (réglages Launcher, compte / auth stockés côté produit)
   - données `launcher-data` sous ce profil
   - instance Minecraft **personnalisée** (hors dossier d’installation du programme)
7. **Ne supprimez pas** le dossier d’instance Minecraft pour « réparer » une mise à jour du Launcher.
8. Le **downgrade** (revenir à une version plus ancienne) n’est **pas pris en charge** pour les joueurs.

**SemVer identique, build différent :** le numéro de version affiché (ex. `0.6.0-rc.18`) peut rester le même alors que le **Build** (`À propos` / diagnostics) change. L’installeur Windows se base sur le SemVer NSIS ; pour le support, utilisez toujours le **Build** / `buildId`.

## Désinstallation

### Windows (Paramètres → Applications, ou raccourci Désinstaller)

Retire le **programme** installé (dossier d’installation + raccourcis). Contrat builder actuel (`deleteAppDataOnUninstall: false`) :

| Élément | Après désinstallation Windows |
|---------|-------------------------------|
| Application installée | **Supprimée** |
| `%APPDATA%\SweetCraft Launcher\` | **Conservé** |
| `launcher-data` (sous AppData produit) | **Conservé** |
| Instance **personnalisée** (hors install) | **Conservée** |
| Instance sous le profil AppData | **Conservée** (pas effacée par l’uninstaller NSIS) |

### Dans l’application (désinstallation du pack / instance)

Ce n’est **pas** la désinstallation Windows :

| Mode | Effet (contrat runtime) |
|------|-------------------------|
| **SAFE** | Retire les fichiers **gérés** du modpack ; conserve mondes / captures / personnalisations non gérées ; compte et réglages Launcher inchangés |
| **COMPLETE** | Supprime **toute** l’instance SweetCraft ciblée (y compris mondes et fichiers perso de cette instance). Compte Launcher et paramètres Launcher **conservés** |

Ne confondez pas « enlever le programme Windows » et « désinstallation COMPLETE du pack ».
