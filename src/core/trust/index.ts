import { readFileSync } from "node:fs";
import { ErrorCode, LauncherError } from "../errors/index.js";

const PUBLIC_KEY_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/i;
const PEM_BEGIN = "-----BEGIN PUBLIC KEY-----";
const PEM_END = "-----END PUBLIC KEY-----";

export interface TrustedKeyStore {
  getPublicKeyPem(publicKeyId: string): string | undefined;
  has(publicKeyId: string): boolean;
  listIds(): readonly string[];
}

export function assertValidPublicKeyId(publicKeyId: string): void {
  if (!PUBLIC_KEY_ID_RE.test(publicKeyId)) {
    throw new LauncherError(ErrorCode.UNKNOWN_SIGNING_KEY, `malformed publicKeyId: ${publicKeyId}`, {
      publicKeyId
    });
  }
}

function assertSpkiPem(publicKeyId: string, pem: string): void {
  const trimmed = pem.trim();
  if (!trimmed.includes(PEM_BEGIN) || !trimmed.includes(PEM_END)) {
    throw new LauncherError(ErrorCode.UNKNOWN_SIGNING_KEY, `trusted key ${publicKeyId} is not a SPKI PUBLIC KEY PEM`, {
      publicKeyId
    });
  }
  if (trimmed.includes("PRIVATE KEY")) {
    throw new LauncherError(ErrorCode.UNKNOWN_SIGNING_KEY, `refusing private key material for ${publicKeyId}`, {
      publicKeyId
    });
  }
}

export class MapTrustedKeyStore implements TrustedKeyStore {
  private readonly keys: Map<string, string>;

  constructor(entries: Record<string, string | null | undefined> = {}) {
    this.keys = new Map();
    for (const [id, pem] of Object.entries(entries)) {
      assertValidPublicKeyId(id);
      if (pem === null || pem === undefined || pem.trim() === "") {
        // Placeholder slot reserved (e.g. sweetcraft-release-2026-01) — fail closed at lookup.
        continue;
      }
      assertSpkiPem(id, pem);
      this.keys.set(id, pem.trim() + (pem.trim().endsWith("\n") ? "" : "\n"));
    }
  }

  getPublicKeyPem(publicKeyId: string): string | undefined {
    return this.keys.get(publicKeyId);
  }

  has(publicKeyId: string): boolean {
    return this.keys.has(publicKeyId);
  }

  listIds(): readonly string[] {
    return [...this.keys.keys()];
  }

  /** Resolve a key or throw UNKNOWN_SIGNING_KEY (fail closed). */
  requirePublicKeyPem(publicKeyId: string): string {
    if (!publicKeyId) {
      throw new LauncherError(ErrorCode.UNKNOWN_SIGNING_KEY, "missing publicKeyId");
    }
    assertValidPublicKeyId(publicKeyId);
    const pem = this.getPublicKeyPem(publicKeyId);
    if (!pem) {
      throw new LauncherError(ErrorCode.UNKNOWN_SIGNING_KEY, `unknown or unset signing key: ${publicKeyId}`, {
        publicKeyId
      });
    }
    return pem;
  }
}

interface TrustedKeysFile {
  keys?: Record<string, string | null | undefined>;
}

/** Load public keys from config/trusted-keys.json (or equivalent). */
export function loadTrustedKeyStoreFromFile(filePath: string): MapTrustedKeyStore {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (e) {
    throw new LauncherError(ErrorCode.INTERNAL_ERROR, `cannot read trusted keys file: ${filePath}`, {
      filePath,
      cause: e instanceof Error ? e.message : String(e)
    });
  }
  let parsed: TrustedKeysFile;
  try {
    parsed = JSON.parse(raw) as TrustedKeysFile;
  } catch (e) {
    throw new LauncherError(ErrorCode.INTERNAL_ERROR, `invalid trusted keys JSON: ${filePath}`, {
      filePath,
      cause: e instanceof Error ? e.message : String(e)
    });
  }
  return new MapTrustedKeyStore(parsed.keys ?? {});
}

/** Production key id reserved for the SweetCraft release signing key (PEM filled later). */
export const PRODUCTION_RELEASE_KEY_ID = "sweetcraft-release-2026-01";
