# PACK-PAX-07.1 — Captures finitions

**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57`
**WIP :** WIP PACK-PAX-03..07.1 present (uncommitted). Captures reflect PACK-PAX-07.1 polish + isolated fixtures.

Isolation : rechargement SPA (`?capture=`) avant chaque scène. Préserver `PACK-PAX-07/`.

## Reproduction

1. `cd ui && pnpm exec ng serve --host 127.0.0.1 --port 4202`
2. `node scripts/pax-visual-capture/capture-cdp.mjs`
