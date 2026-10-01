# PACK-PAX-03.1 — Restauration CI de validation / clôture des 4 échecs

**Date UTC :** 2026-09-30
**HEAD inchangé :** `33499137b02a3057f3891b978a8b484f06d44c57` (aucun commit dans ce lot)
**Origine YAML :** reconstruite depuis `docs/CI.md` (PACK-10), scripts `package.json` et contrats de tests — **archives `.github` / `docs.zip` absentes**.

## Préflight WIP (préservé)

Conservé depuis PACK-PAX-03 : `build.generated.ts` (×2), `CURRENT_STATE.md`, `README.md`, `PACK-PAX-03.md`.
Ajouts 03.1 : `.github/workflows/*`, `docs/CI.md`, tests contrats, `PACK-PAX-03.1.md`.

## Workflows créés

| Fichier | Déclencheur | Rôle effectif |
|---------|-------------|----------------|
| `ci-pr.yml` | `pull_request` → `main` | Validation Windows |
| `ci-main.yml` | `push` → `main` | Validation Windows |
| `player-release.yml` | `workflow_dispatch` seul | Qualification **préparatoire** manuelle (chemin conservé) |

Politique commune : `windows-latest`, Node 22, pnpm **9.15.0**, install frozen root+UI, `version:check` → **Build** → **Full test suite** → desktop shared + UI builds, `permissions.contents: read`, `SWEETCRAFT_LAUNCHER_DATA_DIR` temp runner.
**Pas** de secrets, package NSIS, smoke Electron, GitHub Release, `contents` write, CDN/VPS.

## Assertions tests — conservées / modifiées

| Garantie | Décision |
|----------|----------|
| Ordre `Build` avant `Full test suite` (3 YAML) | **KEEP** |
| `package.json` `--publish never` + `publish: null` | **KEEP** (produit ; packaging futur) |
| Pas de signing / OIDC / azure / CSC_ | **KEEP** |
| `workflow_dispatch` + pas de `pull_request` sur player-release | **KEEP** |
| Environment name `player-release` | **KEEP** (barrière manuelle, sans write) |
| Draft softprops Release / tag path / `desktop:package` dans YAML | **REPLACE** → absence de publication auto + packaging **différé** (politique Pax 03.1) |
| Attache setup `SweetCraft Launcher-*-setup.exe` | **REMOVE** (distribution reportée) |

Changement documenté dans en-têtes des tests et `docs/CI.md`. Couverture non baissée silencieusement : nouvelles assertions anti-publish / anti-package / `contents: read`.

## Résultats validation

| Suite | Pass/Fail/Skip | Durée | Log |
|-------|----------------|-------|-----|
| Contrats CI (2 fichiers) | **8 / 0 / 0** | ~0,1 s | `logs/test-ci-contracts-031.log` |
| `pnpm test` moteur+desktop | **745 / 0 / 0** | ~14 s total | `logs/test-launcher-031.log` |
| `desktop:ui:test` (atteint via `&&`) | **237 / 0 / 0** | inclus | idem |

**Conclusion des 4 échecs PACK-PAX-03 :** résolus — cause = YAML absents ; workflows Pax + contrats adaptés.
Les 4 fails n’étaient **pas** des régressions métier.

## NON VALIDÉS (rappel)

- Exécution réelle GitHub Actions
- Packaging NSIS / renderer-smoke / auth live / équivalence runtime joueur
- Identity / isolation data (prochain lot envisagé)

## Diff scope

Modifiés/créés : workflows, 2 tests contrats, `docs/CI.md`, docs pax-baseline.
**Inchangés :** lockfiles, versions, clés, code produit métier, data pack. WIP préexistant conservé.
