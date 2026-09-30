import {
  assertSha256Hex,
  buildReleaseSigningPayload,
  RELEASE_SIGNING_PAYLOAD_ID,
  sha256Hex,
  verifyEd25519Pem
} from "../crypto/index.js";
import { ErrorCode, LauncherError } from "../errors/index.js";
import { assertSafeReleaseArtefactPath } from "../paths/index.js";
import type { MapTrustedKeyStore } from "../trust/index.js";
import type { VerifiedChannel } from "../channel/index.js";

export const RELEASE_SCHEMA_VERSION = 2;
export const RELEASE_FILES_BASE = "files/";
export const CATALOG_SCHEMA_VERSION = 2;
export const MANIFEST_SCHEMA_VERSION = 6;
export const MANIFEST_SCHEMA_VERSION_LEGACY = 5;

export interface ReleaseArtefactRef {
  path: string;
  sha256: string;
}

export interface ReleaseSignatureBlock {
  status: "signed" | "unsigned-dev";
  algorithm: "ed25519";
  publicKeyId: string | null;
  payload: typeof RELEASE_SIGNING_PAYLOAD_ID;
  value: string | null;
  signer?: string;
}

export interface ReleaseDoc {
  schemaVersion: typeof RELEASE_SCHEMA_VERSION;
  product: "SweetCraft";
  packVersion: string;
  minecraft: string;
  fabricLoader: string;
  server: string;
  createdAt?: string;
  packManagerVersion: string;
  catalogSchemaVersion: number;
  manifestSchemaVersion: number;
  configBase: typeof RELEASE_FILES_BASE;
  antiRollback: {
    packVersion?: string;
    releaseSequence: number | null;
    note?: string;
  };
  artefacts: {
    clientManifest: ReleaseArtefactRef;
    serverManifest: ReleaseArtefactRef;
    checksums: ReleaseArtefactRef;
  };
  signature: ReleaseSignatureBlock;
}

export interface VerifiedRelease {
  readonly trusted: true;
  readonly release: ReleaseDoc;
  readonly releaseBytesSha256: string;
  readonly publicKeyId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArtefact(raw: unknown, expectedBasename: string, field: string): ReleaseArtefactRef {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, `missing artefact ${field}`);
  }
  if (typeof raw.path !== "string") {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, `artefact ${field}.path missing`);
  }
  assertSafeReleaseArtefactPath(raw.path, expectedBasename);
  return {
    path: raw.path,
    sha256: assertSha256Hex(raw.sha256, `${field}.sha256`)
  };
}

export function parseReleaseJson(raw: unknown): ReleaseDoc {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "release must be a JSON object");
  }
  if (raw.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    throw new LauncherError(ErrorCode.UNSUPPORTED_SCHEMA, "unsupported release schemaVersion", {
      schemaVersion: raw.schemaVersion,
      expected: RELEASE_SCHEMA_VERSION
    });
  }
  if (raw.product !== "SweetCraft") {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, `unexpected product`, { product: raw.product });
  }
  for (const field of ["packVersion", "minecraft", "fabricLoader", "server", "packManagerVersion"] as const) {
    if (typeof raw[field] !== "string" || !raw[field]) {
      throw new LauncherError(ErrorCode.INVALID_RELEASE, `${field} missing`);
    }
  }
  if (typeof raw.catalogSchemaVersion !== "number" || !Number.isInteger(raw.catalogSchemaVersion)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "catalogSchemaVersion invalid");
  }
  if (typeof raw.manifestSchemaVersion !== "number" || !Number.isInteger(raw.manifestSchemaVersion)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "manifestSchemaVersion invalid");
  }
  if (
    raw.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION &&
    raw.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION_LEGACY
  ) {
    throw new LauncherError(ErrorCode.UNSUPPORTED_SCHEMA, "unsupported manifestSchemaVersion on release", {
      manifestSchemaVersion: raw.manifestSchemaVersion
    });
  }
  if (raw.configBase !== RELEASE_FILES_BASE) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, `configBase must be ${RELEASE_FILES_BASE}`, {
      configBase: raw.configBase
    });
  }
  if (!isPlainObject(raw.antiRollback)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "antiRollback missing");
  }
  const seq = raw.antiRollback.releaseSequence;
  if (seq !== null && (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "antiRollback.releaseSequence invalid", { seq });
  }
  if (!isPlainObject(raw.artefacts)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "artefacts missing");
  }
  if (!isPlainObject(raw.signature)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "signature missing");
  }
  const sig = raw.signature;
  if (sig.status !== "signed" && sig.status !== "unsigned-dev") {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "invalid signature.status");
  }
  if (sig.algorithm !== "ed25519") {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "unsupported signature.algorithm");
  }
  if (sig.payload !== RELEASE_SIGNING_PAYLOAD_ID) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "unexpected signature.payload");
  }

  const release: ReleaseDoc = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    product: "SweetCraft",
    packVersion: raw.packVersion as string,
    minecraft: raw.minecraft as string,
    fabricLoader: raw.fabricLoader as string,
    server: raw.server as string,
    packManagerVersion: raw.packManagerVersion as string,
    catalogSchemaVersion: raw.catalogSchemaVersion,
    manifestSchemaVersion: raw.manifestSchemaVersion,
    configBase: RELEASE_FILES_BASE,
    antiRollback: {
      releaseSequence: seq as number | null
    },
    artefacts: {
      clientManifest: parseArtefact(raw.artefacts.clientManifest, "client-manifest.json", "clientManifest"),
      serverManifest: parseArtefact(raw.artefacts.serverManifest, "server-manifest.json", "serverManifest"),
      checksums: parseArtefact(raw.artefacts.checksums, "checksums.json", "checksums")
    },
    signature: {
      status: sig.status,
      algorithm: "ed25519",
      publicKeyId: typeof sig.publicKeyId === "string" ? sig.publicKeyId : null,
      payload: RELEASE_SIGNING_PAYLOAD_ID,
      value: typeof sig.value === "string" ? sig.value : null
    }
  };

  if (typeof raw.createdAt === "string") {
    release.createdAt = raw.createdAt;
  }
  if (typeof raw.antiRollback.packVersion === "string") {
    release.antiRollback.packVersion = raw.antiRollback.packVersion;
  }
  if (typeof raw.antiRollback.note === "string") {
    release.antiRollback.note = raw.antiRollback.note;
  }
  if (typeof sig.signer === "string") {
    release.signature.signer = sig.signer;
  }

  return release;
}

export function parseReleaseBytes(bytes: Buffer | string): ReleaseDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof bytes === "string" ? bytes : bytes.toString("utf8"));
  } catch (e) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, "release JSON parse failed", {
      cause: e instanceof Error ? e.message : String(e)
    });
  }
  return parseReleaseJson(parsed);
}

export function assertReleaseBytesHash(bytes: Buffer, expectedSha256: string): string {
  const actual = sha256Hex(bytes);
  const expected = expectedSha256.toLowerCase();
  if (actual !== expected) {
    throw new LauncherError(ErrorCode.RELEASE_HASH_MISMATCH, "release.json SHA-256 mismatch", {
      expected,
      actual
    });
  }
  return actual;
}

/** Trusted verification: only `signature.status === "signed"` may proceed. */
export function verifyReleaseSignature(
  release: ReleaseDoc,
  trust: MapTrustedKeyStore
): { publicKeyId: string } {
  const sig = release.signature;

  if (sig.status !== "signed") {
    throw new LauncherError(ErrorCode.UNSIGNED_REFUSED, "release signature.status must be signed", {
      status: sig.status
    });
  }
  if (!sig.publicKeyId) {
    throw new LauncherError(ErrorCode.UNKNOWN_SIGNING_KEY, "release publicKeyId missing");
  }
  if (!sig.value) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE_SIGNATURE, "release signature.value missing");
  }

  const pem = trust.requirePublicKeyPem(sig.publicKeyId);
  const payload = buildReleaseSigningPayload({
    product: release.product,
    packVersion: release.packVersion,
    minecraft: release.minecraft,
    fabricLoader: release.fabricLoader,
    server: release.server,
    packManagerVersion: release.packManagerVersion,
    catalogSchemaVersion: release.catalogSchemaVersion,
    manifestSchemaVersion: release.manifestSchemaVersion,
    releaseSchemaVersion: release.schemaVersion,
    configBase: release.configBase,
    releaseSequence: release.antiRollback.releaseSequence,
    clientManifestSha256: release.artefacts.clientManifest.sha256,
    serverManifestSha256: release.artefacts.serverManifest.sha256,
    checksumsSha256: release.artefacts.checksums.sha256
  });

  if (!verifyEd25519Pem(pem, payload, sig.value)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE_SIGNATURE, "release Ed25519 signature verification failed", {
      publicKeyId: sig.publicKeyId
    });
  }

  return { publicKeyId: sig.publicKeyId };
}

/** Enforce channel ↔ release consistency after both are parsed/hashed. */
export function assertChannelReleaseConsistency(channel: VerifiedChannel, release: ReleaseDoc, releaseSha256: string): void {
  const d = channel.descriptor;
  if (d.packVersion !== release.packVersion) {
    throw new LauncherError(ErrorCode.CHANNEL_RELEASE_MISMATCH, "packVersion channel/release mismatch", {
      channel: d.packVersion,
      release: release.packVersion
    });
  }
  if (d.releaseSequence !== release.antiRollback.releaseSequence) {
    throw new LauncherError(ErrorCode.CHANNEL_RELEASE_MISMATCH, "releaseSequence channel/release mismatch", {
      channel: d.releaseSequence,
      release: release.antiRollback.releaseSequence
    });
  }
  if (d.releaseSha256 !== releaseSha256.toLowerCase()) {
    throw new LauncherError(ErrorCode.RELEASE_HASH_MISMATCH, "channel.releaseSha256 != computed release hash", {
      channel: d.releaseSha256,
      actual: releaseSha256.toLowerCase()
    });
  }
}
