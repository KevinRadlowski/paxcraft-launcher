# PACK-PAX-11 — Checkpoints Git locaux et préparation V1

**Statut :** TERMINÉ
**Date :** 2026-10-01
**Parents :** Launcher `33499137…` · Pack Manager `f5742a6…`
**Remotes / push / tags :** aucun (lot local uniquement)

## Préflight

| Dépôt | Branche | Index avant | Remotes |
| --- | --- | --- | --- |
| PaxCraft-Launcher | `main` | vide | 0 |
| PaxCraft-PackManager-v0.1 | `main` | vide | 0 |

WIP 03→10 préservé. Aucun reset/clean/stash/rebase. SweetCraft original et données pack non touchés.

## Vérifications fermées avant checkpoint

### 778 → 777 (contrats visuels Desktop)

| | |
|--|--|
| Suite | moteur/Desktop (`tsx --test tests/**`) |
| 05.1 | **778 PASS** (`logs/test-launcher-pax051.log`, gitignored) |
| 10 | **777 PASS** (`logs/pax10-test-engine-desktop.log`, gitignored) |
| Delta | **−1** `it()` |

**Cause :** `tests/desktop/account-page-contracts.test.ts`
- **Retiré :** `dedicated Account WebP assets (not Home hero)` — exigeait `ACCOUNT_ASSETS.hero/community` montés dans la page Compte.
- **Remplacé / adapté :** `compact page header without SweetCraft castle hero` + `community marketing strip removed…` (refonte PACK-PAX-08).
- **Settings contracts :** 15→15 (renommages, pas de perte nette).

**Justification :** le test WebP monté est **obsolète** (page sans hero château). Les fichiers WebP restent sur disque ; `asset-integrity` / `account-assets.ts` / inventaire Settings résiduel couvrent l’existence/distinction. **Aucun test restauré** pour maintenir un compteur.

### Secrets (contenu, pas seulement noms)

Scan des candidats texte &lt; 2 Mo du working tree (modifiés + non suivis, hors binaires).
**Résultat :** 0 finding (pas de clé privée PEM, token GitHub/AWS, password/client_secret littéral).
Matériel de confiance public historique non modifié (`config/trusted-keys.json` hors diff).

### Assets — références avant exclusion

| Asset | Référence runtime | Checkpoint |
| --- | --- | --- |
| `assets/pax/background-accueil.jpg` | `HOME_ASSETS` hero/cards | **INCLUS** |
| `assets/pax/logo-pax.webp` | sidebar `HOME_ASSETS.paxLogo` | **INCLUS** |
| `assets/pax/logo-pax.png` | constante `paxLogoPng` non montée | **INCLUS** (source branding &lt; 200 Ko) |
| `assets/pax/background-accueil.png` | **aucune** (README seulement) | **EXCLU** (~5,2 Mo) — conservé sur disque |
| `captures-*.zip` | redondants vs PNG+manifest | **EXCLUS** via `.gitignore` `*.zip` — conservés sur disque |
| `docs/pax-baseline/logs/**` | preuves locales | **EXCLUS** via `logs/` / `*.log` — conservés sur disque |
| PNG + `manifest.json` + planches + PACK md | revue visuelle | **INCLUS** |

Lockfiles, clés publiques, manifests signés, modpack : **non modifiés**.

### Validation

Réutilisation PACK-PAX-10 (code inchangé hors docs 11) :
moteur/Desktop **777**, UI **240**, PM **335**, builds PASS. Electron/réseau/Minecraft **NOT_RUN**.

## Provenance `build.generated`

Les jumeaux `src/build.generated.ts` et `desktop/shared/build.generated.ts` inclus dans ce checkpoint décrivent encore :

- `LAUNCHER_BUILD_COMMIT` = `33499137b02a3057f3891b978a8b484f06d44c57`
- `LAUNCHER_BUILD_DIRTY` = `true`
- `LAUNCHER_BUILD_ID` = `0.6.0-rc.18@33499137b02a+dirty`

Ils reflètent la génération **lot 10** depuis le parent baseline + WIP — **pas** le SHA de ce checkpoint. Ne pas les falsifier.

**Procédure post-checkpoint (sans boucle de commits) :**

1. Après ce commit, le WT peut encore lister ces fichiers si une régénération change le contenu.
2. Exécuter `pnpm version:generate` puis `pnpm version:check` sur le nouveau HEAD.
3. Si les générés changent, les traiter dans un **lot ultérieur dédié provenance** (un commit distinct), sans enchaîner generate→commit→generate pour « attraper » le SHA.

## Checkpoint Launcher

**Message :** `chore: establish validated PaxCraft migration checkpoint`
**Auteur :** identité Git locale existante (non inventée).

Inclus (explicite) : WIP code/tests/CI, `src/product/`, UI Pax, docs PACK-PAX-03→11, captures PNG/manifests/planches before+after, assets Pax référencés (+ logo PNG source), scripts capture, `build.generated` tel quel (voir provenance).

## Checkpoint Pack Manager

**Message :** `chore: preserve Pax baseline notes and restore origin verifier config`

Inclus : docs pax-baseline (03, 03.1, 10, 11, CURRENT_STATE, README), `tsconfig.origin.json`.

## Préparation V1 (doc seule — versions non changées)

### Sources de version / consommateurs

| Source | Consommateurs |
| --- | --- |
| `package.json` `version` / `shortVersion*` | SoT SemVer ; sync scripts |
| `ui/package.json` `version` | renderer / affichage |
| `electron-builder.yml` `buildVersion` | PE Windows / artefacts |
| `src/version.ts` + `*.version.generated.ts` | runtime / UI info |
| `*.build.generated.ts` | buildId / dirty / commit affiché |
| `scripts/version-generate.mts` / `version-check.mts` | génération + garde |
| `scripts/release/manifest.mts` + tests release | manifests update (mécanisme historique) |

**Proposition (futur lot) :** qualifier en **`1.0.0-rc.1`**, publier en **`1.0.0`**. RC18 SweetCraft reste référence historique. **Aucune version modifiée dans PACK-PAX-11.**

### Domaines V1 (non activés ici)

| Domaine | État |
| --- | --- |
| Serveur Minecraft | cible fournie **`paxcraft.datho.st`** — accessibilité **non vérifiée** ; `servers.dat` **non modifié** |
| Distribution modpack | origine Pax **à définir** |
| Updates launcher | hébergement / mécanisme **à qualifier** |
| Auth Microsoft | config **à vérifier** indépendamment |
| Trust / signatures | chaîne Pax **à préparer** ; clés historiques **inchangées** |
| Gates réseau | restent fail-closed ; **pas d’activation** |

## Remotes (préparation — rien créé)

| Outil | Constat |
| --- | --- |
| Git | 2.52.0.windows.1 |
| gh | 2.100.0 ; session GitHub présente (compte actif) — **aucun credential affiché** |
| Remotes locaux | **0** sur les deux dépôts |

**Informations manquantes (à fournir, non inventées) :** hébergeur, propriétaire/organisation, noms exacts des deux dépôts distants, visibilité (privé/public).

## Limites

Electron, installateur, coexistence Windows, réseau réel, auth live, trust Pax, Minecraft — hors lot.
