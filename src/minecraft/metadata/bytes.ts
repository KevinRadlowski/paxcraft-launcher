import { createHash } from "node:crypto";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { sha1Integrity } from "../integrity/index.js";

/**
 * Opaque network result for small official JSON documents.
 *
 * Trust boundary for Mojang version/asset-index JSON:
 *   FETCH BYTES → VERIFY (sha1 / size) → JSON.parse → domain parse
 *
 * Never treat a pre-parsed `unknown` as verified when integrity must cover exact bytes.
 */
export interface FetchedMetadata {
  bytes: Uint8Array;
  contentType?: string;
  url?: string;
}

/** Default max size for Minecraft/Fabric metadata JSON fetches. */
export const DEFAULT_MINECRAFT_JSON_MAX_BYTES = 8 * 1024 * 1024;

export function assertMetadataByteLimit(
  bytes: Uint8Array,
  maxBytes: number = DEFAULT_MINECRAFT_JSON_MAX_BYTES
): void {
  if (bytes.byteLength > maxBytes) {
    throw new LauncherError(ErrorCode.METADATA_TOO_LARGE, "metadata JSON exceeds maxBytes", {
      size: bytes.byteLength,
      maxBytes
    });
  }
}

export function sha1HexOfBytes(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * Verify exact SHA-1 of metadata bytes against a manifest / ref digest.
 * Must run BEFORE JSON.parse for trusted Mojang documents.
 */
export function verifyMetadataSha1(bytes: Uint8Array, expectedSha1: string): void {
  const expected = sha1Integrity(expectedSha1).digest;
  const actual = sha1HexOfBytes(bytes);
  if (actual !== expected) {
    throw new LauncherError(
      ErrorCode.MINECRAFT_METADATA_HASH_MISMATCH,
      "Minecraft metadata SHA-1 mismatch",
      { expected, actual }
    );
  }
}

export function verifyMetadataSize(bytes: Uint8Array, expectedSize: number): void {
  if (bytes.byteLength !== expectedSize) {
    throw new LauncherError(ErrorCode.ASSET_INDEX_SIZE_MISMATCH, "metadata size mismatch", {
      expected: expectedSize,
      actual: bytes.byteLength
    });
  }
}

/**
 * Parse JSON from verified (or intentionally unverified, e.g. Fabric) bytes.
 * Enforces max size. Does not perform hash checks.
 */
export function parseJsonFromBytes(
  fetched: FetchedMetadata,
  maxBytes: number = DEFAULT_MINECRAFT_JSON_MAX_BYTES
): unknown {
  assertMetadataByteLimit(fetched.bytes, maxBytes);
  const text = Buffer.from(fetched.bytes).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "metadata JSON parse failed", {
      url: fetched.url,
      cause: e instanceof Error ? e.message : String(e)
    });
  }
}

/**
 * FETCH BYTES already done → VERIFY sha1 → PARSE JSON.
 * Used for version JSON listed in version_manifest_v2.
 */
export function loadSha1VerifiedJson(
  fetched: FetchedMetadata,
  expectedSha1: string,
  maxBytes: number = DEFAULT_MINECRAFT_JSON_MAX_BYTES
): unknown {
  assertMetadataByteLimit(fetched.bytes, maxBytes);
  verifyMetadataSha1(fetched.bytes, expectedSha1);
  return parseJsonFromBytes(fetched, maxBytes);
}

/**
 * Asset index: VERIFY size + sha1 before parse. Never feed objects to the plan from unverified JSON.
 */
export function loadVerifiedAssetIndexJson(
  fetched: FetchedMetadata,
  expected: { sha1: string; size: number },
  maxBytes: number = DEFAULT_MINECRAFT_JSON_MAX_BYTES
): unknown {
  assertMetadataByteLimit(fetched.bytes, maxBytes);
  verifyMetadataSize(fetched.bytes, expected.size);
  try {
    verifyMetadataSha1(fetched.bytes, expected.sha1);
  } catch (e) {
    if (LauncherError.isLauncherError(e) && e.code === ErrorCode.MINECRAFT_METADATA_HASH_MISMATCH) {
      throw new LauncherError(ErrorCode.ASSET_INDEX_HASH_MISMATCH, "asset index SHA-1 mismatch", e.details);
    }
    throw e;
  }
  try {
    return parseJsonFromBytes(fetched, maxBytes);
  } catch (e) {
    if (LauncherError.isLauncherError(e) && e.code === ErrorCode.INVALID_MINECRAFT_METADATA) {
      throw new LauncherError(ErrorCode.INVALID_ASSET_INDEX, "asset index JSON parse failed", e.details);
    }
    throw e;
  }
}

/** Require a manifest entry sha1 — official version_manifest_v2 always provides one. */
export function requireManifestEntrySha1(sha1: string | undefined, versionId: string): string {
  if (typeof sha1 !== "string" || sha1.length === 0) {
    throw new LauncherError(
      ErrorCode.MINECRAFT_METADATA_SHA1_MISSING,
      "version manifest entry missing sha1",
      { versionId }
    );
  }
  return sha1Integrity(sha1).digest;
}

/**
 * Finite non-negative safe integer (sizes, totalSize, java majorVersion).
 */
export function assertNonNegativeSafeInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `invalid numeric field: ${field}`, {
      field,
      value
    });
  }
  return value;
}

export function fetchedFromBuffer(
  bytes: Buffer | Uint8Array | string,
  url?: string
): FetchedMetadata {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  const out: FetchedMetadata = { bytes: buf instanceof Buffer ? new Uint8Array(buf) : buf };
  if (url !== undefined) out.url = url;
  return out;
}
