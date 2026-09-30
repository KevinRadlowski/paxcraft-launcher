# PACK-10.1G.6.2E — Lifecycle commit + clean package gate

**Date:** 2026-09-18  
**STARTING_HEAD:** `aa484f7e60dce8c0d432ef47d91e9b44f7f8b93a`  
**FINAL_HEAD / commit:** `aeb32b35051f1a2798c5d83ea090470270053b27`  
**Message:** `fix(ui): converge terminal install progress state`  
**NO PUSH**

## Diff classification (pre-commit)

| Class | Paths | Action |
|-------|-------|--------|
| A lifecycle fix | `app.store.ts`, `install-progress-readiness.ts` | committed |
| B lifecycle tests | `install-progress-busy.test.ts`, `install-ux.test.ts`, `ui/package.json` | committed |
| C generated/transient | `src/build.generated.ts`, `desktop/shared/build.generated.ts` | restored then regen; not staged |
| D local audit | `docs/audits/**` | preserved untracked |
| E G.6.2A test infra | `tests/desktop/ipc-security.test.ts` | committed (justified) |
| F unrelated | none | — |

## ipc-security verdict: INCLUDE (safe)

- G.6.2A (`aa484f7`) added `node:fs` in `install-progress-ui.test.ts` and `progress-bar.contract.test.ts`.
- Without excluding `*.test.ts`, desktop security static check false-fails on harness-only imports.
- Production `ui/src` non-test scan: **zero** forbidden `node:fs` / `child_process` / `ipcRenderer`.
- Walk still covers all production `.ts`/`.html` under `ui/src`.

## Package

- Setup: `release/SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe`
- SHA256: `69A2298755243734DEAFAD4F80BCD79F69061F203DB776C53E8D0EC49EB38634`
- app.asar SHA256: `FDA51145E65EE5FCCA2F6E4C293020FC5FFFFCEEE7F8B19ED71AE6E5E954B405`
- buildId: `0.6.0-rc.18@aeb32b35051f` dirty=false
- Authenticode: NotSigned (internal)

## Engines

Migration + progress aggregator: zero diff vs parent commit.
