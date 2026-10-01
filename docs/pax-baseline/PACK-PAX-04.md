# PACK-PAX-04 — Identité Windows et isolation des données

**Date UTC :** 2026-09-30
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` (aucun commit)
**Cible :** PaxCraft-Launcher uniquement (Pack Manager lecture seule)

## Valeurs appliquées (convention technique locale)

| Contrat | Valeur |
|---------|--------|
| productName / executableName / shortcuts / uninstallDisplayName | `PaxCraft Launcher` |
| appId / AppUserModelId | `org.paxhorizon.paxcraft.launcher` |
| userData | `%APPDATA%\PaxCraft Launcher` |
| data root | `…\launcher-data` |
| instance défaut | `…\instances\paxcraft` |
| env | `PAXCRAFT_LAUNCHER_DATA_DIR` |
| `deleteAppDataOnUninstall` | `false` (conservé) |
| PE CompanyName / copyright | `SweetCraft / XBASE` (droits historiques ; ≠ Authenticode) |
| SemVer | `0.6.0-rc.18` inchangée |

Pas d’URL/clé/client ID Microsoft inventés. Pas d’affirmation de propriété de domaine.

## Isolation

- `resolveLauncherDataRoot` : **plus** d’appel à la migration ; **plus** de legacy-fallback.
- `migrateLegacyLauncherDataIfNeeded` = **no-op**.
- `SWEETCRAFT_LAUNCHER_DATA_DIR` **ignorée** (pas d’alias).
- Refus des racines étrangères `SweetCraft Launcher` / `SweetCraftLauncher` (explicit, env, instance custom) avec résolution realpath/jonction quand testable.
- Settings IPC `sweetcraftInstancePath` **conservé** (contrat interne) mais stocké uniquement sous data root Pax.

## Contrats historiques laissés

`window.sweetcraft`, IPC/`@sweetcraft/*`, tokens CSS, output `sweetcraft-launcher-ui`, `.sweetcraft-managed-java.json`, protocol/trust/CDN SweetCraft, env auth/fake `SWEETCRAFT_*` hors data-dir, NOTICE.

## Preuve tests (isolation ≠ coexistence installateurs Windows)

| Suite | Pass/Fail | Log |
|-------|-----------|-----|
| Ciblés paths+identité | 21/0 | `logs/test-pax04-targeted.log` |
| `pnpm test` moteur/Desktop | **747/0** | `logs/test-launcher-pax04-final.log` |
| UI via `&&` | **237/0** | idem |
| builds `pnpm build` + `desktop:shared:build` | PASS | `logs/build-pax04*.log` |

Sentinelles SweetCraft inchangées dans fixtures temporaires ; aucune lecture des vraies données utilisateur.

## Limites

- Isolation **vérifiée par tests** ≠ qualification de deux installateurs Windows côte à côte.
- PASS ≠ droit de lancer le produit (endpoints CDN/auth encore hérités).
- Jonction : refus testé si `fs.symlinkSync(..., 'junction')` autorisé ; sinon skip soft.

## WIP préexistant préservé

Workflows 03.1, générés provenance, docs PACK-PAX-03/03.1, etc. toujours présents.

## Gates encore NON VALIDÉS

Package NSIS, smoke Windows, auth live, distribution Pax, rebranding UI/DA, coexistence installateurs E2E.
