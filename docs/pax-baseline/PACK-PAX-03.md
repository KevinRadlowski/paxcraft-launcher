# PACK-PAX-03 — Commit de baseline et validation technique

**Date UTC :** 2026-09-30
**Dépôt :** PaxCraft-Launcher
**HEAD baseline :** `33499137b02a3057f3891b978a8b484f06d44c57`
**Message :** `chore: establish inherited technical baseline for Pax Horizon`
**Remotes / tags / push :** aucun

Ce commit décrit une **base technique héritée** SweetCraft copiée localement. Ce n’est **ni** une release Pax, **ni** une preuve d’équivalence avec le commit SweetCraft canonique `c203dc0…`.

L’inventaire PACK-PAX-02 (`inventory-*.json`, `rc18-artefacts.json`) est **conservé comme snapshot daté** ; non réécrit comme état post-validation.

---

## 1. Premier commit — périmètre

| Métrique | Valeur |
|----------|--------|
| Fichiers suivis | 535 |
| Author effectif | Kevin Radlowski \<kevin.radlowski@gmail.com\> (config existante ; non inventée ; pas de `git config --global`) |
| Inclus | sources `src/` / `ui/` / `desktop/`, tests, fixtures, scripts, docs (dont `docs/pax-baseline/`), configs, lockfiles, `config/trusted-keys.json` (keyring **public**), build icons, NOTICE |
| Exclus via `.gitignore` | `node_modules/`, `dist*`, `release/`, logs, `tests/tmp/`, secrets (`*.pem` sauf trusted-keys public), etc. |
| Hors dépôt | helper `../_pax_inventory_tmp.py` |

**Générés historiques dans le commit :** `src/build.generated.ts` / `desktop/shared/build.generated.ts` portaient encore commit `62e18bde…` + `DIRTY=true` (snapshot périmé embarqué au commit de baseline).

---

## 2. Toolchain et dépendances

| Élément | Observé |
|---------|---------|
| Node | v24.19.0 |
| pnpm disponible | **9.15.9** seule (déclaration package.json `pnpm@9.15.0` **conservée**, écart rapporté) |
| Install | `pnpm install --offline --frozen-lockfile --ignore-scripts` puis `… --config.confirmModulesPurge=false` — **OK** cache (downloaded 0) pour root, `ui/`, |
| Lockfiles | **inchangés** vs HEAD |
| Electron binary | **non** téléchargé (`ignore-scripts` ; pas de `path.txt`) — **voulu** |

**Hooks lifecycle package.json :** aucun `preinstall`/`postinstall`/`prepare` déclaré.
**Hooks omis via `--ignore-scripts` :** scripts éventuels des dépendances (dont postinstall Electron pour binaire) — **conséquence :** pas de runtime Electron packagé ; **≠** qualification packaging.

Pas de `pnpm update` / audit fix. Pas de PASS basé sur d’anciens `node_modules` non réconciliés (réinstall cache confirmée).

---

## 3. Provenance et builds

| Commande | Outil | Résultat | Durée | Log |
|----------|-------|----------|-------|-----|
| `pnpm version:generate` | pnpm 9.15.9 / tsx | **PASS** — buildId `0.6.0-rc.18@33499137b02a`, dirty→écrit `DIRTY=false` | ~1,8 s | `docs/pax-baseline/logs/version-generate.log` |
| `pnpm version:check` | idem | **PASS** | ~1 s | `…/version-check.log` |
| `pnpm build` (moteur) | tsc | **PASS** | ~4,8 s | `…/build-engine.log` |
| `pnpm desktop:shared:build` | tsc + copy-preload | **PASS** | ~2,5 s | `…/desktop-shared-build.log` |
| `pnpm desktop:ui:build` | Angular 19 | **PASS** | ~33 s | `…/desktop-ui-build.log` |

SemVer héritée **0.6.0-rc.18** = version source historique, **pas** release Pax.

**Après generate :** working tree **modifié** (`src/build.generated.ts`, `desktop/shared/build.generated.ts`) vs baseline commit — **aucun second commit** (politique : provenance se rafraîchit ; dirty post-écriture documenté). Ne pas exiger artificiellement un arbre clean.

---

## 4. Tests

Isolation : `SWEETCRAFT_LAUNCHER_DATA_DIR` → `%TEMP%\pax-pax03-isolated-data` ; tests chemins produit **hermétiques** (`tests/instance/product-data-paths.test.ts`). Pas d’usage des vraies données `%APPDATA%\SweetCraft*`.

| Suite | Résultat | Pass/Fail/Skip | Durée | Log |
|-------|----------|----------------|-------|-----|
| `pnpm test` (moteur+desktop via `tests/**`) | **FAIL** (exit 1) | 741 / **4** / 0 | ~10 s | `…/test-launcher.log` |
| `pnpm desktop:ui:test` (rejeu : bloqué par `&&` du script `test`) | **PASS** | 237 / 0 / 0 | ~9,9 s | `…/test-ui.log` |

**4 échecs (compteur runner) — environnement / artefacts absents (`.github` non restauré), pas régression métier isolée :**

1. `tests/release/workflow-player-release.test.ts` — « PACK-12B player-release workflow » — ENOENT `player-release.yml`
2. `tests/workflows/player-release-order.test.ts` — « player-release builds before full tests » — ENOENT `player-release.yml`
3. idem — « ci-main and ci-pr keep the same build-before-test contract » — ENOENT `ci-main.yml`
4. idem — « player-release retains draft-only tag path… » (+ assertion packaging `--publish never` dans la même suite) — ENOENT `player-release.yml`

**Correctif proposé (non appliqué) :** restaurer ou réécrire les workflows sous `.github/workflows/` pour Pax, ou marquer ces tests comme skip tant que CI absente.

**NOT_RUN (volontaire) :** `desktop:package`, renderer-smoke packagé, Electron app launch, OAuth live, install/update CDN, `desktop:dev`.

Absence d’accès live ≠ validation fonctionnelle complète.

---

## 5. État Git final

- Branche `main` @ `33499137…`
- Modifiés non commités : 2× `build.generated.ts` (provenance rafraîchie)
- 0 remote, 0 tag, 0 push
- Lockfiles / trusted-keys / identité SweetCraft runtime : **préservés**

---

## 6. Prérequis prochain lot (identité / isolation)

Avant tout lancement Pax : nouvel appId/productName/data root ; couper soft-migrate legacy ; anti-rollback/DPAPI isolés ; ne pas pointer CDN/VPS SweetCraft pour Pax ; trust Pax ultérieure. Pas de rename dans ce lot.
