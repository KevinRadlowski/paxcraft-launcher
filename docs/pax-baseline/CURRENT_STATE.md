# CURRENT_STATE — PaxCraft-Launcher (PACK-PAX-02)

**Date UTC :** 2026-09-30 (lot PACK-PAX-02)  
**Rôle :** consommateur / vérificateur Electron + moteur TypeScript + renderer Angular (`ui/`).  
**Séparation :** distinct du Pack Manager (`../PaxCraft-PackManager-v0.1`) — producteur/signataire, dépôts Git indépendants.

## Baseline locale

- Inventaire source : `docs/pax-baseline/inventory-source.json` (596 fichiers utiles, SHA256 ; zips exclus du source → artefacts).
- Couverture : `docs/pax-baseline/inventory-coverage.json`.
- Artefacts historiques (séparés, non supprimés) : `docs/pax-baseline/inventory-artefacts.json`.
- RC18 setups : `docs/pax-baseline/rc18-artefacts.json`.
- Les fichiers `inventory-*.json` sont exclus du hash récursif lors de la génération.

## Références RC18 historiques ≠ Git Pax

| Élément | Statut |
|--------|--------|
| Tag / commit SweetCraft canoniques (ex. `v0.6.0-rc.18`, `c203dc0…`) | **Histoires fournies** — **non** attribués au dépôt Pax (pas de premier commit) |
| Binaire de référence 85 858 329 o / SHA256 `080047ec…524d` | **Correspondance binaire confirmée** pour `_pack12j-verify` et `_pack12i-draft` |
| `_pack12g-dispatch` (même taille) | SHA256 **différent** `17805095…dddd27` — pas le canonique |
| Setup top-level `SweetCraft Launcher-0.6.0-rc.18-…` | 85 858 584 o / `b25e4576…` — **non canonique** |
| Provenance des **sources** locales vs ce binaire | **UNKNOWN** (pas de `.git` SweetCraft restauré ; générés dirty) |

## Dépôt Git Pax (ce lot)

- `git init -b main` dans cette racine uniquement.
- **Aucun commit**, **aucun remote**, **aucun staging**.
- Pas de dépôt à la racine commune `LAUNCHER/`.
- `.gitignore` SweetCraft préservé + ajout minimal `tests/tmp/`.
- `.github` **non** restauré ; `docs.zip` **absent** du périmètre → contenu exact des workflows historiques **UNKNOWN** (voir `docs/CI.md` pour noms documentés seulement).

## Identité runtime

- Encore **SweetCraft** (appId, productName, APPDATA, CDN, IPC, npm names, etc.).
- Dossier `PaxCraft-Launcher` ≠ identité applicative migrée.
- **Aucune** migration/import implicite des données SweetCraft dans ce lot.
- **Aucun** usage du VPS/CDN SweetCraft pour Pax dans ce lot.
- Trust Pax indépendante : **à préparer ultérieurement**.
- Modpack : conservation des bytes hors scope code ; enveloppe signature Pax ultérieure.

## Générés périmés (non régénérés)

- `src/build.generated.ts` / `desktop/shared/build.generated.ts` : SemVer 0.6.0-rc.18, commit embarqué `62e18bde…`, **DIRTY=true**.
- Sans premier commit Pax, **aucune** provenance Git de build « clean » n’est établie — **ne pas** forcer un buildId clean maintenant.

## Outillage observé (hôte)

| Outil | Observé | Déclaré |
|-------|---------|---------|
| PowerShell | 5.1.26100.9444 | — |
| Git | 2.52.0.windows.1 | — |
| Node | v24.19.0 | `engines.node >= 22` |
| pnpm | 9.15.9 (`%AppData%\Roaming\npm\pnpm.ps1`, sans bootstrap réseau détecté) | root `pnpm@9.15.0` ; UI sans packageManager dédié dans le sondage |

## Non exécuté dans ce lot

Install dépendances, build, tests, package, lancement Electron/Minecraft, accès réseau prod.

## Blocages avant premier lancement Pax

- Isolation `appId` / `productName` / data root / DPAPI / anti-rollback (voir PACK-PAX-01).
- Soft-migrate legacy SweetCraft encore présent dans le code.
- Canal défaut `dev` + CDN SweetCraft.
- Identité distribution (`product: SweetCraft`, payloads/keyId SweetCraft).

## Prochaines étapes (proposition)

Lot de **validation dépendances / tests / build** (offline-first), sans rebranding : `pnpm install:all` → `version:check` (après premier commit si provenance requise) → build → tests ; packager plus tard. Voir rapport PACK-PAX-02.

## UNKNOWN

- Équivalence bit-à-bit sources ↔ commit RC18 canonique.
- Contenu exact des YAML `.github` historiques.
- Présence réelle de données `%APPDATA%\SweetCraft*` sur la machine hôte.
- Secrets hors arbre (PEM signing, SSH) — non inventoriés ici.
