# PACK-PAX-06 — Captures de référence avant rebranding

**Statut :** TERMINÉ
**Date :** 2026-10-01
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57`
**WIP :** 03→05.1 préservé (non commité). Captures = working tree, pas HEAD seul.

## Objectif

Référence visuelle du renderer actuel (héritage SweetCraft + identité PaxCraft partielle) avant adaptation DA Pax Horizon. **Aucun** rebranding ni changement produit UI dans ce lot.

## Résultat

| Métrique | Valeur |
| --- | --- |
| Scènes CAPTURED | **11 / 11** |
| NOT_CAPTURED | 0 |
| Viewport | 1280×800 (BrowserWindow actuel) |
| Runtime | Chrome système + CDP headless ; `ng serve` `127.0.0.1:4202` |
| Blocage externe | Observé : `https://example.com/` → `Fetch.failRequest` (count=1) |

### Scènes

| ID | État | Fixture |
| --- | --- | --- |
| 01-home-not-installed | CAPTURED | auth SIGNED_OUT + install NOT_INSTALLED |
| 02-home-installed-ready | CAPTURED | AUTHENTICATED + READY |
| 03-home-install-busy | CAPTURED | AUTHENTICATED + BUSY |
| 04-home-update-available | CAPTURED | AUTHENTICATED + UPDATE_AVAILABLE |
| 05-home-repair-required | CAPTURED | AUTHENTICATED + REPAIR_REQUIRED |
| 06-home-install-error | CAPTURED | AUTHENTICATED + NETWORK_ERROR + confirm install → toast erreur réseau |
| 07-account-signed-out | CAPTURED | SIGNED_OUT |
| 08-account-authenticated | CAPTURED | AUTHENTICATED (`JoueurDemo`) |
| 09-settings | CAPTURED | AUTHENTICATED + READY |
| 10-home-network-unconfigured | CAPTURED | défaut fail-closed (serveur indisponible / not-configured) |
| 11-home-uninstall-modal | CAPTURED | READY + modal désinstallation |

Mid-flight update/repair animé : non figé séparément (phases Dev ~20 ms) — readiness capturée à la place.

## Livrables

Dossier : `docs/pax-baseline/visual-before/2026-10-01/`

- PNG `01`…`11-*.png`
- `manifest.json` (SHA256, fixtures, runtime, réseau)
- `README.md`
- `planche-contact.html`
- `captures-pax06.zip` (PNG + manifest + README + planche ; pas de secrets)

Harness (hors produit) : `scripts/pax-visual-capture/capture-cdp.mjs`
(`capture.mjs` Playwright non utilisé — module Playwright absent ; aucun install navigateur/npm dans ce lot.)

## Fichiers ajoutés / modifiés (lot)

**Ajoutés**

- `docs/pax-baseline/PACK-PAX-06.md`
- `docs/pax-baseline/visual-before/2026-10-01/**` (PNG, manifest, README, planche, ZIP)
- `scripts/pax-visual-capture/capture-cdp.mjs`
- `scripts/pax-visual-capture/capture.mjs` (brouillon Playwright, non exécuté)

**Modifiés produit** : aucun (branding / styles / network gates / logique métier inchangés).

## Processus

- `ng serve` + Chrome CDP démarrés pour le lot puis arrêtés.
- Pas d’Electron / EXE / Minecraft / auth live / HTTP produit.
- Pas de commit / staging / push.

## Limites

Captures = renderer navigateur hermétique. Ne valident pas Electron shell, interactions OS, ni DA future Pax Horizon.
