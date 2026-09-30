# PACK-12D.1 — Safe HUMAN E2E preparation

**Date:** 2026-09-20  
**STATUS:** PASS (packaging + isolation protocol) · HUMAN E2E **FULL PASS** (see PACK-12D.2)  
**HEAD:** `5938ab3897249fe6ee13d8c3b15fbd252cd05f49`  
**origin/main:** `aeb32b35051f1a2798c5d83ea090470270053b27` (ahead 3)  
**NO COMMIT / PUSH / TAG / RELEASE / PUBLISH / DEPLOY**

## Isolation findings

| Layer | Behavior | Implication |
|-------|----------|-------------|
| NSIS `appId` | `fr.xbase.sweetcraft.launcher` unique | Une entrée désinstall HKCU par compte |
| `perMachine` | `false` | Registry/uninstall = **par utilisateur Windows** |
| `deleteAppDataOnUninstall` | `false` | AppData survit à uninstall |
| Install dir custom | Autorisé | **N’isole pas** produit Windows ni AppData |
| Electron `userData` | `%APPDATA%\SweetCraft Launcher` (productName) | Indépendant du dossier d’install |
| `--user-data-dir` | Utilisé par pack07 smoke | Isole runtime seulement ; **pas** setup/uninstall |
| AppUserModelID | `fr.xbase.sweetcraft.launcher` | Identité shell Windows unique |

### Compte Windows jetable vs VM

- **Compte local jetable** (`perMachine: false`) : isole AppData + HKCU uninstall → **suffisant** pour A–E **si** aucun setup n’est lancé sous le profil Kevin.
- **Dossiers `_e2e-12d\install-*` seuls** : **insuffisant** (même produit / même AppData du compte courant).
- **VM + snapshot** : recommandé si compte jetable impossible / doute.

Verdict : isolation filesystem ≠ isolation NSIS/registry. Checklist corrigée exige compte jetable **ou** VM.

## Previous setup

| Field | Value |
|-------|-------|
| Role | PREVIOUS (same SemVer, older build) |
| Path | `_e2e-12d/setups/PREVIOUS-0.6.0-rc.18@62e18bdef8b2-win-x64-setup.exe` |
| buildId | `0.6.0-rc.18@62e18bdef8b2` |
| buildCommit | `62e18bdef8b22a8f001d2c04980b815f5027bb58` |
| size | 86561662 |
| sha256 | `44ab8ded8013a0dc06885891910b808c1e0deb520e2a6dd6c5056962461fa577` |
| Note | Preserved **before** overwrite by CURRENT package. rc.17 ≠ previous for scenario B. |

## Current setup (HEAD 5938ab3)

| Field | Value |
|-------|-------|
| Path (release) | `SweetCraft-Launcher/release/SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` |
| Path (E2E copy) | `_e2e-12d/setups/CURRENT-0.6.0-rc.18@5938ab389724-win-x64-setup.exe` |
| sizeBytes | `86561570` |
| sha256 | `73cde6863a48d36e80cb3eb2971a6cdf919a9b06554341b818d3d3fdd37d9d13` |
| buildCommit | `5938ab3897249fe6ee13d8c3b15fbd252cd05f49` |
| buildId | `0.6.0-rc.18@5938ab389724` |
| dirty | `false` |
| CompanyName (exe) | `SweetCraft / XBASE` |
| Authenticode | NotSigned (exe + setup) |
| asar provenance | matches buildId / commit / dirty=false |
| pack07 smoke | **PASS** |
| manifest independent SHA/size | **match** |

## Corrected checklist

`docs/audits/PACK-12D.1-human-upgrade-uninstall-e2e.md`  
(Supersedes unsafe assumptions in PACK-12D checklist.)

## Short HUMAN procedure

Voir section « Ordre d’exécution » du checklist 12D.1 + résumé ci-dessous dans le rapport utilisateur.

## HUMAN closure

Exécuté sur `kevin\sweetcraft-e2e`. Record: `PACK-12D.2-human-e2e-closure.md` — A–E + diagnostics **PASS**.

## Ops

No push/tag/release/publish/deploy from packaging lots. WIP audits preserved.
