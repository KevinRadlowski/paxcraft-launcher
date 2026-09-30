# SweetCraft Launcher

Client desktop **Windows x64** pour installer, vérifier et lancer le modpack **SweetCraft** (Minecraft Java Edition + Fabric).

Version du dépôt / RC GitHub : **0.6.0-rc.18** (tag `v0.6.0-rc.18`).

> **Pack Manager** (publication / signatures) est un projet **séparé et privé**.
> Ce dépôt est uniquement le client **consommateur / vérificateur**.

## Statut

- Canal **préversion (RC)** — pas une release stable.
- Installateur **NSIS non signé** : Windows SmartScreen (« Éditeur inconnu ») peut s’afficher tant qu’il n’y a pas de certificat Authenticode.
- Mises à jour du **Launcher** : **manuelles** (nouvel installeur) — pas d’auto-update Launcher dans cette RC.
- Mise à jour du **modpack** : gérée **dans** le Launcher (résolution / vérification / réparation d’instance).
- Page SweetCraft actuelle : [https://xnosweet.fr/sweetcraft](https://xnosweet.fr/sweetcraft)
- Portail dédié prévu : [https://sweetcraft.xnosweet.fr](https://sweetcraft.xnosweet.fr) — **pas encore déployé**

## Joueurs — installation (Windows x64)

1. Obtenir l’installeur depuis la [Release `v0.6.0-rc.18`](https://github.com/KevinRadlowski/SweetCraft-Launcher/releases/tag/v0.6.0-rc.18).
   Tant que ce dépôt GitHub est **privé**, le téléchargement des assets nécessite un accès autorisé.
   **Si** le dépôt est rendu public plus tard, les assets de Release pourront être téléchargés sans compte GitHub.
2. Optionnel : contrôler `player-release-manifest-win-x64.json` (taille + SHA-256) avant d’exécuter le setup.
3. Lancer l’installeur ; en cas d’avertissement SmartScreen, utiliser « Informations complémentaires » → « Exécuter quand même » **uniquement** si le fichier vient de la Release officielle et que le hash correspond.
4. Se connecter avec un compte **Microsoft** (OAuth public client + PKCE). Le Launcher ne demande pas et ne stocke pas le mot de passe Microsoft.
5. Installer / réparer l’instance SweetCraft isolée (versions épinglées, vérification d’intégrité).

Guide détaillé : [docs/PLAYER_INSTALL.md](docs/PLAYER_INSTALL.md)

## Développeurs — prérequis

- Node.js >= 22
- pnpm (voir le champ `packageManager` de `package.json`)

```bash
cd SweetCraft-Launcher
pnpm install:all
pnpm test
pnpm build
```

Deux lockfiles (racine + `ui/`) — pas un unique workspace pnpm.

## Propriété intellectuelle

Le code source de ce dépôt pourra être **lisible** sur GitHub si le propriétaire rend le dépôt public.

**Aucun droit général de copie, modification ou redistribution du code source n’est accordé.**
L’usage de l’installeur / application officiellement distribués est décrit dans [NOTICE](NOTICE).
Logiciel **propriétaire** — voir [NOTICE](NOTICE).

Les dépendances npm, Minecraft / Microsoft / Mojang, Fabric et les mods / assets tiers restent soumis à **leurs** licences et conditions. Ce projet ne revendique pas leur propriété.

## Documentation technique

- [Architecture](docs/ARCHITECTURE.md)
- [Trust model](docs/TRUST_MODEL.md)
- [Update protocol](docs/UPDATE_PROTOCOL.md)
- [Instance model](docs/INSTANCE_MODEL.md)
- [Download engine](docs/DOWNLOAD_ENGINE.md)
- [Player install](docs/PLAYER_INSTALL.md)
- [CI](docs/CI.md)
