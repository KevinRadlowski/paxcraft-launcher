# Microsoft OAuth

Version **0.4.0-beta.4**

## Public client only

SweetCraft Launcher is a distributed desktop app. **No `client_secret`**.

Flow: Authorization Code + **PKCE S256** only (never `plain`).

## Config

`MicrosoftOAuthConfig`: `clientId` (public UUID), endpoints, `redirectUri`, scopes.

Live client id: `SWEETCRAFT_MICROSOFT_CLIENT_ID` or `--client-id`.  
Fixtures use `FIXTURE_MS_CLIENT_ID` for offline tests only.

## Authority

`https://login.microsoftonline.com/consumers` — personal Microsoft accounts for the Xbox / Minecraft pipeline.

Authorize + token endpoints both use this authority (v2.0).

## Live redirect

`http://localhost:{ephemeralPort}/` (server binds `127.0.0.1`).  
Must match App Registration native redirect `http://localhost`.

Fixture/tests may still use `http://127.0.0.1:13245/callback`.

## Scopes

Exactly:

- `XboxLive.signin` — Microsoft access token for Xbox Live user authenticate  
- `offline_access` — refresh token for restore  

**Not** requested: `openid`, `profile`, `email`, `User.Read`, Graph scopes.  
No OIDC ID token is required by our pipeline.

Authorize sends these scopes. Code exchange does **not** re-send `scope`.  
Refresh sends the same Xbox scope set (never reintroduces `openid`).

## PKCE / state

- `code_verifier`: crypto random, never in URL, never logged  
- `code_challenge`: BASE64URL(SHA256(verifier)), method `S256`  
- `state`: crypto random  
- One-shot flow; expiry → `OAUTH_FLOW_EXPIRED`; reuse → `OAUTH_FLOW_ALREADY_CONSUMED`

## Token exchange / refresh

Form POST, **no client_secret**. Non-idempotent.  
Refresh rotates `refresh_token` when Microsoft returns a new one.

## Never log

authorization code, access token, refresh token, code_verifier, callback URL.
