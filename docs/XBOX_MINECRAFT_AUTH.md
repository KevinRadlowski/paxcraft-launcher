# Xbox / Minecraft Auth

## Xbox Live

`POST user.auth.xboxlive.com/user/authenticate` with RPS ticket `d=<ms_access_token>`.  
Extract `userHash` (`uhs`) from `DisplayClaims.xui[0]`. Missing → fail closed.

## XSTS

`POST xsts.auth.xboxlive.com/xsts/authorize` for `rp://api.minecraftservices.com/`.  
`userHash` must match Xbox Live. Map known `XErr` to eligibility codes (no raw technical UI dump).

## Minecraft Services

1. `login_with_xbox` with `XBL3.0 x=<uhs>;<xsts>`  
2. `entitlements/mcstore` — `ownsMinecraftJava` required (`MINECRAFT_NOT_OWNED` otherwise)  
3. `minecraft/profile` — id + name  

### Safe HTTP error classification (0.4.0-beta.4)

Non-2xx from `login_with_xbox` is classified via `classifyMinecraftServiceError` / `minecraftLoginHttpError`.  
Only allowlisted `minecraftReason` values leave the parser — never `errorMessage`, `path`, raw `details`, or bodies.

| Detection | `minecraftReason` | ErrorCode |
|-----------|-------------------|-----------|
| Known “Invalid app registration…” (in controlled fields) | `INVALID_APP_REGISTRATION` | `MINECRAFT_APP_NOT_AUTHORIZED` |
| `details.reason == ACCOUNT_SUSPENDED` | `ACCOUNT_SUSPENDED` | `MINECRAFT_ACCOUNT_SUSPENDED` |
| Other JSON / HTML / unknown | `UNKNOWN` | `INVALID_MINECRAFT_AUTH` |

Player-account outcomes stay distinct from app registration:

- `MINECRAFT_ACCOUNT_SUSPENDED` — account policy
- `MINECRAFT_NOT_OWNED` — entitlements (after successful login)
- `INVALID_MINECRAFT_PROFILE` — profile missing/invalid

CLI safe shape example:

```json
{
  "error": "MINECRAFT_APP_NOT_AUTHORIZED",
  "status": 403,
  "minecraftReason": "INVALID_APP_REGISTRATION"
}
```

### `ensureLegacyEnabled` decision

Request body is **only** `{ identityToken }`. We do **not** send `ensureLegacyEnabled: true`.

That flag does not fix `INVALID_APP_REGISTRATION` (clientId / Entra app restriction against Minecraft Services). Adding it as a blind 403 workaround would obscure the real cause and is explicitly rejected for this lot.

## UUID

`normalizeMinecraftUuid()` → RFC hyphenated form for `LaunchIdentity`.

## Bridge

`createLaunchIdentityFromMinecraftSession()` — **Minecraft** access token becomes `auth_access_token`.  
Never use Microsoft access token for launch.
