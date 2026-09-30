# Auth Architecture — Lot 0.4B

Version **0.4.0-beta.1**

## Pipeline

```
Microsoft OAuth (public client + PKCE S256) via system browser
  → loopback http://localhost:{port}/
  → Microsoft access (+ refresh)
  → Xbox Live
  → XSTS (rp://api.minecraftservices.com/)
  → Minecraft Services login_with_xbox
  → entitlements (mcstore) — ownership required
  → Minecraft profile
  → LaunchIdentity (Launch Engine 0.3B)
  → DPAPI refresh persistence (Windows) / fail-closed otherwise
```

## Modules

```
src/auth/
  config, launcherConfig, pkce, clock, redaction, browser, interactive
  oauth/{flow,exchange,callback}
  http/transport
  xbox/
  minecraft/{services,uuid}
  secureStore/{types,windowsDpapi,backedStore}
  accountsFile, bridge, session, store, account, state, pipeline
```

## Persistence principle

- Refresh token → secure store only (Windows DPAPI)
- Access / Xbox / XSTS / Minecraft tokens → volatile / re-derived
- Account metadata → `state/accounts.json` (non-sensitive)
- No offline / cracked fallback
