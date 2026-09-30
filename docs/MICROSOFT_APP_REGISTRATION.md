# Microsoft App Registration — SweetCraft Launcher

Version **0.4.0-beta.4**

## Current Entra configuration (documented, no secrets)

| Field | Value |
|-------|--------|
| Application name | SweetCraft Launcher |
| Type | Public / native desktop application |
| Supported accounts | Microsoft Entra multi-tenant + personal Microsoft accounts |
| Redirect URI | `http://localhost` (native/mobile & desktop) |
| Grant | Authorization Code + PKCE S256 |
| Client secret | **None** (public client) |

The real **Application (client) ID** is supplied locally via:

`SWEETCRAFT_MICROSOFT_CLIENT_ID`

Never commit the production client id as a “secret”; it is public but environment-specific.
Never create or embed a `client_secret`.

## Authority used by the launcher

`https://login.microsoftonline.com/consumers`

Personal Microsoft accounts for Xbox / Minecraft. Entra “Supported account types”
may remain multi-tenant + personal; the launcher targets the consumers endpoint
for this pipeline.

## Consent / unverified publisher

New registrations may show Microsoft consent screens for unverified publishers.
Do not attempt to bypass Microsoft protections. Publisher verification is a distribution concern before public release.

## Minecraft Services authorization

A successful Microsoft + Xbox + XSTS chain can still fail at `login_with_xbox` with
`MINECRAFT_APP_NOT_AUTHORIZED` when Minecraft Services rejects the app registration
(clientId). That is an **application** restriction, not invalid player credentials.
See `docs/XBOX_MINECRAFT_AUTH.md`.
