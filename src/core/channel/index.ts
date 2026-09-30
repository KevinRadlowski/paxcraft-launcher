import {
  buildChannelSigningPayload,
  CHANNEL_SIGNING_PAYLOAD_ID,
  verifyEd25519Pem
} from "../crypto/index.js";
import { ErrorCode, LauncherError } from "../errors/index.js";
import { assertSafeReleasePath } from "../paths/index.js";
import type { MapTrustedKeyStore } from "../trust/index.js";

export const CHANNEL_SCHEMA_VERSION = 1;

export type ReleaseChannelName = "stable" | "beta" | "dev";

export interface ChannelSignatureBlock {
  status: "signed" | "unsigned-dev";
  algorithm: "ed25519";
  publicKeyId: string | null;
  payload: typeof CHANNEL_SIGNING_PAYLOAD_ID;
  value: string | null;
}

export interface ChannelDescriptor {
  schemaVersion: typeof CHANNEL_SCHEMA_VERSION;
  channel: ReleaseChannelName;
  packVersion: string;
  releaseSequence: number;
  releasePath: string;
  releaseSha256: string;
  signature: ChannelSignatureBlock;
}

export interface VerifiedChannel {
  readonly trusted: true;
  readonly descriptor: ChannelDescriptor;
  readonly publicKeyId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseChannelJson(raw: unknown): ChannelDescriptor {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "channel must be a JSON object");
  }
  if (raw.schemaVersion !== CHANNEL_SCHEMA_VERSION) {
    throw new LauncherError(ErrorCode.UNSUPPORTED_SCHEMA, `unsupported channel schemaVersion`, {
      schemaVersion: raw.schemaVersion,
      expected: CHANNEL_SCHEMA_VERSION
    });
  }
  const channel = raw.channel;
  if (channel !== "dev" && channel !== "beta" && channel !== "stable") {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, `unknown channel: ${String(channel)}`, { channel });
  }
  if (typeof raw.packVersion !== "string" || !raw.packVersion) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "packVersion missing");
  }
  if (typeof raw.releaseSequence !== "number" || !Number.isInteger(raw.releaseSequence) || raw.releaseSequence < 1) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, `invalid releaseSequence`, {
      releaseSequence: raw.releaseSequence
    });
  }
  if (typeof raw.releasePath !== "string") {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "releasePath missing");
  }
  assertSafeReleasePath(raw.releasePath, raw.packVersion);

  if (typeof raw.releaseSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(raw.releaseSha256)) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "invalid releaseSha256");
  }

  if (!isPlainObject(raw.signature)) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "signature block missing");
  }
  const sig = raw.signature;
  if (sig.status !== "signed" && sig.status !== "unsigned-dev") {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, `invalid signature.status`, { status: sig.status });
  }
  if (sig.algorithm !== "ed25519") {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, `unsupported signature.algorithm`, {
      algorithm: sig.algorithm
    });
  }
  if (sig.payload !== CHANNEL_SIGNING_PAYLOAD_ID) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, `unexpected signature.payload`, { payload: sig.payload });
  }

  return {
    schemaVersion: CHANNEL_SCHEMA_VERSION,
    channel,
    packVersion: raw.packVersion,
    releaseSequence: raw.releaseSequence,
    releasePath: raw.releasePath,
    releaseSha256: raw.releaseSha256.toLowerCase(),
    signature: {
      status: sig.status,
      algorithm: "ed25519",
      publicKeyId: typeof sig.publicKeyId === "string" ? sig.publicKeyId : null,
      payload: CHANNEL_SIGNING_PAYLOAD_ID,
      value: typeof sig.value === "string" ? sig.value : null
    }
  };
}

export function parseChannelBytes(bytes: Buffer | string): ChannelDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof bytes === "string" ? bytes : bytes.toString("utf8"));
  } catch (e) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "channel JSON parse failed", {
      cause: e instanceof Error ? e.message : String(e)
    });
  }
  return parseChannelJson(parsed);
}

/**
 * Cryptographically verify a channel descriptor. Nothing is trusted before this succeeds.
 * Only `signature.status === "signed"` may produce a VerifiedChannel.
 */
export function verifyChannelSignature(
  descriptor: ChannelDescriptor,
  trust: MapTrustedKeyStore
): VerifiedChannel {
  const sig = descriptor.signature;

  if (sig.status !== "signed") {
    throw new LauncherError(ErrorCode.UNSIGNED_REFUSED, "channel signature.status must be signed", {
      status: sig.status
    });
  }
  if (!sig.publicKeyId) {
    throw new LauncherError(ErrorCode.UNKNOWN_SIGNING_KEY, "channel publicKeyId missing");
  }
  if (!sig.value) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL_SIGNATURE, "channel signature.value missing");
  }

  const pem = trust.requirePublicKeyPem(sig.publicKeyId);
  const payload = buildChannelSigningPayload({
    channel: descriptor.channel,
    packVersion: descriptor.packVersion,
    releaseSequence: descriptor.releaseSequence,
    releasePath: descriptor.releasePath,
    releaseSha256: descriptor.releaseSha256
  });

  if (!verifyEd25519Pem(pem, payload, sig.value)) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL_SIGNATURE, "channel Ed25519 signature verification failed", {
      publicKeyId: sig.publicKeyId
    });
  }

  return {
    trusted: true,
    descriptor,
    publicKeyId: sig.publicKeyId
  };
}
