# PACK-PAX-08 — Compte / Paramètres + référence Diagnostics

**Statut :** TERMINÉ
**Date :** 2026-10-01
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` — **aucun commit**
**WIP :** 03→08 préservé (dont 07/07.1).

## Inventaire fonctions → emplacement

### Mon compte

| Avant | Après | Conservé |
| --- | --- | --- |
| Hero château SweetCraft | En-tête compact titre + sous-titre | — |
| Bloc identité (restoring / connecté / vide) | Bloc principal profil/session | États, busy, retry, login/reauth/logout |
| Actions connexion / gestion / déconnexion | Identiques | Oui |
| Cartes MS / sécurité / comptes enregistrés | Conservées, tokens Pax | Modales d’aide, liste, badges |
| Bandeau communauté + lien site | **Retiré** (URL site = `null`, pas de lien inventé) | — |
| `lastUsed` epoch | Affiche « Inconnue » si absent/invalide | Helper renforcé (`< 2000`) |

### Paramètres

| Avant | Après | Conservé |
| --- | --- | --- |
| Hero château + banner marketing | En-tête « Les réglages utiles, sans détour. » | — |
| A Mémoire | Carte mémoire (slider, bornes, suggestion, save/reset) | Calculs / limites / busy |
| B Interface | Langue RO + reduced motion ; badge Premium retiré | Pas de thème/langue inventés |
| C Emplacement + données | Cartes location + data | Confirmations, open, indisponibilité |
| Réseau | Carte réseau (présentation « non configuré ») | Refresh serveur, DTO sentinel inchangé |
| D Système / À propos | Blocs `<details>` repliables (ouverts par défaut) | Polling, refresh, buildId, versions |
| Accents violets / slider magenta | Tokens or/navy Pax | Sémantique warning/success |

## Contrats / actions préservés

- Auth : `login` / `reconnect` / `logout` / `select` / `retry` + guards busy
- Settings : `memoryMiB`, `reducedMotion`, location modify/move/set, open instance/logs
- IPC / chemins / trust / Pack Manager / réseau produit : **inchangés**
- Shell / accueil : non modifié (vérifié via captures READY + modale)

## Diagnostics (capture seule)

| | |
|--|--|
| Route | `/diagnostics` |
| Sections visibles | Support (DTO + copier) ; Outils de développement ; Demo readiness/auth ; Fake auth/install/play |
| Branding résiduel UI | Quasi nul (header compact déjà Pax) ; libellés i18n flags `SWEETCRAFT_DESKTOP_*_FAKE` possibles dans formes Dev |
| Actions | Copier diagnostics ; appliquer fixtures Dev — **non exécutées en live produit** |
| Captures | Haut + bas viewport |

## Tests / build

| Check | Résultat |
| --- | --- |
| Tests UI (`pnpm --dir ui run test`) | **236 PASS** |
| Contrats account/settings desktop | PASS (assertions présentation adaptées) |
| `ng build` development | **PASS** |
| Electron / réseau produit | Non lancés |

## Captures

Sortie : `docs/pax-baseline/visual-after/PACK-PAX-08/`
Séries `PACK-PAX-07` et `PACK-PAX-07.1` **préservées**.
Isolation harness 07.1 : `?capture=` + clear erreurs entre scènes.

| Scène | Statut |
| --- | --- |
| 01–04 Compte (out / auth / restoring / error) | CAPTURED |
| 05–07 Paramètres (haut / bas / mémoire dirty) | CAPTURED |
| 08 Emplacement indisponible | **NOT_CAPTURED** — Dev gateway `instanceLocationAvailable=true` fixe ; pas de fixture sans changement métier |
| 09–10 Diagnostics haut/bas | CAPTURED |
| 11–12 Accueil READY + modale retrait | CAPTURED |
| 13–15 Narrow 1100×700 (compte / paramètres / accueil) | CAPTURED |

PNG + `manifest.json` + `planche-contact.html` + `captures-pax08.zip`.

## Viewport réduit

- Titlebar / contrôles fenêtre OK (héritage 07.1).
- Paramètres 1100×700 : cartes bas accessibles au scroll (réseau/système hors cadre viewport ≠ inaccessible).

## Fichiers touchés (principaux)

- `ui/src/app/features/account/account.page.ts`, `account-presentation.ts`, `account-visual.test.ts`
- `ui/src/app/features/settings/settings.page.ts`, `settings-visual.test.ts`, `settings-instance-location.test.ts`
- `ui/src/app/features/diagnostics/diagnostics.page.ts` (`data-testid` uniquement)
- `ui/src/assets/i18n/fr.json`
- `tests/desktop/account-page-contracts.test.ts`, `settings-page-contracts.test.ts`
- `scripts/pax-visual-capture/capture-cdp.mjs` (OUT 08 + scènes)
- `docs/pax-baseline/visual-after/PACK-PAX-08/**`
- `docs/pax-baseline/PACK-PAX-08.md`, `CURRENT_STATE.md`

## Limites restantes

- Chemin instance Dev peut encore afficher un dossier legacy (`C:\Dev\SweetCraft`) — valeur runtime, hors rebrand UI.
- Emplacement indisponible : nécessite fixture Dev dédiée (hors périmètre métier).
- Diagnostics non refondu (lot suivant éventuel).
- Captures = renderer navigateur hermétique.
