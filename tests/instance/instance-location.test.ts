import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildInstancePathGuardContext,
  canonicalizeInstancePath,
  classifyMigrationDestination,
  defaultInstanceRoot,
  resolveSweetCraftInstanceLocation,
  validateInstancePathCandidate
} from "../../src/instance/paths/index.js";
import { moveInstanceTree } from "../../src/instance/move/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { applyUninstall } from "../../src/instance/uninstall/index.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";

async function tmpLayout(): Promise<{
  userData: string;
  launcherData: string;
  legacyDefault: string;
}> {
  const userData = await mkdtemp(path.join(tmpdir(), "sc-userdata-"));
  const launcherData = path.join(userData, "launcher-data");
  await mkdir(launcherData, { recursive: true });
  const legacyDefault = defaultInstanceRoot(launcherData);
  return { userData, launcherData, legacyDefault };
}

function guardFor(launcherData: string, userData: string) {
  return buildInstancePathGuardContext(launcherData, userData);
}

describe("PACK-10.1G instance location resolver", () => {
  it("returns legacy default when no configured path and legacy exists", async () => {
    const { launcherData, legacyDefault } = await tmpLayout();
    await mkdir(legacyDefault, { recursive: true });
    await writeFile(path.join(legacyDefault, "marker.txt"), "x");
    const resolved = resolveSweetCraftInstanceLocation({
      launcherDataRoot: launcherData,
      productUserDataRoot: path.dirname(launcherData)
    });
    assert.equal(resolved.instanceRoot, legacyDefault);
    assert.equal(resolved.isConfigured, false);
    assert.equal(resolved.instanceAvailable, true);
  });

  it("uses custom configured path for fresh install target", async () => {
    const { launcherData } = await tmpLayout();
    const custom = path.join(await mkdtemp(path.join(tmpdir(), "sc-custom-")), "SweetCraft");
    const resolved = resolveSweetCraftInstanceLocation({
      launcherDataRoot: launcherData,
      productUserDataRoot: path.dirname(launcherData),
      configuredInstancePath: custom
    });
    assert.equal(resolved.instanceRoot, path.resolve(custom));
    assert.equal(resolved.isConfigured, true);
    assert.equal(resolved.instanceAvailable, false);
  });

  it("reports location unavailable without falling back to legacy default", async () => {
    const { launcherData, legacyDefault } = await tmpLayout();
    await mkdir(legacyDefault, { recursive: true });
    const missingDrive = "Z:\\SweetCraft\\MissingDrive";
    const resolved = resolveSweetCraftInstanceLocation({
      launcherDataRoot: launcherData,
      productUserDataRoot: path.dirname(launcherData),
      configuredInstancePath: missingDrive,
      existsSync: () => false,
      accessSync: () => {
        throw new Error("unavailable");
      }
    });
    assert.equal(resolved.locationUnavailable, true);
    assert.equal(resolved.instanceRoot, path.resolve(missingDrive));
    assert.notEqual(resolved.instanceRoot, legacyDefault);
  });
});

describe("PACK-10.1G path validation", () => {
  it("rejects drive root and launcher-data root", async () => {
    const { launcherData, userData } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    assert.equal(validateInstancePathCandidate("C:\\", guard).ok, false);
    assert.equal(validateInstancePathCandidate(launcherData, guard).ok, false);
    assert.equal(validateInstancePathCandidate(path.join(launcherData, "runtime"), guard).ok, false);
  });

  it("allows legacy default and external custom paths", async () => {
    const { launcherData, userData, legacyDefault } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    assert.equal(validateInstancePathCandidate(legacyDefault, guard).ok, true);
    assert.equal(validateInstancePathCandidate("D:\\Games\\SweetCraft", guard).ok, true);
  });

  it("rejects overlapping migration targets", async () => {
    const { launcherData, userData } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    const source = "D:\\SweetCraft";
    assert.equal(
      validateInstancePathCandidate("D:\\SweetCraft\\Moved", guard, { sourceRoot: source }).reason,
      "OVERLAP_DESTINATION"
    );
    assert.equal(
      validateInstancePathCandidate(source, guard, { sourceRoot: source }).reason,
      "SAME_PATH"
    );
  });
});

describe("PACK-10.1G instance move", () => {
  async function seedInstance(root: string): Promise<void> {
    await mkdir(path.join(root, "launcher"), { recursive: true });
    await writeFile(path.join(root, "launcher", "state.json"), "{}");
    await mkdir(path.join(root, "mods"), { recursive: true });
    await writeFile(path.join(root, "mods", "user.txt"), "mod");
    await mkdir(path.join(root, "saves"), { recursive: true });
    await writeFile(path.join(root, "options.txt"), "lang:fr");
  }

  it("moves full tree on same volume via copy-first transaction", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-move-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source);
    const { launcherData, userData } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    let committed = false;
    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      computeSizeFn: async () => 1024,
      commitLocationFn: async () => {
        committed = true;
      }
    });
    assert.equal(result.strategy, "copy");
    assert.equal(committed, true);
    await access(path.join(destination, "saves"));
    await assert.rejects(() => access(source));
  });

  it("copies tree on cross-volume paths", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-move-xv-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source);
    const { launcherData, userData } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      computeSizeFn: async () => 2048,
      commitLocationFn: async () => {}
    });
    assert.equal(result.strategy, "copy");
    await access(path.join(destination, "mods", "user.txt"));
    await assert.rejects(() => access(source));
  });

  it("rejects nonempty unrelated destination", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-move-ne-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source);
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "foreign.txt"), "no");
    const { launcherData, userData } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard,
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          computeSizeFn: async () => 1024
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
    await access(source);
  });

  it("keeps source authoritative when copy fails", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-move-fail-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source);
    const { launcherData, userData } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard,
          copyTreeFn: async () => {
            throw new Error("copy failed");
          },
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          computeSizeFn: async () => 1024
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_MOVE_FAILED
    );
    await access(path.join(source, "options.txt"));
  });

  it("blocks move when insufficient disk space", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-move-space-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source);
    const { launcherData, userData } = await tmpLayout();
    const guard = guardFor(launcherData, userData);
    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard,
          freeSpaceFn: async () => 100,
          computeSizeFn: async () => 1024 * 1024
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSUFFICIENT_DISK_SPACE
    );
  });
});

describe("PACK-10.1G uninstall at custom path", () => {
  it("SAFE preserves user files at custom root", async () => {
    const customRoot = await mkdtemp(path.join(tmpdir(), "sc-custom-uninst-"));
    const paths = new InstancePaths(customRoot);
    await mkdir(path.join(customRoot, "mods"), { recursive: true });
    await writeFile(path.join(customRoot, "mods", "user.txt"), "keep");
    await mkdir(path.join(customRoot, "launcher"), { recursive: true });
    await writeFile(
      path.join(customRoot, "launcher", "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        installedPackVersion: "0.1.3",
        installedReleaseSequence: 4,
        installedReleaseSha256: null,
        installedManifestSha256: null,
        channel: "dev",
        productBase: "https://example.test",
        updatedAt: new Date().toISOString(),
        files: [
          {
            type: "mod",
            logicalId: "managed",
            targetPath: "mods/managed.jar",
            sha256: "a".repeat(64),
            size: 1,
            source: "manifest"
          }
        ]
      })
    );
    await mkdir(path.join(customRoot, "mods"), { recursive: true });
    await writeFile(path.join(customRoot, "mods", "managed.jar"), "x");
    const launcherData = await mkdtemp(path.join(tmpdir(), "sc-ld-"));
    await applyUninstall({ mode: "SAFE", paths, launcherDataRoot: launcherData });
    await access(path.join(customRoot, "mods", "user.txt"));
    await assert.rejects(() => access(path.join(customRoot, "mods", "managed.jar")));
  });

  it("COMPLETE removes owned custom root entirely", async () => {
    const customRoot = await mkdtemp(path.join(tmpdir(), "sc-custom-complete-"));
    const paths = new InstancePaths(customRoot);
    await mkdir(path.join(customRoot, "launcher"), { recursive: true });
    await writeFile(
      path.join(customRoot, "launcher", "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        installedPackVersion: "0.1.3",
        installedReleaseSequence: 4,
        installedReleaseSha256: null,
        installedManifestSha256: null,
        channel: "dev",
        productBase: "https://example.test",
        files: [],
        updatedAt: new Date().toISOString()
      })
    );
    await mkdir(path.join(customRoot, "saves"), { recursive: true });
    await writeFile(path.join(customRoot, "saves", "world.txt"), "world");
    const launcherData = await mkdtemp(path.join(tmpdir(), "sc-ld2-"));
    await applyUninstall({ mode: "COMPLETE", paths, launcherDataRoot: launcherData });
    await assert.rejects(() => access(customRoot));
    await access(launcherData);
  });
});

describe("PACK-10.1G canonicalizeInstancePath", () => {
  it("normalizes separators and rejects relative paths", () => {
    const abs = canonicalizeInstancePath("D:\\Games\\SweetCraft");
    assert.ok(path.isAbsolute(abs));
    assert.throws(() => canonicalizeInstancePath("Games\\SweetCraft"));
  });
});
