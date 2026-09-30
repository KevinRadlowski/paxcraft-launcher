# Modèle de confiance

## Rôles

- **Pack Manager** détient les clés **privées** de signature (hors de ce dépôt).
- **Launcher** embarque uniquement des clés **publiques** de confiance.

## TrustedKeyStore

Abstraction : retrouver une PEM SPKI (`BEGIN PUBLIC KEY`) à partir de `publicKeyId`.

Fichier dédié : `config/trusted-keys.json`

```json
{
  "keys": {
    "sweetcraft-release-2026-01": null
  }
}
```

`null` = emplacement réservé. Remplacer par la PEM réelle depuis votre `trusted-keys.json` local. **Ne jamais inventer** la valeur PEM. **Jamais** de clé privée.

## Fail closed

| Situation | Code |
|-----------|------|
| `publicKeyId` inconnu / non renseigné | `UNKNOWN_SIGNING_KEY` |
| Signature invalide | `INVALID_CHANNEL_SIGNATURE` / `INVALID_RELEASE_SIGNATURE` |
| `unsigned-dev` / status ≠ `signed` | `UNSIGNED_REFUSED` (jamais de résultat trusted) |
| Hash incorrect | `RELEASE_HASH_MISMATCH` / `MANIFEST_HASH_MISMATCH` |

## Payloads signés (figés)

- Channel : `SWEETCRAFT-CHANNEL-SIGNATURE-V1`
- Release : `SWEETCRAFT-RELEASE-SIGNATURE-V1`
- Algorithme : Ed25519, signature en Base64
- Hashes dans payload : hex lowercase

## Interdits dans le Launcher

- Clés privées / secrets Pack Manager / SSH / credentials VPS
- Confiance avant validation crypto
- Exécution de contenu téléchargé (lot 0.1)
- `eval`, shell construit depuis le réseau
