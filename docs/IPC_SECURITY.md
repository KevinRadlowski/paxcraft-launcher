# IPC Security (0.6A / 0.6B — 0.6.0-beta.5)

## Principles

1. Renderer is untrusted
2. Explicit channels only — never `invoke(command, args)`
3. Runtime validation at Main boundary
4. Responses normalized to safe DTOs (**no tokens**)
5. `IpcResult` envelope; preload unwraps
6. Every privileged IPC call: `assertTrustedIpcSender`

## Auth channels (0.6B)

| Channel | Purpose |
|---------|---------|
| `sc:accounts:list` | Safe account metadata |
| `sc:accounts:select` | Select account |
| `sc:auth:getState` | AuthStateDto |
| `sc:auth:restore` | Cold restore (no browser) |
| `sc:auth:login` | Interactive login (user-only) |
| `sc:auth:logout` | Logout |

Events (normalized before `webContents.send`):

- `sc:event:authStateChanged`
- `sc:event:authProgress`

Preload exposes **explicit** listeners only (`onAuthStateChanged`, `onAuthProgress`, `onNotification`) — no arbitrary channel subscription.

Login payloads must be empty: no `clientId` / `scopes` / `authorizationUrl` from the renderer.

See `docs/DESKTOP_AUTH.md`.
