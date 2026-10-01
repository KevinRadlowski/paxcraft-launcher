# PACK-PAX-07 — Captures après rebranding shell/accueil

**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57`
**WIP :** WIP PACK-PAX-03..07 present (uncommitted). Captures reflect working tree after PACK-PAX-07 shell/home rebrand, not HEAD alone.

## Reproduction

1. `cd ui && pnpm exec ng serve --host 127.0.0.1 --port 4202`
2. `node scripts/pax-visual-capture/capture-cdp.mjs`

Chrome système + CDP. Viewport principal **1280×800** ; scène 12 en **1100×700**.

## Limites

Renderer navigateur ≠ Electron. Fixtures Dev. Avant : `docs/pax-baseline/visual-before/2026-10-01/`.
