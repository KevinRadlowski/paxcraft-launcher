import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify as cryptoVerify
} from "node:crypto";
import { ErrorCode, LauncherError } from "../errors/index.js";

export const RELEASE_SIGNING_PAYLOAD_ID = "SWEETCRAFT-RELEASE-SIGNATURE-V1";
export const CHANNEL_SIGNING_PAYLOAD_ID = "SWEETCRAFT-CHANNEL-SIGNATURE-V1";

export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export function sha256Hex(bytes: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertSha256Hex(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value.toLowerCase())) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, `invalid ${field} sha256`, { field, value });
  }
  return value.toLowerCase();
}

function assertScalar(name: string, value: string): void {
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, `signing field ${name} contains forbidden control characters`, {
      field: name
    });
  }
}

function line(key: string, value: string): string {
  assertScalar(key, value);
  return `${key}=${value}`;
}

export interface ChannelSigningFields {
  channel: string;
  packVersion: string;
  releaseSequence: number;
  releasePath: string;
  releaseSha256: string;
}

export interface ReleaseSigningFields {
  product: string;
  packVersion: string;
  minecraft: string;
  fabricLoader: string;
  server: string;
  packManagerVersion: string;
  catalogSchemaVersion: number;
  manifestSchemaVersion: number;
  releaseSchemaVersion: number;
  configBase: string;
  releaseSequence: number | null | undefined;
  clientManifestSha256: string;
  serverManifestSha256: string;
  checksumsSha256: string;
}

/** Exact SWEETCRAFT-CHANNEL-SIGNATURE-V1 bytes (UTF-8, LF, trailing LF). */
export function buildChannelSigningPayload(f: ChannelSigningFields): Buffer {
  if (!/^[1-9][0-9]*$/.test(String(f.releaseSequence))) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "channel releaseSequence must be a positive integer", {
      releaseSequence: f.releaseSequence
    });
  }
  const lines = [
    CHANNEL_SIGNING_PAYLOAD_ID,
    line("channel", f.channel),
    line("packVersion", f.packVersion),
    line("releaseSequence", String(f.releaseSequence)),
    line("releasePath", f.releasePath.replace(/\\/g, "/")),
    line("releaseSha256", f.releaseSha256.toLowerCase())
  ];
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

/** Exact SWEETCRAFT-RELEASE-SIGNATURE-V1 bytes (UTF-8, LF, trailing LF). */
export function buildReleaseSigningPayload(f: ReleaseSigningFields): Buffer {
  const seq =
    f.releaseSequence === null || f.releaseSequence === undefined ? "" : String(f.releaseSequence);
  if (seq !== "" && !/^[1-9][0-9]*$/.test(seq)) {
    throw new LauncherError(ErrorCode.INVALID_RELEASE, `releaseSequence must be empty or a positive integer`, {
      releaseSequence: f.releaseSequence
    });
  }
  const lines = [
    RELEASE_SIGNING_PAYLOAD_ID,
    line("product", f.product),
    line("packVersion", f.packVersion),
    line("minecraft", f.minecraft),
    line("fabricLoader", f.fabricLoader),
    line("server", f.server),
    line("packManagerVersion", f.packManagerVersion),
    line("catalogSchemaVersion", String(f.catalogSchemaVersion)),
    line("manifestSchemaVersion", String(f.manifestSchemaVersion)),
    line("releaseSchemaVersion", String(f.releaseSchemaVersion)),
    line("configBase", f.configBase),
    line("releaseSequence", seq),
    line("clientManifestSha256", f.clientManifestSha256.toLowerCase()),
    line("serverManifestSha256", f.serverManifestSha256.toLowerCase()),
    line("checksumsSha256", f.checksumsSha256.toLowerCase())
  ];
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

export function verifyEd25519Pem(publicKeyPem: string, payload: Buffer, signatureBase64: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(null, payload, key, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/** Ephemeral Ed25519 keypair for local fixtures/tests only. Never ship private keys. */
export function generateEphemeralEd25519Pem(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

export function signEd25519Pem(privateKeyPem: string, payload: Buffer): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, payload, key).toString("base64");
}
