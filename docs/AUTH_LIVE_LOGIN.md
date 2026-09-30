# Auth Live Login — Lot 0.4B

Version **0.5.0-alpha.1**

## Auth status (external)

```
AUTH STATUS: BLOCKED_EXTERNAL_APPID_APPROVAL
```

Minecraft Services still refuses the SweetCraft App Registration (`MINECRAFT_APP_NOT_AUTHORIZED`).
This does **not** block install / update / repair (Lot 0.5A).

## Pipeline

```
System browser
  → Microsoft Authorization Code + PKCE S256
  → Loopback http://localhost:{port}/
  → Token exchange (public client, no secret)
  → Xbox Live → XSTS → Minecraft Services
  → Entitlements → Profile → LaunchIdentity
  → Secure refresh persistence (Windows DPAPI) when available
```

## Commands (offline by default)

Live network is **opt-in**:

```powershell
$env:SWEETCRAFT_MICROSOFT_CLIENT_ID = '<PUBLIC CLIENT ID UUID>'
$env:SWEETCRAFT_ALLOW_LIVE_AUTH = '1'
pnpm launcher:auth-login -- --live
```

Without `--live` / `SWEETCRAFT_ALLOW_LIVE_AUTH=1` → `LIVE_AUTH_NOT_ENABLED`.

Also: `auth-status`, `auth-logout -- --account <id>`.

## Redirect URI

Strategy: bind `127.0.0.1` ephemeral port; `redirect_uri` = `http://localhost:{port}/`.

**IPv4 vs localhost:** the HTTP server listens on **127.0.0.1** only (never `0.0.0.0` / `::`).
The authorize/token `redirect_uri` uses the hostname `localhost` to match Entra’s native
registration `http://localhost`. If the OS resolves `localhost` to `::1` first, the browser
may fail to reach the IPv4 listener — symptoms: callback never arrives / wait timeout.

Diagnostics: use `pnpm launcher:auth-login -- --live --diag` (prints redirect base **without** query).
Do not bind `::` or change Entra automatically; if needed after first live test, register an
explicit `http://127.0.0.1` redirect via Microsoft’s documented flow.

## System browser (Windows)

Opens via `rundll32.exe url.dll,FileProtocolHandler <https-url>` — **no cmd.exe**, no PowerShell,
`shell:false`, URL as a separate argv element.

## Authority

`https://login.microsoftonline.com/consumers` — personal Microsoft accounts (Xbox / Minecraft).

## Scopes

| Scope | Why |
|-------|-----|
| `XboxLive.signin` | Microsoft token for Xbox Live → Minecraft Services |
| `offline_access` | Durable refresh token |

No `openid` / Microsoft Graph scopes. No ID token required.

## Minecraft Services 403 (safe)

If Xbox/XSTS succeed but `login_with_xbox` returns 403 with Invalid app registration,
CLI reports `MINECRAFT_APP_NOT_AUTHORIZED` + `minecraftReason: INVALID_APP_REGISTRATION`
(not a bad player password). Fix the Entra app / API permissions — do not add
`ensureLegacyEnabled` as a workaround.

## Secure persistence

Windows: DPAPI CurrentUser via PowerShell helper (**secrets on stdin only**, never argv).
Other OS: `AUTH_SECURE_STORAGE_UNAVAILABLE` — session may work in-memory; **no plaintext disk write**.

## Unverified publisher

First consent may show Microsoft “unverified publisher” warnings. Do not bypass.
Publisher verification is out of scope for this lot.
