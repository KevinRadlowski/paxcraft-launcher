# Download Engine

## Composants

- `DownloadRequest` — URL HTTPS, sha256, size, maxBytes, timeout
- `ByteSource` — abstraction stream (`FetchByteSource`, `MockByteSource`)
- `DownloadEngine` — stream → fichier `.part`, hash pendant le flux, verify, expose temp validé
- `ProviderResolver` — résout l’URL **exacte** du manifest (jamais « latest »)

## Timeout end-to-end (0.2.1)

Le timeout couvre **toute** la durée :

connexion → headers → redirects → **lecture complète du body**

Un serveur `200` qui envoie un premier chunk puis bloque finit en `HTTP_TIMEOUT`.
Le timer et les listeners sont libérés uniquement à la fin (succès/échec) du stream.
Le `.part` est toujours nettoyé en cas d’échec.

## Abort utilisateur

`AbortSignal` externe → `DOWNLOAD_ABORTED` (distinct du timeout).
Aucun retry après abort utilisateur.

## Redirects

- `redirect: "manual"`
- Max : `MAX_DOWNLOAD_REDIRECTS` (5)
- HTTPS → HTTPS uniquement
- HTTPS → HTTP → `UNSAFE_REDIRECT`
- Boucle / trop de hops → `TOO_MANY_REDIRECTS`

## Retry HTTP (explicite)

Retry automatique uniquement pour :

- `NETWORK_ERROR`
- `HTTP_TIMEOUT`
- HTTP **408, 429, 500, 502, 503, 504**

**Pas** de retry : 400, 401, 403, 404, 405, 410, hash/size mismatch, abort, redirects unsafe/trop nombreux.

## Content-Length

Uniquement entier fini `>= 0` sûr. Sinon ignoré (le compteur stream reste autoritaire) — ne contourne jamais `maxBytes`.

## Fichiers `.part`

`{id}.{pid}.{Date.now()}.{uuid}.part` — unicité même pour téléchargements parallèles du même id.

## Providers

| Famille | Source de vérité |
|---------|------------------|
| modrinth / curseforge / github-releases | `provider.url` du manifest trusted |
| CDN configs / resource packs | `productBase/releases/<packVersion>/files/<path>` |

HTTPS obligatoire. SHA-256 obligatoire avant installation.

## Configs sans size

`expectedSize = -1` → vérif hash uniquement.

## Windows

Rename/replace via `replaceFile`. `FILE_LOCKED` sur EBUSY/EPERM.
