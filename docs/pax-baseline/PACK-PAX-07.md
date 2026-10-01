# PACK-PAX-07 — Rebranding visuel / shell et accueil

**Statut :** TERMINÉ
**Date :** 2026-10-01
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` — **aucun commit**
**WIP :** 03→07 préservé (working tree).

## Objectif

Thème Pax Horizon (bleu nuit / or sable), shell et nouvel accueil Angular. Bindings, CTA et états réels conservés. Aucune activation réseau / Electron / moteur.

## Visuel

| Élément | Changement |
| --- | --- |
| Tokens `--sc-*` | Fond `#10171f`, surfaces `#131c2b`, accent `#d2a778`, textes `#eef1f5` / `#aab8ca`, séparateurs `#2b3749` |
| Typo | system-ui / Segoe UI ; script manuscrit neutralisé |
| Assets | Copies locales `ui/src/assets/pax/` depuis `branding-pax/` (PNG originaux + JPG/WebP dérivés) |
| Sidebar | Emblème Pax, PaxCraft, « PAR PAX HORIZON », nav Accueil / Mon compte / Paramètres / Diagnostics |
| Topbar | « Pax Horizon · Jeux, Partage, Impact » ; serveur affiché `not-configured` (pas d’adresse SweetCraft) |
| Footer | PaxCraft / Pax Horizon + version |
| Accueil | Hero paysage + bloc install réel + compte + communauté + bandeau serveur compact |

## Contrats préservés

- CTA `mapPrimaryAction` / readiness / auth / busy / play
- Progression, erreurs, verify / update / repair / dossier / uninstall (modales SAFE vs COMPLETE)
- Drag region titlebar, contrôles fenêtre, routes, diagnostics
- Liens produit absents (`SWEETCRAFT_WEBSITE_URL = null`) — pas de Discord inventé
- Compte / paramètres : thème partagé seulement (pas de refonte structurelle)

## Fichiers principaux

- `ui/src/styles/tokens.css`, `typography.css`, `global.css`
- `ui/src/assets/pax/**`, `ui/src/assets/i18n/fr.json`
- `ui/src/app/layout/sidebar|title-bar|status-bar/*`
- `ui/src/app/features/home/home.page.ts`, `home-assets.ts`
- `ui/src/app/core/state/app.store.ts` (`DEFAULT_SERVER = not-configured`)
- `ui/src/app/core/desktop-api/dev.gateway.ts` (adresse fixture `not-configured`)
- `scripts/pax-visual-capture/capture-cdp.mjs` (sortie after)
- `docs/pax-baseline/visual-after/PACK-PAX-07/**`
- `docs/pax-baseline/PACK-PAX-07.md`, `CURRENT_STATE.md`

**Non touchés :** moteur, auth/install IPC métier, lockfiles, Pack Manager, identité Windows, gates réseau produit.

## Validation

| Check | Résultat |
| --- | --- |
| Tests UI | **237 PASS** |
| `ng build` (development) | **PASS** |
| Captures after | **12/12** → `docs/pax-baseline/visual-after/PACK-PAX-07/` |
| Captures before | Préservées `visual-before/2026-10-01/` |
| Blocage fetch externe (capture) | `https://example.com/` failRequest |
| Electron / Minecraft / réseau produit | Non lancés |

## Limites

- Compte / paramètres : thème seulement — réorga détaillée = lot suivant
- Captures = renderer navigateur hermétique ≠ Electron
- Adresses historiques SweetCraft encore présentes dans certains fixtures de tests unitaires hors affichage produit
- Mid-flight update/repair non figé (phases Dev ~20 ms)

## Suite

Réorganisation compte/paramètres ; infrastructure Pax toujours UNKNOWN.
