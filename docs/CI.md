# Continuous Integration â€” Pax Horizon (PACK-PAX-03.1)

Document de politique **effective** pour les copies Pax.
Les YAML SweetCraft historiques nâ€™Ã©taient pas disponibles localement ; les workflows ont Ã©tÃ© **reconstruits** depuis ce document (Ã©tat PACK-10), les scripts `package.json` et les contrats de tests PACK-12B / PACK-12G.1, puis adaptÃ©s Ã  la politique provisoire Pax (validation sans distribution).

## Triggers

| Workflow | File | Event | RÃ´le |
|----------|------|--------|------|
| CI PR | `.github/workflows/ci-pr.yml` | `pull_request` â†’ `main` | Validation |
| CI Main | `.github/workflows/ci-main.yml` | `push` â†’ `main` | Validation |
| Player Qualification (prep) | `.github/workflows/player-release.yml` | `workflow_dispatch` **uniquement** | Qualification prÃ©paratoire manuelle |

`pull_request_target` is **not** used.
**Pas** de dÃ©clencheur `push.tags` / crÃ©ation de GitHub Release (y compris draft) dans ce lot.

Le chemin `player-release.yml` est **conservÃ©** pour continuitÃ© des contrats de tests ; le nom affichÃ© GitHub est `Player Qualification (prep, no release)`. Ce nâ€™est **pas** un pipeline de distribution.

## Runner / toolchain

- Runner: `windows-latest`
- Node: `22` (`actions/setup-node`)
- pnpm: `9.15.0` (alignÃ© sur `packageManager` du launcher ; lâ€™hÃ´te local peut diffÃ©rer, ex. 9.15.9)
- Install: `pnpm install --frozen-lockfile` (root) + `pnpm --dir ui install --frozen-lockfile`
- Cache: store pnpm via `setup-node` `cache: pnpm`

## Gates communs (PR / Main / Qualification prep)

1. `pnpm version:check` (provenance rafraÃ®chie depuis HEAD selon scripts rÃ©els)
2. **Build** â€” `pnpm build` (`dist/**` avant tests qui en dÃ©pendent)
3. **Full test suite** â€” `pnpm test` (moteur + Desktop + UI via script historique)
4. `pnpm desktop:shared:build`
5. `pnpm desktop:ui:build`

Ordre contractuel : step name `Build` **avant** step name `Full test suite` (PACK-12G.1).

Isolation tests CI : `PAXCRAFT_LAUNCHER_DATA_DIR` â†’ `${{ runner.temp }}/pax-launcher-data`.

## Explicitement hors scope (PACK-PAX-03.1)

- `pnpm desktop:package` / NSIS / `desktop:package:renderer-smoke`
- Upload dâ€™artefacts Actions de setup joueur
- GitHub Releases / tags / `softprops/action-gh-release`
- Windows code signing / Trusted Signing / OIDC
- DÃ©ploiement / CDN / VPS / secrets SweetCraft
- Gate `SWEETCRAFT_REQUIRE_LEGAL_IDENTITY` (reportÃ©e)

Le produit conserve `desktop:package:builder --publish never` et `electron-builder.yml` `publish: null` pour le **futur** lot packaging â€” non exÃ©cutÃ©s ici.

## Permissions

Tous les workflows :

```yaml
permissions:
  contents: read
```

Pas de `contents: write`. Pas de secrets. Pas de `id-token: write`.

Environment GitHub `player-release` : utilisÃ© uniquement comme barriÃ¨re manuelle sur le workflow de qualification prep (pas dâ€™Ã©criture release).

## Note

Un test local de structure YAML **ne prouve pas** lâ€™exÃ©cution rÃ©elle sur GitHub Actions.
