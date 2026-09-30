# Desktop Architecture (0.6A)

Version **0.6.0-alpha.3**

## Trust boundary

```
Electron Main  →  typed IPC (IpcResult + validated)  →  Preload (contextBridge)  →  Angular Renderer
```

Renderer is **untrusted**:
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- no `fs` / `child_process` / raw `ipcRenderer`

API surface: `window.sweetcraft` only (frozen).

Central `RendererTrustPolicy` owns load target, navigation, and IPC sender URL trust.

## Layout

```
desktop/
  shared/     IPC contract + validators + trust-policy
  main/       BrowserWindow, lifecycle, IPC handlers
  preload/    contextBridge (CJS) — unwraps IpcResult
ui/           Angular renderer (hash routing)
src/          frozen launcher backend (unchanged by UI)
```

## Window

- Default 1280×800, min 1100×700
- Frameless custom title bar
- Single-instance lock; second instance focuses existing window

## Navigation / external URLs

- `will-navigate` + `setWindowOpenHandler` deny arbitrary navigation
- Production: only trusted `index.html` + assets under its directory (no arbitrary `file:`)
- Dev: only exact configured Angular origin
- `shell.openExternal` only for structured HTTPS rules (`EXTERNAL_URL_RULES`)
- Allowlisted URLs never become BrowserWindow navigation
- OAuth browser remains backend/auth controlled (unchanged in 0.6A)

## CSP

- Tied to trust policy target (packaged file = always production CSP)
- Production: strict `script-src 'self'`; `style-src` keeps `'unsafe-inline'` for Angular component styles
- Dev-server: HMR exceptions for that origin only

## Dev commands

```
pnpm desktop:dev     # Angular serve + Electron against localhost
pnpm desktop:build   # UI + desktop shared
pnpm desktop:test    # desktop trust / IPC unit tests
```
