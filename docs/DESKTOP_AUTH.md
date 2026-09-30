# Desktop Auth (0.6B)

Version **0.6.0-beta.5**

## Trust flow

```
Angular (AuthActionsService / AppStore)
  → typed LauncherDesktopGateway
Preload (explicit auth.* + onAuthStateChanged / onAuthProgress)
  → validated IPC (assertTrustedIpcSender)
Electron Main (AuthDesktopService)
  → AuthBackendPort (real frozen auth | FakeAuthBackend | EmptyAuthBackend)
Frozen auth 0.4 (signInInteractively / restoreAuthSession / logoutAccount)
```

Renderer never receives tokens. OAuth browser opening is owned by frozen Main/backend only.

## Fake auth harness (beta.3)

Requires **both**:

- `app.isPackaged === false`
- `SWEETCRAFT_DESKTOP_AUTH_FAKE=1` (or `true`)

Persists only fake account markers under `userData/dev-fake-auth/` (atomic JSON).
Never writes to AccountRegistry / DPAPI.

Reset: `pnpm desktop:fake-auth:reset`

Dev fixture IPC `sc:dev:auth:setFixture` is registered **only** when the harness is active.

## Session model (beta.2)

- `selectedAccountId` — UI / intended selection (not session proof)
- `authenticatedAccountId` — account whose session was actually validated
- `select(B)` never authenticates B; if B ≠ authenticated → `SIGNED_OUT`, then explicit `restore(B)`
- Auth mutex ops: `select` | `restore` | `login` | `logout`
- Post-auth `listAccounts` refresh is best-effort (`AUTH_ACCOUNT_METADATA_WARNING`); does not fail login/restore

## Dev server

Default: `http://127.0.0.1:4201/` (`DESKTOP_DEV_UI_PORT`).

## AppID blocker

`MINECRAFT_APP_NOT_AUTHORIZED` → specific French UX. External blocker unchanged.

## Live gate

Interactive login still requires `SWEETCRAFT_ALLOW_LIVE_AUTH=1` (+ client id) via frozen config.
