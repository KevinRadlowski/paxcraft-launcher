# Auth Security

Version **0.4.0-beta.2**

## Forbidden

- `client_secret` in bundle  
- Microsoft password / ROPC / scraping login.live.com  
- plaintext refresh token on disk  
- home-grown crypto for token protection  
- tokens in logs / events / errors / CLI  
- OAuth without state or with PKCE `plain`  
- offline/cracked identity fallback  
- entitlement bypass  
- raw `error_description` / remote response bodies in diagnostics  
- raw OAuth callback URLs in errors or logs  
- copying external `Error.message` / `String(e)` / `stack` / `cause` into `LauncherError`  
- secrets in process argv / PowerShell interpolated commands  
- auth HTTP body serialization in any DEBUG logger  

## Live network gate

Unit tests stay offline. Live CLI requires `--live` and/or `SWEETCRAFT_ALLOW_LIVE_AUTH=1`.

## Exception boundary

External adapter exceptions → structured codes only (`NETWORK_ERROR` phases, `AUTH_SESSION_ERROR` `{ stage }`, etc.).

## AuthHttpRequest body — secret by default

NEVER LOG / NEVER SERIALIZE FOR DIAGNOSTICS / NEVER INCLUDE IN ERRORS.

Even with `DEBUG=*` / `NODE_DEBUG=*`, SweetCraft must not dump `AuthHttpRequest` bodies.

## Secure store (Windows)

DPAPI CurrentUser for refresh tokens only. See `WINDOWS_SECURE_STORAGE.md`.
If unavailable: `AUTH_SECURE_STORAGE_UNAVAILABLE` — no plaintext fallback.

## Loopback

- Bind **127.0.0.1** only  
- GET only → else 405  
- Host header allowlist  
- URL size limit  
- `Cache-Control: no-store`  
- HTML success/error pages contain **no** code/state/tokens  

## `safeAuthErrorDetails()`

Protects known structured fields. Does **not** sanitize arbitrary strings. Do not propagate external strings.
