# Architecture — SweetCraft Launcher 0.1

## Frontière produit

| Composant | Rôle |
|-----------|------|
| Pack Manager | Produit, signe, publie channel/release/manifests |
| Launcher | Télécharge, vérifie (hash + Ed25519), anti-rollback, (plus tard) installe |

Le Launcher **ne réinterprète pas** les schémas Pack Manager : il les consomme strictement.

## Arborescence

```
src/
  core/
    channel/     # schema 1 uniquement, parse, verify signature
    release/     # schema 2 uniquement, hash, verify signature, cohérence channel
    manifest/    # schema 5/6, configs, resource packs, policies
    crypto/      # payloads canoniques, Ed25519, SHA-256
    trust/       # TrustedKeyStore (clés publiques)
    errors/      # codes structurés
    paths/       # anti-traversal POSIX
    resolve/     # pipeline resolveLatestRelease (signed only)
  distribution/
    http/        # FetchHttpClient + MockHttpClient
    urls/        # construction HTTPS
  instance/
    state/       # anti-rollback persistant atomique
    paths/       # dossiers locaux launcher
  cli/           # outils de développement
```

## Pipeline de résolution

```
FETCH CHANNEL
→ PARSE + VALIDATE
→ VERIFY CHANNEL SIGNATURE (Ed25519)
→ ANTI-ROLLBACK CHECK
→ FETCH RELEASE
→ SHA-256(release bytes) == channel.releaseSha256
→ PARSE RELEASE
→ VERIFY RELEASE SIGNATURE
→ VERIFY CHANNEL/RELEASE CONSISTENCY
→ FETCH CLIENT MANIFEST
→ VERIFY MANIFEST HASH
→ PARSE + VALIDATE MANIFEST
→ TrustedResolvedRelease
```

Aucun objet n’est exposé comme `trusted: true` avant la fin de la chaîne.

## Lot 0.3A — Minecraft Runtime

```
src/minecraft/{metadata,version,libraries,rules,assets,natives,fabric,runtime,audit,integrity}
src/java/{discovery,requirements}
src/platform/
```

Séparation : RESOLUTION → PLAN → DOWNLOAD → INSTALL → AUDIT.
Download Engine 0.2.1 réutilisé (SHA-1 Mojang + SHA-256 SweetCraft).

**0.3.0-alpha.2** : metadata Mojang (version JSON, parents, asset index) vérifiées en SHA-1/size **sur bytes** avant `JSON.parse` (`FetchedMetadata`).

## Lot 0.3B — Launch Engine

```
src/launch/
  identity, features, memory, placeholders, arguments, classpath,
  spec, sanitize, readiness, prepare,
  process/{runner,lock}
```

`prepareLaunch` → `LaunchSpec` → `runPreparedLaunch` (`shell:false`). Docs : `LAUNCH_ENGINE.md`, `LAUNCH_ARGUMENTS.md`, `PROCESS_MODEL.md`.

## Lot 0.4A — Auth Core

```
src/auth/  # OAuth PKCE, Xbox, Minecraft Services, LaunchIdentity bridge
```

Docs : `AUTH_ARCHITECTURE.md`, `MICROSOFT_OAUTH.md`, `XBOX_MINECRAFT_AUTH.md`, `AUTH_SECURITY.md`.

## Lot 0.4B — Live login + Windows secure storage

```
src/auth/
  launcherConfig, browser, interactive
  secureStore/{types,windowsDpapi,backedStore}
  accountsFile
  oauth/callback (loopback dynamic localhost)
```

CLI : `auth-login` / `auth-status` / `auth-logout` (live gate).  
Docs : `AUTH_LIVE_LOGIN.md`, `WINDOWS_SECURE_STORAGE.md`, `MICROSOFT_APP_REGISTRATION.md`.
