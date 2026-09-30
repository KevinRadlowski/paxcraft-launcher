import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { moveInstanceTree } from "../../src/instance/move/index.js";
import { buildInstancePathGuardContext } from "../../src/instance/paths/instanceLocation.js";
import {
  classifyInstanceRootOwnership,
  hasSweetCraftOwnershipMarker
} from "../../src/instance/ownership/index.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import {
  loadSettingsStore,
  saveSettingsStore,
  settingsFilePath
} from "../../desktop/main/settings/settings-store.js";
import { INSTANCE_STATE_SCHEMA_VERSION } from "../../src/instance/state/instanceState.js";

async function seedOwnedInstance(root: string): Promise<void> {
  await mkdir(path.join(root, "launcher"), { recursive: true });
  await writeFile(
    path.join(root, "launcher", "state.json"),
    JSON.stringify({
      schemaVersion: INSTANCE_STATE_SCHEMA_VERSION,
      installedPackVersion: "0.1.3",
      installedReleaseSequence: 4,
      installedReleaseSha256: null,
      installedManifestSha256: null,
      channel: "dev",
      productBase: "https://cdn.xnosweet.fr/sweetcraft",
      files: [],
      updatedAt: new Date().toISOString()
    })
  );
  await mkdir(path.join(root, "saves"), { recursive: true });
  await writeFile(path.join(root, "saves", "world.txt"), "world");
}

async function layout(): Promise<{ launcherData: string; userData: string; guard: ReturnType<typeof buildInstancePathGuardContext> }> {
  const userData = await mkdtemp(path.join(tmpdir(), "sc-txn-ud-"));
  const launcherData = path.join(userData, "launcher-data");
  await mkdir(launcherData, { recursive: true });
  return {
    userData,
    launcherData,
    guard: buildInstancePathGuardContext(launcherData, userData)
  };
}

describe("PACK-10.1G.2 copy-first transactional move", () => {
  it("same-volume move uses copy strategy and deletes source only after commit", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-txn-same-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedOwnedInstance(source);
    const { guard, launcherData } = await layout();
    let committed = false;

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      computeSizeFn: async () => 1024,
      commitLocationFn: async (dest) => {
        saveSettingsStore(launcherData, {
          language: "fr",
          reducedMotion: false,
          memoryMiB: 2048,
          sweetcraftInstancePath: dest
        });
        committed = true;
      }
    });

    assert.equal(result.strategy, "copy");
    assert.equal(committed, true);
    assert.equal(loadSettingsStore(launcherData).sweetcraftInstancePath, destination);
    await assert.rejects(() => access(source));
    await access(path.join(destination, "saves", "world.txt"));
  });

  it("same-volume commit failure preserves source and removes destination", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-txn-commit-fail-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedOwnedInstance(source);
    const { guard, launcherData } = await layout();
    saveSettingsStore(launcherData, {
      language: "fr",
      reducedMotion: false,
      memoryMiB: 2048,
      sweetcraftInstancePath: source
    });

    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard,
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          computeSizeFn: async () => 1024,
          commitLocationFn: async () => {
            throw new Error("settings persist failed");
          }
        }),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.INSTANCE_MOVE_FAILED &&
        e.details?.preservedSource === true
    );

    assert.equal(loadSettingsStore(launcherData).sweetcraftInstancePath, source);
    await access(path.join(source, "saves", "world.txt"));
    await assert.rejects(() => access(destination));
  });

  it("cross-volume commit failure keeps old setting and source authoritative", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-txn-xv-commit-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedOwnedInstance(source);
    const { guard, launcherData } = await layout();
    saveSettingsStore(launcherData, {
      language: "fr",
      reducedMotion: false,
      memoryMiB: 2048,
      sweetcraftInstancePath: source
    });

    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard,
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          computeSizeFn: async () => 2048,
          commitLocationFn: async () => {
            throw new Error("disk full on settings write");
          }
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_MOVE_FAILED
    );

    assert.equal(loadSettingsStore(launcherData).sweetcraftInstancePath, source);
    await access(source);
    await assert.rejects(() => access(destination));
  });

  it("cleanup failure after successful commit keeps destination authoritative", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-txn-cleanup-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedOwnedInstance(source);
    const { guard, launcherData } = await layout();

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      computeSizeFn: async () => 2048,
      commitLocationFn: async (dest) => {
        saveSettingsStore(launcherData, {
          language: "fr",
          reducedMotion: false,
          memoryMiB: 2048,
          sweetcraftInstancePath: dest
        });
      },
      removeSourceFn: async () => {
        throw new Error("cleanup blocked");
      }
    });

    assert.equal(result.sourceCleanupFailed, true);
    assert.equal(loadSettingsStore(launcherData).sweetcraftInstancePath, destination);
    assert.equal(hasSweetCraftOwnershipMarker(destination), true);
    await access(source);
    await access(path.join(destination, "saves", "world.txt"));
  });

  it("preserves ownership marker on destination after successful move", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-txn-own-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedOwnedInstance(source);
    const { guard } = await layout();

    await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      computeSizeFn: async () => 1024,
      commitLocationFn: async () => {}
    });

    assert.equal(classifyInstanceRootOwnership(destination), "OWNED");
    const state = JSON.parse(await readFile(path.join(destination, "launcher", "state.json"), "utf8"));
    assert.equal(state.productBase, "https://cdn.xnosweet.fr/sweetcraft");
  });
});

describe("PACK-10.1G.2 ownership identity audit", () => {
  it("schemaVersion 1 with SweetCraft productBase is OWNED", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-id-pos-"));
    await seedOwnedInstance(root);
    assert.equal(classifyInstanceRootOwnership(root), "OWNED");
  });

  it("schemaVersion 1 with unrelated productBase remains OWNED (legacy layout marker)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-id-other-"));
    await mkdir(path.join(root, "launcher"), { recursive: true });
    await writeFile(
      path.join(root, "launcher", "state.json"),
      JSON.stringify({
        schemaVersion: INSTANCE_STATE_SCHEMA_VERSION,
        installedPackVersion: null,
        installedReleaseSequence: null,
        installedReleaseSha256: null,
        installedManifestSha256: null,
        channel: null,
        productBase: "https://other.example/product",
        files: [],
        updatedAt: new Date().toISOString()
      })
    );
    assert.equal(hasSweetCraftOwnershipMarker(root), true);
    assert.equal(classifyInstanceRootOwnership(root), "OWNED");
  });

  it("wrong schemaVersion is UNRECOGNIZED", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-id-wrong-"));
    await mkdir(path.join(root, "launcher"), { recursive: true });
    await writeFile(
      path.join(root, "launcher", "state.json"),
      JSON.stringify({ schemaVersion: 99, productBase: "https://cdn.xnosweet.fr/sweetcraft" })
    );
    assert.equal(classifyInstanceRootOwnership(root), "UNRECOGNIZED");
  });
});
