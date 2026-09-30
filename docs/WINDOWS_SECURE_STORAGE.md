# Windows Secure Storage — Lot 0.4B

Version **0.4.0-beta.2**

## What is stored

**Only** the Microsoft **refresh token**, under:

`{dataDir}/secure/ms-refresh/<base64url(accountId)>.dpapi`

Ciphertext = Windows **DPAPI** `ProtectedData` scope **CurrentUser**.

Not stored on disk: Microsoft access token, Xbox, XSTS, Minecraft access token.

## Why DPAPI (no npm native dependency)

- OS crypto (not home-grown)
- Bound to the Windows user profile
- No obscure N-API package / build toolchain for this lot
- Helper: fixed PowerShell script in **argv** (no secrets); payload base64 on **stdin**

## Forbidden

- `helper.exe --token SECRET`
- PowerShell `-Command` with interpolated tokens
- Plaintext JSON refresh tokens
- Secrets in process command line

## Crash-safety (rotation)

1. Refresh against Microsoft  
2. Receive optional new refresh token  
3. `SecureBackedAuthTokenStore.save` overwrites DPAPI blob for that `accountId`  
4. Only then session is considered durably rotated  

If process crashes after Microsoft rotation but before DPAPI write, the previous refresh may still be valid for one more attempt; if Microsoft invalidated the old token, user must re-auth (`AUTH_REAUTH_REQUIRED`).

## Availability

`WindowsDpapiSecureRefreshTokenStore.available` starts `true` on win32.
Optional `probe()` / first `save` is the truth — failure marks unavailable.
**Never** falls back to plaintext.

## Account metadata

Non-sensitive `accounts.json` under `{dataDir}/state/accounts.json` (atomic write).
No tokens.
