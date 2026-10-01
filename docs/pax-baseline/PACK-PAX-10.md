# PACK-PAX-10 — Consolidation technique et préparation checkpoint Git

**Statut :** TERMINÉ
**Date :** 2026-10-01
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` — **aucun commit / aucun staging**
**WIP :** 03→10 préservé (index vide).

## Corrections (lot)

| Point | Action |
| --- | --- |
| Diagnostics ≤1100×700 | Padding/gaps/line-height des cartes d’état densifiés (3 col conservées) ; stack ≤720 plus compact |
| Fixture Dev `chooseLocation` | `D:\Games\SweetCraft` → **`D:\Games\PaxCraft`** (fictif) |
| Autres chemins Dev gateway | Défaut `C:\Dev\PaxCraft` ; flags `isSweetCraftDrive` inchangés (contrat API) |
| Soft-nav capture | Hash soft après fixtures (`?capture=`) — isolation scènes sans recharger le gateway |
| Test Settings assets | Conservé : inventaire résiduel unique/distinct (ne prouve pas le montage page) |

## Captures

`docs/pax-baseline/visual-after/PACK-PAX-10/` — **3/3 CAPTURED**
Séries 07 / 07.1 / 08 / 09 **préservées**.

| Scène | Contenu |
| --- | --- |
| 01 diagnostics-narrow | 1100×700, cartes densifiées |
| 02 settings-choose-location | `D:\Games\PaxCraft` |
| 03 settings-default-path | `C:\Dev\PaxCraft` |

PNG + manifest + planche + `captures-pax10.zip`.

## Revue diff cumulé (working tree, non stagé)

| Classe | Observations |
| --- | --- |
| Provenance / CI | Workflows `.github/`, `docs/CI.md`, `build.generated` dirty, contrats workflows |
| Identité / isolation | `PaxCraft Launcher`, appId, `product-data`, chemins instance Pax |
| Réseau / harness | `src/product/paxNetwork*` fail-closed ; hooks tests **hors** entrypoints produit |
| UI / assets | Shell/Home/Compte/Paramètres/Diagnostics ; `ui/src/assets/pax/` |
| Tests | Moteur/Desktop + UI adaptés ; pas de données pack réelles |
| Docs / captures | PACK-PAX-03→10, visual-before/after |
| Pack Manager | Docs + `tsconfig.origin.json` omis baseline (source) |

Contrôles : pas de modpack/data publish touchés ; réseau `networkEnabled=false` ; pas de fallback SweetCraft opérationnel ; Diagnostics DevTools derrière `showDevTools()` existant ; pas de secrets candidats (noms).

### Test Settings restauré (09)

`settings-visual.test.ts` — « residual Settings asset URLs… » : garantit encore **unicité** des URLs `SETTINGS_ASSETS` et **distinction** vs heroes Home/Account pour les WebP historiques encore livrés sous `assets/settings/`. **Ne garantit pas** que la page Paramètres les affiche (page sans hero). Conservation justifiée par couverture inventaire, pas par un quota de tests.

## Validation (comptes réels)

| Check | Résultat |
| --- | --- |
| `version:generate` / `version:check` | **PASS** (`+dirty`) |
| `tsc` moteur | **PASS** |
| `desktop:shared:build` | **PASS** |
| `desktop:ui:build` (`ng build`) | **PASS** |
| Suite moteur/Desktop | **777 PASS / 0 FAIL** |
| Suite UI | **240 PASS / 0 FAIL** |
| Pack Manager `build` | **PASS** |
| Pack Manager `test` | **335 PASS / 0 FAIL** |
| Electron / Minecraft / OAuth live / réseau produit | **NOT_RUN** (interdit) |
| NSIS / push / tag / install distant | **NOT_RUN** |

Logs : `docs/pax-baseline/logs/pax10-*.log` (+ PM `docs/pax-baseline/logs/pax10-pm-*.log`).

## Préparation Git — **sans staging ni commit**

### Launcher — proposer d’inclure
- Code/tests/workflows/docs PACK-PAX-03→10
- `src/product/`, `scripts/pax-visual-capture/`
- Captures `visual-after/PACK-PAX-07`…`10` (+ before si utile revue)
- Assets Pax utilisés (`logo-pax.webp`, jpg fond si référencé)

### Launcher — proposer d’exclure / reporter
- `ui/src/assets/pax/background-accueil.png` (~5,2 Mo) si jpg/webp suffit
- ZIP captures optionnels si PNG+manifest suffisent
- Artefacts `ui/dist/`, `dist-desktop/` (générés)
- Clés / lockfiles (inchangés — ne pas toucher)

### Message proposé (Launcher)
```
chore: consolidate Pax baseline WIP through PACK-PAX-10 for review

Preserve fail-closed network, Pax Windows identity, UI rebrand captures,
and local validation evidence without enabling product network or packaging.
```

### Pack Manager — inclure
- `docs/pax-baseline/*` (03, 03.1, CURRENT_STATE, README)
- `tsconfig.origin.json` (source héritée omise au 1er commit)

### Message proposé (Pack Manager)
```
docs: record Pax baseline notes and restore omitted origin tsconfig
```

## Limites encore ouvertes

- Electron chrome / coexistence Windows non qualifiés
- Installateur NSIS / signing / trust chain Pax
- Réseau réel, auth live, distribution origin Pax
- Minecraft / premier lancement joueur
- Assets Settings SweetCraft historiques encore sur disque (inventoriés)
