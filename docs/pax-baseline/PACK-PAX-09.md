# PACK-PAX-09 — Refonte Diagnostics et clôture visuelle

**Statut :** TERMINÉ
**Date :** 2026-10-01
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` — **aucun commit**
**WIP :** 03→09 préservé.

## Explication 237 → 236 (PACK-PAX-08)

| | |
|--|--|
| Cause | **1 `it()` retiré**, non regroupé |
| Fichier | `ui/src/app/features/settings/settings-visual.test.ts` |
| Test manquant | « dedicated Settings assets distinct from Home/Account heroes » |
| Pourquoi en 08 | Page Paramètres n’utilise plus le hero château → le test d’assets a été supprimé par erreur |
| Justification | **Injustifiée** : les WebP locaux restent dans `settings-assets.ts` / `assets/settings/` |
| Correctif 09 | Test **rétabli** (couverture assets unique/distincte) |

Compte (`account-visual.test.ts`) : toujours **5** `it` (contenu adapté, pas de perte nette).
Suite 09 : **240 PASS** (= 236 + 1 restauré + 3 nouveaux `diagnostics-presentation.test.ts`).

## Changements

### Fixture chemin
- `DevLauncherDesktopGateway.devInstancePath` : `C:\Dev\SweetCraft` → **`C:\Dev\PaxCraft`** (fictif Dev uniquement).
- Aucun chemin réel transformé.

### Diagnostics (présentation)
- Tokens/espacements alignés Compte/Paramètres ; pleine largeur.
- En-tête compact + sous-titre assistance.
- 3 cartes d’état (installation / compte / lancement) depuis le **store live** ; libellés FR + codes techniques.
- Support + copie diagnostics conservés ; DTO techniques inchangés dans la section repliable.
- « Informations techniques » : versions, build, plateforme, support id — ouverte par défaut.
- « Outils de développement » : harnesses regroupés, **repliés par défaut** ; garde `showDevTools()` métier inchangée ; flags `SWEETCRAFT_*` non renommés.

## Validation

| Check | Résultat |
| --- | --- |
| Tests UI | **240 PASS** |
| `ng build` development | **PASS** |
| Electron / réseau produit | Non lancés |

## Captures

`docs/pax-baseline/visual-after/PACK-PAX-09/` — **7/7 CAPTURED**
Séries 07 / 07.1 / 08 **préservées**. Isolation `?capture=` maintenue.

| Scène | Contenu |
| --- | --- |
| 01 diagnostics-top | États + support |
| 02 technical-open | Infos techniques |
| 03–04 devtools | Outils Dev ouverts / bas |
| 05 settings-path | `C:\Dev\PaxCraft` |
| 06 home-ready | Non-contamination |
| 07 diagnostics-narrow | 1100×700 |

PNG + manifest + planche + `captures-pax09.zip`.

## Limites

- Captures = renderer navigateur hermétique.
- `chooseLocation` Dev peut encore proposer `D:\Games\SweetCraft` (hors chemin `devInstancePath` corrigé).
- Variables techniques `SWEETCRAFT_*` volontairement inchangées.

## Fichiers principaux

- `ui/src/app/core/desktop-api/dev.gateway.ts`
- `ui/src/app/features/diagnostics/diagnostics.page.ts`
- `ui/src/app/features/diagnostics/diagnostics-presentation.ts` (+ test)
- `ui/src/app/features/settings/settings-visual.test.ts`
- `ui/src/assets/i18n/fr.json`
- `ui/package.json` (script test)
- `scripts/pax-visual-capture/capture-cdp.mjs`
- `docs/pax-baseline/visual-after/PACK-PAX-09/**`
- `docs/pax-baseline/PACK-PAX-09.md`, `CURRENT_STATE.md`
