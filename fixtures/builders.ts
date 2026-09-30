/**
 * Local fixture builders — ephemeral Ed25519 keys only. Never contact CDN.
 */
import {
  buildChannelSigningPayload,
  buildReleaseSigningPayload,
  CHANNEL_SIGNING_PAYLOAD_ID,
  RELEASE_SIGNING_PAYLOAD_ID,
  generateEphemeralEd25519Pem,
  sha256Hex,
  signEd25519Pem
} from "../src/core/crypto/index.js";
import type { ChannelDescriptor } from "../src/core/channel/index.js";
import type { ReleaseDoc } from "../src/core/release/index.js";
import type { ClientManifest } from "../src/core/manifest/index.js";
import { MapTrustedKeyStore } from "../src/core/trust/index.js";

export const TEST_KEY_ID = "test-release-key-001";

export function createTestKeyMaterial(): {
  publicKeyPem: string;
  privateKeyPem: string;
  trust: MapTrustedKeyStore;
  keyId: string;
} {
  const { publicKeyPem, privateKeyPem } = generateEphemeralEd25519Pem();
  const trust = new MapTrustedKeyStore({ [TEST_KEY_ID]: publicKeyPem });
  return { publicKeyPem, privateKeyPem, trust, keyId: TEST_KEY_ID };
}

export function buildMinimalClientManifest(overrides: Partial<ClientManifest> = {}): ClientManifest {
  const base: ClientManifest = {
    schemaVersion: 6,
    product: "SweetCraft",
    target: "client",
    packVersion: "0.1.2",
    minecraft: "26.1.2",
    fabricLoader: "0.19.3",
    server: "sweetcraft.example",
    configBase: "files/",
    generatedAt: "2026-09-07T00:00:00.000Z",
    mods: [
      {
        id: "examplemod",
        name: "Example Mod",
        version: "1.0.0",
        file: "examplemod-1.0.0.jar",
        size: 12,
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sha512: null,
        provider: { type: "modrinth", projectId: "abc", versionId: "def", url: "https://cdn.modrinth.com/data/x.jar" },
        distribution: "UPSTREAM_PREFERRED"
      }
    ],
    configs: [
      {
        path: "config/example.toml",
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        policy: "CLIENT_DEFAULT",
        apply: "if_missing",
        target: "CLIENT"
      }
    ],
    resourcePacks: [
      {
        id: "sweetcraft-fr",
        displayName: "SweetCraft FR",
        version: "1.0",
        targetPath: "resourcepacks/SweetCraft-FR-v1.0.zip",
        sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        size: 100,
        autoEnable: true
      }
    ]
  };
  return { ...base, ...overrides, mods: overrides.mods ?? base.mods, configs: overrides.configs ?? base.configs, resourcePacks: overrides.resourcePacks ?? base.resourcePacks };
}

export function buildLegacyV5Manifest(): ClientManifest {
  const m = buildMinimalClientManifest({ schemaVersion: 5 });
  // schema 5: omit resourcePacks in JSON; for typed object we keep [].
  return { ...m, schemaVersion: 5, resourcePacks: [] };
}

export function signReleaseDoc(
  privateKeyPem: string,
  keyId: string,
  partial: Omit<ReleaseDoc, "signature"> & { signature?: never }
): { release: ReleaseDoc; bytes: Buffer } {
  const unsigned: ReleaseDoc = {
    ...partial,
    signature: {
      status: "signed",
      algorithm: "ed25519",
      publicKeyId: keyId,
      payload: RELEASE_SIGNING_PAYLOAD_ID,
      value: null
    }
  };
  const payload = buildReleaseSigningPayload({
    product: unsigned.product,
    packVersion: unsigned.packVersion,
    minecraft: unsigned.minecraft,
    fabricLoader: unsigned.fabricLoader,
    server: unsigned.server,
    packManagerVersion: unsigned.packManagerVersion,
    catalogSchemaVersion: unsigned.catalogSchemaVersion,
    manifestSchemaVersion: unsigned.manifestSchemaVersion,
    releaseSchemaVersion: unsigned.schemaVersion,
    configBase: unsigned.configBase,
    releaseSequence: unsigned.antiRollback.releaseSequence,
    clientManifestSha256: unsigned.artefacts.clientManifest.sha256,
    serverManifestSha256: unsigned.artefacts.serverManifest.sha256,
    checksumsSha256: unsigned.artefacts.checksums.sha256
  });
  unsigned.signature.value = signEd25519Pem(privateKeyPem, payload);
  const bytes = Buffer.from(JSON.stringify(unsigned, null, 2) + "\n", "utf8");
  return { release: unsigned, bytes };
}

export function signChannel(
  privateKeyPem: string,
  keyId: string,
  fields: {
    channel: "dev" | "beta" | "stable";
    packVersion: string;
    releaseSequence: number;
    releasePath: string;
    releaseSha256: string;
  }
): { channel: ChannelDescriptor; bytes: Buffer } {
  const payload = buildChannelSigningPayload(fields);
  const channel: ChannelDescriptor = {
    schemaVersion: 1,
    channel: fields.channel,
    packVersion: fields.packVersion,
    releaseSequence: fields.releaseSequence,
    releasePath: fields.releasePath,
    releaseSha256: fields.releaseSha256.toLowerCase(),
    signature: {
      status: "signed",
      algorithm: "ed25519",
      publicKeyId: keyId,
      payload: CHANNEL_SIGNING_PAYLOAD_ID,
      value: signEd25519Pem(privateKeyPem, payload)
    }
  };
  const bytes = Buffer.from(JSON.stringify(channel, null, 2) + "\n", "utf8");
  return { channel, bytes };
}

export function buildSignedBundle(opts?: {
  releaseSequence?: number;
  packVersion?: string;
  tamperChannelAfterSign?: boolean;
  manifest?: ClientManifest;
  /** Reuse keys so remounted tips stay verifiable with the same trust store. */
  keys?: ReturnType<typeof createTestKeyMaterial>;
}) {
  const keys = opts?.keys ?? createTestKeyMaterial();
  const packVersion = opts?.packVersion ?? opts?.manifest?.packVersion ?? "0.1.2";
  const releaseSequence = opts?.releaseSequence ?? 3;
  const manifest: ClientManifest = {
    ...(opts?.manifest ?? buildMinimalClientManifest({ packVersion })),
    packVersion
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const serverManifestBytes = Buffer.from(
    JSON.stringify({ ...manifest, target: "server", resourcePacks: [] }, null, 2) + "\n",
    "utf8"
  );
  const checksumsBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, files: [] }, null, 2) + "\n", "utf8");

  const { release, bytes: releaseBytes } = signReleaseDoc(keys.privateKeyPem, keys.keyId, {
    schemaVersion: 2,
    product: "SweetCraft",
    packVersion,
    minecraft: manifest.minecraft,
    fabricLoader: manifest.fabricLoader,
    server: manifest.server,
    packManagerVersion: "0.9.1",
    catalogSchemaVersion: 2,
    manifestSchemaVersion: 6,
    configBase: "files/",
    antiRollback: { packVersion, releaseSequence },
    artefacts: {
      clientManifest: { path: "client-manifest.json", sha256: sha256Hex(manifestBytes) },
      serverManifest: { path: "server-manifest.json", sha256: sha256Hex(serverManifestBytes) },
      checksums: { path: "checksums.json", sha256: sha256Hex(checksumsBytes) }
    }
  });

  const releaseSha256 = sha256Hex(releaseBytes);
  let { channel, bytes: channelBytes } = signChannel(keys.privateKeyPem, keys.keyId, {
    channel: "dev",
    packVersion,
    releaseSequence,
    releasePath: `releases/${packVersion}/release.json`,
    releaseSha256
  });

  if (opts?.tamperChannelAfterSign) {
    // Keep structural validity; only change a signed field so crypto fails.
    const tampered = { ...channel, releaseSha256: "f".repeat(64) };
    channel = tampered as ChannelDescriptor;
    channelBytes = Buffer.from(JSON.stringify(tampered, null, 2) + "\n", "utf8");
  }

  return {
    ...keys,
    packVersion,
    releaseSequence,
    manifest,
    manifestBytes,
    serverManifestBytes,
    checksumsBytes,
    release,
    releaseBytes,
    releaseSha256,
    channel,
    channelBytes
  };
}

export { sha256Hex };
