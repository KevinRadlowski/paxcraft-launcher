import { createHash } from "node:crypto";
import { MockHttpClient } from "../src/distribution/http/index.js";
import { MockByteSource } from "../src/download/engine/sources.js";
import {
  FileAntiRollbackStore,
  createEmptyAntiRollbackState
} from "../src/instance/state/index.js";
import type { ClientManifest } from "../src/core/manifest/index.js";
import { buildSignedBundle, sha256Hex, createTestKeyMaterial } from "./builders.js";
import type { OrchestratorDependencies } from "../src/application/orchestrator/types.js";
import { ProgressEmitter } from "../src/instance/events/index.js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createNetworkHarnessPermit } from "../src/product/paxNetworkTestHooks.js";

export type OrchKeyMaterial = ReturnType<typeof createTestKeyMaterial>;

export const ORCH_BASE = "https://cdn.example.test/sweetcraft";

export function sha256Of(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface OrchArtefacts {
  modBytes: Buffer;
  configIfMissing: Buffer;
  configForce: Buffer;
  configNever: Buffer;
  rpBytes: Buffer;
  modUrl: string;
  packVersion: string;
}

export function buildOrchArtefacts(packVersion: string, tag = "v1"): OrchArtefacts {
  const modBytes = Buffer.from(`fake-mod-jar-${packVersion}-${tag}`);
  const configIfMissing = Buffer.from(`if_missing=${tag}\n`);
  const configForce = Buffer.from(`forced=${tag}\n`);
  const configNever = Buffer.from(`preserve-pack=${tag}\n`);
  const rpBytes = Buffer.from(`PK\x03\x04rp-${packVersion}-${tag}`);
  return {
    modBytes,
    configIfMissing,
    configForce,
    configNever,
    rpBytes,
    modUrl: `https://cdn.modrinth.example/data/examplemod-${packVersion}.jar`,
    packVersion
  };
}

export function buildOrchManifest(art: OrchArtefacts): ClientManifest {
  return {
    schemaVersion: 6,
    product: "SweetCraft",
    target: "client",
    packVersion: art.packVersion,
    minecraft: "26.1.2",
    fabricLoader: "0.19.3",
    server: "sweetcraft.example",
    configBase: "files/",
    generatedAt: "2026-09-08T00:00:00.000Z",
    mods: [
      {
        id: "examplemod",
        name: "Example Mod",
        version: art.packVersion,
        file: `examplemod-${art.packVersion}.jar`,
        size: art.modBytes.byteLength,
        sha256: sha256Of(art.modBytes),
        sha512: null,
        provider: {
          type: "modrinth",
          projectId: "abc",
          versionId: "def",
          url: art.modUrl
        },
        distribution: "UPSTREAM_PREFERRED"
      }
    ],
    configs: [
      {
        path: "config/example.toml",
        sha256: sha256Of(art.configIfMissing),
        policy: "CLIENT_DEFAULT",
        apply: "if_missing",
        target: "CLIENT"
      },
      {
        path: "config/forced.toml",
        sha256: sha256Of(art.configForce),
        policy: "SERVER_FORCE",
        apply: "force",
        target: "BOTH"
      },
      {
        path: "config/preserve.toml",
        sha256: sha256Of(art.configNever),
        policy: "CLIENT_PRESERVE",
        apply: "never_overwrite",
        target: "CLIENT"
      }
    ],
    resourcePacks: [
      {
        id: "sweetcraft-fr",
        displayName: "SweetCraft FR",
        version: art.packVersion,
        targetPath: `resourcepacks/SweetCraft-FR-${art.packVersion}.zip`,
        sha256: sha256Of(art.rpBytes),
        size: art.rpBytes.byteLength,
        autoEnable: true
      }
    ]
  };
}

export function mountOrchBundle(
  http: MockHttpClient,
  source: MockByteSource,
  art: OrchArtefacts,
  opts?: {
    releaseSequence?: number;
    keys?: OrchKeyMaterial;
  }
): ReturnType<typeof buildSignedBundle> {
  const manifest = buildOrchManifest(art);
  const bundle = buildSignedBundle({
    packVersion: art.packVersion,
    releaseSequence: opts?.releaseSequence ?? (art.packVersion === "0.1.2" ? 3 : 4),
    manifest,
    ...(opts?.keys ? { keys: opts.keys } : {})
  });
  http.set(`${ORCH_BASE}/channels/dev.json`, bundle.channelBytes);
  http.set(`${ORCH_BASE}/releases/${art.packVersion}/release.json`, bundle.releaseBytes);
  http.set(`${ORCH_BASE}/releases/${art.packVersion}/client-manifest.json`, bundle.manifestBytes);

  source.set(art.modUrl, art.modBytes);
  source.set(
    `${ORCH_BASE}/releases/${art.packVersion}/files/config/example.toml`,
    art.configIfMissing
  );
  source.set(
    `${ORCH_BASE}/releases/${art.packVersion}/files/config/forced.toml`,
    art.configForce
  );
  source.set(
    `${ORCH_BASE}/releases/${art.packVersion}/files/config/preserve.toml`,
    art.configNever
  );
  source.set(
    `${ORCH_BASE}/releases/${art.packVersion}/files/resourcepacks/SweetCraft-FR-${art.packVersion}.zip`,
    art.rpBytes
  );
  return bundle;
}

export async function createOrchDeps(opts: {
  dataDir: string;
  http: MockHttpClient;
  source: MockByteSource;
  trust: ReturnType<typeof buildSignedBundle>["trust"];
  emitter?: ProgressEmitter;
}): Promise<OrchestratorDependencies> {
  const antiRollbackStore = new FileAntiRollbackStore(path.join(opts.dataDir, "anti-rollback.json"));
  await mkdir(opts.dataDir, { recursive: true });
  await antiRollbackStore.saveAtomic(createEmptyAntiRollbackState());
  const antiRollbackState = await antiRollbackStore.load();
  return {
    http: opts.http,
    trust: opts.trust,
    artefactSource: opts.source,
    antiRollbackStore,
    antiRollbackState,
    ...testNetworkPolicy(),
    ...(opts.emitter ? { emitter: opts.emitter } : {})
  };
}

/** Spread into inline OrchestratorDependencies / PlayDependencies in tests. */
export function testNetworkPolicy(): {
  networkHarness: ReturnType<typeof createNetworkHarnessPermit>;
  networkRuntime: { kind: "test-harness" };
} {
  return {
    networkHarness: createNetworkHarnessPermit(),
    networkRuntime: { kind: "test-harness" }
  };
}

void writeFile;
void sha256Hex;
