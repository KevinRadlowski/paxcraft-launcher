# PACK-PAX-05.1 — Fermeture des exceptions harness et activation partielle

**Date UTC :** 2026-10-01
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` (aucun commit)
**Cible :** PaxCraft-Launcher uniquement (Pack Manager hors modifications)

## Défauts confirmés (PACK-PAX-05) et corrections

| Constat | Statut avant | Correction |
|---------|--------------|------------|
| `requireConfiguredDistributionOrigin` acceptait `example.test`/loopback hors packaged sans preuve de transport injecté | **confirmé** | Harness = permit opaque (`WeakSet`) **et** `runtime.kind === "test-harness"` ; hostname seul insuffisant |
| `packagedProduction` omis ⇒ traité hors production | **confirmé** | Runtime omis/incorrect ⇒ **`packaged-production`** (fail closed) |
| `networkEnabled=true` ouvrait l’auth live | **confirmé** | Champ séparé `liveAuthEnabled` (défaut `false`) ; `assertPaxLiveAuthNetworkAllowed` l’exige |
| `setPaxNetworkConfigForTests` exporté depuis le module produit | **confirmé** | Writers déplacés vers `paxNetworkTestHooks.ts` ; entrypoints produit ne l’importent pas (test de garde) |
| `HISTORICAL_BLOCKED_HOSTS` Set mutable (`add`/`delete`) | **confirmé** | Liste privée + `Object.freeze` ; API `isHistoricalBlockedHost` / `listHistoricalBlockedHosts()` (copie gelée) |

Protections déjà présentes et conservées : parsers/signatures, refus credentials, redirects historiques dans `FetchHttpClient`, `EXTERNAL_URL_RULES` vide, first-run sans seed datho.st.

## Architecture retenue

- **Produit** (`paxNetworkConfig.ts`) : config lecture + gates ; pas de setter public.
- **Tests** (`paxNetworkTestHooks.ts`) : `createNetworkHarnessPermit`, set/reset config.
- **Deps** : `networkHarness` + `networkRuntime` sur orchestrator/play ; fixtures `testNetworkPolicy()` / `createOrchDeps`.
- **Transports réels** : `assertRealOutboundTransportAllowed()` — refuse toujours dans ce cycle ; le harness **ne se transfère pas** à `FetchHttpClient` / fetch auth réel.
- **Auth** : indépendante de la distribution (`liveAuthEnabled`) ; capacités futures documentées sans critères inventés.
- **serverAddress** : `parseProductServerAddress` — `host` ou `host:port` uniquement ; IPv6 / ambiguës refusés.

## Validation

| Suite | Pass/Fail/Skip | Log |
|-------|----------------|-----|
| Ciblés 05 / 05.1 | 29/0/0 | (tsx product) |
| moteur/Desktop | **778**/0/0 | `logs/test-launcher-pax051.log` |
| UI | **237**/0/0 | idem |
| builds `tsc` + desktop shared | PASS | `logs/build-pax051-*.log` |

Aucun accès réseau réel. Aucun lancement produit.

## Limites restantes

- Endpoints / trust / infra Pax : **UNKNOWN**.
- `assertRealOutboundTransportAllowed` refuse tout fetch réel jusqu’à un lot d’activation dédié (pas de critères prod inventés ici).
- Serveur loopback réel / socket de test : hors lot (autorisation distincte future).
- PASS hermétique ≠ qualification trafic Windows réel.
- Chemins clos = ceux inspectés + couverts par les tests ci-dessus.

## WIP

HEAD inchangé. WIP 03/03.1/04/05 + 05.1 **non commités**. Remotes/tags : 0.

## Suite

Pas d’activation réseau. Prochaine décision : DA/branding **ou** préparation infra Pax après qualification config + trust chain.
