# CURRENT_STATE — PaxCraft-Launcher

**Dernier lot :** PACK-PAX-11 (2026-10-01) — checkpoint Git **local**
**HEAD :** voir `git rev-parse HEAD` après commit 11 (parent baseline `33499137…`)
**Remotes / tags / push :** 0

## Identité / données

| | |
|--|--|
| Produit | `PaxCraft Launcher` |
| appId | `org.paxhorizon.paxcraft.launcher` |
| Data | `%APPDATA%\PaxCraft Launcher\launcher-data` / `paxcraft` |
| Version produit déclarée | **0.6.0-rc.18** (V1 non basculée) |

## Réseau

Fail-closed (`networkEnabled=false`, `liveAuthEnabled=false`).
Serveur Minecraft cible documenté : **`paxcraft.datho.st`** (non activé, non vérifié).

## Validation figée au checkpoint

| Suite | Compte (PACK-PAX-10) |
| --- | --- |
| Moteur/Desktop | **777 PASS** |
| UI | **240 PASS** |
| Builds | PASS |

## Provenance générée

`build.generated` dans le commit 11 pointe encore le parent `33499137…` + `DIRTY=true`. Régénérer dans un lot ultérieur — voir `PACK-PAX-11.md`.

## Exclusions conservées sur disque

- `ui/src/assets/pax/background-accueil.png`
- `*.zip` captures (gitignore)
- `docs/pax-baseline/logs/**` (gitignore)

## Suite

Remotes à configurer (infos manquantes). Qualification V1 (`1.0.0-rc.1` → `1.0.0`) hors ce lot.
