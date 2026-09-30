# PACK-10.1G.6.2D — Terminal progress busy convergence

**Date:** 2026-09-18  
**STARTING_HEAD / ENDING_HEAD:** `aa484f7e60dce8c0d432ef47d91e9b44f7f8b93a` (no commit)  
**Mode:** implement + validate only — NO COMMIT/PUSH/PACKAGE

## Contract

| Phase | Before | After |
|-------|--------|-------|
| Non-terminal (DOWNLOADING, …) | force `readiness=BUSY` | unchanged — BUSY |
| COMPLETED | force BUSY (sticky) | retain authoritative readiness; never invent READY |
| FAILED | force BUSY (sticky) | same; progress-only BUSY+IDLE → `UNKNOWN` |
| Authoritative status | source of truth after apply | unchanged |

## Settings post-move refresh

**Not added.** Central `setInstallProgress` semantics alone converge READY→COMPLETED and COMPLETED→READY without a redundant install refresh race.

## Supporting fix

`ipc-security` static walk excludes `*.test.ts` so Node test harness may use `node:fs` (G.6.2A residual) while production `ui/src` remains forbidden.

## Zero-diff proof

- `desktop/main/instance/**`, migration move engine: **empty git diff**
- `install-progress-aggregator.ts` / `install-progress.ts`: **empty git diff**
