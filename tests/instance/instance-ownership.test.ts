import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertFreshInstallLocationAllowed,
  classifyInstanceRootOwnership,
  hasSweetCraftOwnershipMarker,
  resolveCompleteUninstallDeleteMode
} from "../../src/instance/ownership/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { applyUninstall, assertCompleteUninstallTarget } from "../../src/instance/uninstall/index.js";
import { applySafeUninstall } from "../../src/instance/uninstall/index.js";
import { createEmptyInstanceState } from "../../src/instance/state/instanceState.js";
import { InstanceStateStore } from "../../src/instance/state/instanceState.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { defaultInstanceRoot } from "../../src/instance/paths/index.js";
import { moveInstanceTree } from "../../src/instance/move/index.js";
import { buildInstancePathGuardContext } from "../../src/instance/paths/instanceLocation.js";

async function writeOwnershipMarker(root: string, empty = true): Promise<void> {
  await mkdir(path.join(root, "launcher"), { recursive: true });
  const state = empty ? createEmptyInstanceState() : createEmptyInstanceState();
  if (!empty) {
    Object.assign(state, {
      installedPackVersion: "0.1.3",
      installedReleaseSequence: 4,
      channel: "dev"
    });
  }
  await new InstanceStateStore(new InstancePaths(root)).saveAtomic(state);
}

describe("PACK-10.1G.1 ownership provenance", () => {
  it("launcher/state.json schemaVersion 1 proves ownership", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-own-"));
    await writeOwnershipMarker(root);
    assert.equal(hasSweetCraftOwnershipMarker(root), true);
    assert.equal(classifyInstanceRootOwnership(root), "OWNED");
  });

  it("unrelated non-empty directory is UNRECOGNIZED", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-unrec-"));
    await writeFile(path.join(root, "family-photo.jpg"), "jpg");
    assert.equal(classifyInstanceRootOwnership(root), "UNRECOGNIZED");
  });

  it("assertFreshInstallLocationAllowed accepts absent and empty only", async () => {
    const missing = path.join(await mkdtemp(path.join(tmpdir(), "sc-miss-")), "SweetCraft");
    assert.doesNotThrow(() => assertFreshInstallLocationAllowed(missing));

    const empty = await mkdtemp(path.join(tmpdir(), "sc-empty-"));
    assert.doesNotThrow(() => assertFreshInstallLocationAllowed(empty));

    const unrelated = await mkdtemp(path.join(tmpdir(), "sc-nem-"));
    await writeFile(path.join(unrelated, "taxes.xlsx"), "xlsx");
    assert.throws(
      () => assertFreshInstallLocationAllowed(unrelated),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_LOCATION_NOT_EMPTY
    );
  });
});

describe("PACK-10.1G.1 COMPLETE fail-closed", () => {
  it("does not delete unrelated directory when setting would point there", async () => {
    const customRoot = await mkdtemp(path.join(tmpdir(), "sc-unrel-complete-"));
    await writeFile(path.join(customRoot, "taxes.xlsx"), "keep");
    await writeFile(path.join(customRoot, "family-photo.jpg"), "keep");
    const launcherData = await mkdtemp(path.join(tmpdir(), "sc-ld-unrel-"));
    const paths = new InstancePaths(customRoot);

    await assert.rejects(
      () =>
        applyUninstall({
          mode: "COMPLETE",
          paths,
          launcherDataRoot: launcherData
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_OWNERSHIP_NOT_PROVEN
    );

    await access(path.join(customRoot, "taxes.xlsx"));
    await access(path.join(customRoot, "family-photo.jpg"));
  });

  it("allows COMPLETE recursive delete on owned custom root", async () => {
    const customRoot = await mkdtemp(path.join(tmpdir(), "sc-owned-complete-"));
    await writeOwnershipMarker(customRoot);
    await mkdir(path.join(customRoot, "saves", "MyWorld"), { recursive: true });
    await writeFile(path.join(customRoot, "saves", "MyWorld", "level.dat"), "world");
    await mkdir(path.join(customRoot, "mods"), { recursive: true });
    await writeFile(path.join(customRoot, "mods", "personal.jar"), "mod");
    const launcherData = await mkdtemp(path.join(tmpdir(), "sc-ld-owned-"));
    const paths = new InstancePaths(customRoot);

    await applyUninstall({ mode: "COMPLETE", paths, launcherDataRoot: launcherData });
    await assert.rejects(() => access(customRoot));
  });

  it("COMPLETE after SAFE still recognizes owned root and deletes all", async () => {
    const customRoot = await mkdtemp(path.join(tmpdir(), "sc-safe-then-complete-"));
    await writeOwnershipMarker(customRoot, false);
    await mkdir(path.join(customRoot, "saves", "MyWorld"), { recursive: true });
    await writeFile(path.join(customRoot, "saves", "MyWorld", "level.dat"), "world");
    await mkdir(path.join(customRoot, "mods"), { recursive: true });
    await writeFile(path.join(customRoot, "mods", "personal.jar"), "user");
    await writeFile(path.join(customRoot, "mods", "managed.jar"), "managed");

    const paths = new InstancePaths(customRoot);
    const store = new InstanceStateStore(paths);
    const state = await store.load();
    state.files = [
      {
        type: "mod",
        logicalId: "managed",
        targetPath: "mods/managed.jar",
        sha256: "a".repeat(64),
        size: 7,
        source: "manifest"
      }
    ];
    state.installedPackVersion = "0.1.3";
    state.installedReleaseSequence = 4;
    await store.saveAtomic(state);

    await applySafeUninstall({ paths });
    assert.equal(hasSweetCraftOwnershipMarker(customRoot), true);
    await access(path.join(customRoot, "mods", "personal.jar"));
    await assert.rejects(() => access(path.join(customRoot, "mods", "managed.jar")));

    const launcherData = await mkdtemp(path.join(tmpdir(), "sc-ld-safe-complete-"));
    await applyUninstall({ mode: "COMPLETE", paths, launcherDataRoot: launcherData });
    await assert.rejects(() => access(customRoot));
  });

  it("resolveCompleteUninstallDeleteMode returns EMPTY_ONLY for empty configured root", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "sc-empty-complete-"));
    assert.equal(resolveCompleteUninstallDeleteMode(empty), "EMPTY_ONLY");
  });
});

describe("PACK-10.1G.1 migration ownership", () => {
  it("preserves ownership marker after move", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-move-own-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await writeOwnershipMarker(source);
    await writeFile(path.join(source, "options.txt"), "lang:fr");

    const userData = await mkdtemp(path.join(tmpdir(), "sc-ud-move-"));
    const launcherData = path.join(userData, "launcher-data");
    await mkdir(launcherData, { recursive: true });
    const guard = buildInstancePathGuardContext(launcherData, userData);

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      computeSizeFn: async () => 4096,
      commitLocationFn: async () => {}
    });

    assert.equal(hasSweetCraftOwnershipMarker(result.destinationRoot), true);
    assert.equal(classifyInstanceRootOwnership(result.destinationRoot), "OWNED");
    await assert.rejects(() => access(source));
    await access(path.join(destination, "options.txt"));
  });

  it("keeps new destination authoritative when source cleanup fails", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-move-cleanup-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await writeOwnershipMarker(source);
    await writeFile(path.join(source, "keep.txt"), "data");

    const userData = await mkdtemp(path.join(tmpdir(), "sc-ud-cleanup-"));
    const launcherData = path.join(userData, "launcher-data");
    await mkdir(launcherData, { recursive: true });
    const guard = buildInstancePathGuardContext(launcherData, userData);

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      computeSizeFn: async () => 4096,
      commitLocationFn: async () => {},
      removeSourceFn: async () => {
        throw new Error("cleanup blocked");
      }
    });

    assert.equal(result.sourceCleanupFailed, true);
    assert.equal(hasSweetCraftOwnershipMarker(destination), true);
    await access(source);
    await access(path.join(destination, "keep.txt"));
  });
});

describe("PACK-10.1G.1 path guard with ownership", () => {
  it("assertCompleteUninstallTarget accepts legacy default when owned", async () => {
    const launcherData = await mkdtemp(path.join(tmpdir(), "sc-ld-guard-"));
    const instanceRoot = defaultInstanceRoot(launcherData);
    await writeOwnershipMarker(instanceRoot);
    const paths = new InstancePaths(instanceRoot);
    const ctx = {
      canonicalInstanceRoot: instanceRoot,
      launcherDataRoot: launcherData,
      productUserDataRoot: path.dirname(launcherData),
      runtimeRoot: path.join(launcherData, "runtime")
    };
    const guard = assertCompleteUninstallTarget(paths, ctx);
    assert.equal(guard.deleteMode, "RECURSIVE");
  });
});
