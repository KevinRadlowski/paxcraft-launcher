# PACK-PAX-05 — Configuration réseau Pax et blocage des destinations historiques

**Date UTC :** 2026-09-30
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` (aucun commit)
**Cible :** PaxCraft-Launcher uniquement (Pack Manager lecture seule)

## Objectif atteint

Fail-closed : réseau produit désactivé par défaut ; aucune origine de distribution, adresse serveur ni liens communautaires/support ; **aucun fallback opérationnel** vers les constantes SweetCraft.

## Configuration ajoutée

| Élément | Valeur défaut |
|---------|----------------|
| `networkEnabled` | `false` |
| `distributionOrigin` | `null` |
| `serverAddress` | `null` |
| `communityWebsiteUrl` / `supportUrl` | `null` |
| Module | `src/product/paxNetworkConfig.ts` |
| Codes | `NETWORK_NOT_CONFIGURED`, `DISTRIBUTION_NOT_CONFIGURED`, `HISTORICAL_DESTINATION_BLOCKED` |

Activation partielle (`networkEnabled=true` sans origin) **refusée**. Harness `*.example.test` / loopback uniquement hors packaged production.

## Gates (avant effet réseau)

| Déclencheur | Comportement |
|-------------|--------------|
| install / update / repair / play resolve | `requireConfiguredDistributionOrigin` — pas de `DEFAULT_PRODUCT_BASE` |
| status (observation) | local sans HTTP si origin absent ; finding `DISTRIBUTION_NOT_CONFIGURED` |
| CLI `--origin` | historique refusé ; pas de fallback CDN |
| Desktop install/play | `loadDefaultProductBase` → `null` (plus de CDN SweetCraft) |
| Auth live / `DefaultSystemBrowser` | gate avant navigateur ; Fake/execFile harness OK |
| Server status | pas de ping si non configuré → `UNKNOWN` + `not-configured` (≠ faux OFFLINE) |
| `openExternal` | `EXTERNAL_URL_RULES = []` |
| `FetchHttpClient` | hôtes historiques refusés (URL + redirects) |
| First-run `servers.dat` | liste vide (plus de seed `sweetcraft.datho.st`) |

### Destinations historiques contrôlées (liste de contrôle, ≠ politique d’activation Pax)

`cdn.xnosweet.fr`, `www.xnosweet.fr`, `xnosweet.fr`, `xbase.fr`, `www.xbase.fr`, `sweetcraft.datho.st` — hostname exact, credentials, redirects.

## Limites restantes

- Endpoints / trust chain / infra Pax : **UNKNOWN** (non inventés).
- Mojang / Fabric / Adoptium / Microsoft OAuth hosts : non listés comme produit Pax ; live OAuth encore gated par réseau off.
- PASS mocks ≠ preuve d’absence de trafic sur un runtime Windows réel.
- **Aucun lancement** Electron/Minecraft dans ce lot.

## Validation

| Suite | Pass/Fail | Log |
|-------|-----------|-----|
| Ciblés gates | PASS | `logs/test-pax05-targeted.log` (itération) |
| `pnpm test` moteur/Desktop | **760/0** | `logs/test-launcher-pax05-final.log` |
| UI | **237/0** | idem |
| `tsc` moteur + `desktop:shared:build` | PASS | `logs/build-pax05-*.log` |
| Pack Manager | non rejoué | — |

Skip : 0. Accès externe : aucun.

## Fichiers principaux

- `src/product/paxNetworkConfig.ts` (nouveau)
- `src/application/orchestrator/{execute,status}.ts`, `src/application/play/orchestrator.ts`
- `src/distribution/{urls,http}/index.ts`, `src/cli/main.ts`, `src/auth/browser.ts`
- `desktop/shared/{trust-policy,product,contract}.ts`
- `desktop/main/{server-status,install,play,auth,shared/live-runtime-sources}*`
- `ui/.../product-links.ts`, home/settings/account pages + status service
- `tests/product/pax-network-config.test.ts` + adaptations contrats

## WIP conservé

HEAD inchangé. WIP 03/03.1/04 + modifications 05 **non commités**. Remotes/tags : 0.

## Suite

Décision suivante : DA/branding **ou** préparation infrastructure Pax.
**Activation réseau uniquement** après qualification de la configuration et de la trust chain.
