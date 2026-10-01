# PACK-PAX-06 — Captures de référence (avant rebranding DA)

**HEAD git :** `33499137b02a3057f3891b978a8b484f06d44c57`
**WIP :** PACK-PAX-03 → 05.1 présents (non commités). Les captures reflètent l’arbre de travail, pas HEAD seul.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `01`…`11-*.png` | Scènes renderer (viewport 1280×800) |
| `manifest.json` | Métadonnées, fixtures, SHA256, politique réseau |
| `planche-contact.html` | Grille de revue locale |
| `captures-pax06.zip` | Archive PNG + manifest + README + planche |

## Reproduction

1. Serveur renderer loopback uniquement :
   ```bash
   cd ui && pnpm exec ng serve --host 127.0.0.1 --port 4202
   ```
2. Capture (Chrome système + CDP Node, **aucune** dépendance npm ajoutée) :
   ```bash
   set PAX_CAPTURE_BASE=http://127.0.0.1:4202
   node scripts/pax-visual-capture/capture-cdp.mjs
   ```

Routes Angular en **hash** (`/#/home`, etc.). Fixtures via `DevLauncherDesktopGateway` (`ng.getComponent` + `setAuthFixture` / `setInstallFixture`), hors entrypoints produit.

## Outillage

- Viewport : **1280×800** (`desktop/main/window.ts`), `deviceScaleFactor` 1
- Navigateur : Google Chrome système, headless CDP
- Gateway : Dev (ng serve, pas de preload Electron)
- Réseau navigateur : allow `127.0.0.1` / `localhost` / `data:` / `blob:` ; hors loopback → `Fetch.failRequest`

## Limites

- Captures **navigateur** du renderer Angular — ne qualifient pas le rendu Electron ni le chrome Windows.
- Données fixtures fictives uniquement (ex. `JoueurDemo`, pack `1.0.0-fake`).
- Progression mid-flight update/repair non figée séparément (phases Dev ~20 ms) ; fixtures de readiness capturées.
- Scène `06` : erreur réseau après confirmation de la modal d’emplacement d’installation.
- Apparence encore majoritairement SweetCraft (référence avant DA Pax Horizon).
