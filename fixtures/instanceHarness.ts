import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { TrustedResolvedRelease } from "../src/core/resolve/index.js";
import type { ClientManifest } from "../src/core/manifest/index.js";
import type { ReleaseDoc } from "../src/core/release/index.js";
import type { VerifiedChannel } from "../src/core/channel/index.js";
import { MockByteSource } from "../src/download/engine/sources.js";

export function sha256Of(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface HarnessFiles {
  modBytes: Buffer;
  configBytes: Buffer;
  rpBytes: Buffer;
  modUrl: string;
  configUrl: string;
  rpUrl: string;
}

export function buildHarnessFiles(packVersion = "0.2.0"): HarnessFiles {
  const modBytes = Buffer.from("fake-mod-jar-bytes-v1");
  const configBytes = Buffer.from("key=value\n");
  const rpBytes = Buffer.from("PK\x03\x04fake-zip-bytes");
  return {
    modBytes,
    configBytes,
    rpBytes,
    modUrl: "https://cdn.modrinth.example/data/examplemod.jar",
    configUrl: `https://cdn.example.test/sweetcraft/releases/${packVersion}/files/config/example.toml`,
    rpUrl: `https://cdn.example.test/sweetcraft/releases/${packVersion}/files/resourcepacks/SweetCraft-FR-v1.0.zip`
  };
}

export function buildTrustedResolved(files: HarnessFiles, packVersion = "0.2.0"): TrustedResolvedRelease {
  const manifest: ClientManifest = {
    schemaVersion: 6,
    product: "SweetCraft",
    target: "client",
    packVersion,
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
        size: files.modBytes.byteLength,
        sha256: sha256Of(files.modBytes),
        sha512: null,
        provider: {
          type: "modrinth",
          projectId: "abc",
          versionId: "def",
          url: files.modUrl
        },
        distribution: "UPSTREAM_PREFERRED"
      }
    ],
    configs: [
      {
        path: "config/example.toml",
        sha256: sha256Of(files.configBytes),
        policy: "CLIENT_DEFAULT",
        apply: "if_missing",
        target: "CLIENT"
      },
      {
        path: "config/forced.toml",
        sha256: sha256Of(Buffer.from("forced-content")),
        policy: "SERVER_FORCE",
        apply: "force",
        target: "BOTH"
      },
      {
        path: "config/preserve.toml",
        sha256: sha256Of(Buffer.from("preserve-pack")),
        policy: "CLIENT_PRESERVE",
        apply: "never_overwrite",
        target: "CLIENT"
      }
    ],
    resourcePacks: [
      {
        id: "sweetcraft-fr",
        displayName: "SweetCraft FR",
        version: "1.0",
        targetPath: "resourcepacks/SweetCraft-FR-v1.0.zip",
        sha256: sha256Of(files.rpBytes),
        size: files.rpBytes.byteLength,
        autoEnable: true
      }
    ]
  };

  const release: ReleaseDoc = {
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
    antiRollback: { packVersion, releaseSequence: 10 },
    artefacts: {
      clientManifest: { path: "client-manifest.json", sha256: "a".repeat(64) },
      serverManifest: { path: "server-manifest.json", sha256: "b".repeat(64) },
      checksums: { path: "checksums.json", sha256: "c".repeat(64) }
    },
    signature: {
      status: "signed",
      algorithm: "ed25519",
      publicKeyId: "test",
      payload: "SWEETCRAFT-RELEASE-SIGNATURE-V1",
      value: "AA=="
    }
  };

  const channel: VerifiedChannel = {
    trusted: true,
    publicKeyId: "test",
    descriptor: {
      schemaVersion: 1,
      channel: "dev",
      packVersion,
      releaseSequence: 10,
      releasePath: `releases/${packVersion}/release.json`,
      releaseSha256: "d".repeat(64),
      signature: {
        status: "signed",
        algorithm: "ed25519",
        publicKeyId: "test",
        payload: "SWEETCRAFT-CHANNEL-SIGNATURE-V1",
        value: "AA=="
      }
    }
  };

  return {
    trusted: true,
    channel,
    release: {
      trusted: true,
      release,
      releaseBytesSha256: "d".repeat(64),
      publicKeyId: "test"
    },
    clientManifest: manifest,
    productBase: "https://cdn.example.test/sweetcraft",
    candidate: {
      channel: "dev",
      releaseSequence: 10,
      packVersion,
      releasePath: `releases/${packVersion}/release.json`,
      releaseSha256: "d".repeat(64)
    }
  };
}

export function mountHarnessSource(source: MockByteSource, files: HarnessFiles, packVersion = "0.2.0"): void {
  source.set(files.modUrl, files.modBytes);
  source.set(files.configUrl, files.configBytes);
  source.set(
    `https://cdn.example.test/sweetcraft/releases/${packVersion}/files/config/forced.toml`,
    Buffer.from("forced-content")
  );
  source.set(
    `https://cdn.example.test/sweetcraft/releases/${packVersion}/files/config/preserve.toml`,
    Buffer.from("preserve-pack")
  );
  source.set(files.rpUrl, files.rpBytes);
}

export async function writeBytes(filePath: string, data: Buffer | string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}
