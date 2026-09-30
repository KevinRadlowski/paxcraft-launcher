import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { applyInstallation } from "../../src/instance/apply/index.js";
import {
  applySafeUninstall,
  applyUninstall,
  assertCompleteUninstallTarget
} from "../../src/instance/uninstall/index.js";
import {
  DEFAULT_INSTANCE_ID,
  defaultInstanceRoot,
  defaultRuntimeRoot
} from "../../src/instance/paths/productData.js";
import { InstanceStateStore, createEmptyInstanceState } from "../../src/instance/state/instanceState.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import {
  buildHarnessFiles,
  buildTrustedResolved,
  mountHarnessSource
} from "../../fixtures/instanceHarness.js";

async function tmpInstance(): Promise<InstancePaths> {
  const root = await mkdtemp(path.join(tmpdir(), "sc-uninstall-"));
  return new InstancePaths(root);
}

async function installHarness(paths: InstancePaths) {
  const files = buildHarnessFiles();
  const resolved = buildTrustedResolved(files);
  const source = new MockByteSource();
  mountHarnessSource(source, files);
  await applyInstallation({ resolved, paths, source });
  return { files, resolved, source };
}

async function seedUserData(paths: InstancePaths): Promise<void> {
  await mkdir(paths.absoluteForRelative("mods"), { recursive: true });
  await writeFile(paths.absoluteForRelative("mods/user-custom.jar"), "user-mod");
  await mkdir(paths.absoluteForRelative("resourcepacks"), { recursive: true });
  await writeFile(paths.absoluteForRelative("resourcepacks/personal.zip"), "personal-rp");
  await mkdir(paths.absoluteForRelative("saves/MyWorld"), { recursive: true });
  await writeFile(paths.absoluteForRelative("saves/MyWorld/level.dat"), "world-data");
  await mkdir(paths.absoluteForRelative("screenshots"), { recursive: true });
  await writeFile(paths.absoluteForRelative("screenshots/shot.png"), "png-bytes");
  await writeFile(paths.absoluteForRelative("options.txt"), "lang:fr\n");
  await writeFile(paths.absoluteForRelative("servers.dat"), "servers");
  await writeFile(paths.absoluteForRelative("custom-user-file.txt"), "custom");
  await mkdir(paths.absoluteForRelative("crash-reports"), { recursive: true });
  await writeFile(paths.absoluteForRelative("crash-reports/crash.txt"), "crash");
  await mkdir(paths.logsDir(), { recursive: true });
  await writeFile(path.join(paths.logsDir(), "latest.log"), "log line\n");
}

async function tmpCanonicalLayout(): Promise<{ launcherDataRoot: string; paths: InstancePaths }> {
  const launcherDataRoot = await mkdtemp(path.join(tmpdir(), "sc-launcher-data-"));
  const instanceRoot = defaultInstanceRoot(launcherDataRoot);
  await mkdir(instanceRoot, { recursive: true });
  return { launcherDataRoot, paths: new InstancePaths(instanceRoot) };
}

async function seedLauncherSentinels(launcherDataRoot: string): Promise<void> {
  await mkdir(defaultRuntimeRoot(launcherDataRoot), { recursive: true });
  await writeFile(path.join(defaultRuntimeRoot(launcherDataRoot), "runtime-sentinel.txt"), "runtime");
  await mkdir(path.join(launcherDataRoot, "state"), { recursive: true });
  await writeFile(path.join(launcherDataRoot, "settings.json"), "{}");
  await mkdir(path.join(launcherDataRoot, "instances", "other-instance"), { recursive: true });
  await writeFile(
    path.join(launcherDataRoot, "instances", "other-instance", "sentinel.txt"),
    "other"
  );
}

describe("PACK-10.1F safe uninstall", () => {
  it("removes managed files and preserves user data", async () => {
    const paths = await tmpInstance();
    await installHarness(paths);
    await seedUserData(paths);

    const before = await new InstanceStateStore(paths).load();
    assert.ok(before.files.length > 0);

    const events: string[] = [];
    const emitter = new ProgressEmitter();
    emitter.on((event) => {
      if (event.type === "FILE_REMOVED") events.push(event.type);
    });

    const result = await applySafeUninstall({ paths, emitter });
    assert.equal(result.outcome, "SUCCESS");
    assert.ok(result.removedFiles > 0);
    assert.ok(events.length > 0);

    const after = await new InstanceStateStore(paths).load();
    assert.equal(after.installedPackVersion, null);
    assert.equal(after.files.length, 0);

    await assert.doesNotReject(() => access(paths.absoluteForRelative("mods/user-custom.jar")));
    await assert.doesNotReject(() => access(paths.absoluteForRelative("resourcepacks/personal.zip")));
    await assert.doesNotReject(() => access(paths.absoluteForRelative("saves/MyWorld/level.dat")));
    await assert.doesNotReject(() => access(paths.absoluteForRelative("screenshots/shot.png")));
    await assert.doesNotReject(() => access(paths.absoluteForRelative("options.txt")));
    await assert.doesNotReject(() => access(path.join(paths.logsDir(), "latest.log")));
  });

  it("idempotent when already not installed", async () => {
    const paths = await tmpInstance();
    await seedUserData(paths);
    await new InstanceStateStore(paths).saveAtomic(createEmptyInstanceState());

    const result = await applySafeUninstall({ paths });
    assert.equal(result.outcome, "NOOP");
    assert.equal(result.removedFiles, 0);

    await assert.doesNotReject(() => access(paths.absoluteForRelative("mods/user-custom.jar")));
  });

  it("does not mark NOT_INSTALLED when deletion fails", async () => {
    const paths = await tmpInstance();
    await installHarness(paths);

    const stateStore = new InstanceStateStore(paths);
    const state = await stateStore.load();
    await mkdir(paths.absoluteForRelative("mods/block-delete"), { recursive: true });
    state.files.push({
      type: "mod",
      logicalId: "block-delete",
      targetPath: "mods/block-delete",
      sha256: "a".repeat(64),
      size: 0,
      source: "manifest"
    });
    await stateStore.saveAtomic(state);

    await assert.rejects(
      () => applySafeUninstall({ paths }),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.UNINSTALL_FAILED
    );

    const after = await stateStore.load();
    assert.ok(after.files.length > 0);
    assert.equal(after.installedPackVersion, state.installedPackVersion);
  });

  it("reinstall after uninstall preserves user data", async () => {
    const paths = await tmpInstance();
    const { resolved, source } = await installHarness(paths);
    await seedUserData(paths);

    await applySafeUninstall({ paths });

    await applyInstallation({ resolved, paths, source });

    const state = await new InstanceStateStore(paths).load();
    assert.ok(state.files.length > 0);
    assert.ok(state.installedPackVersion);

    await assert.doesNotReject(() => access(paths.absoluteForRelative("saves/MyWorld/level.dat")));
    await assert.doesNotReject(() => access(paths.absoluteForRelative("options.txt")));
    await assert.doesNotReject(() => access(paths.absoluteForRelative("mods/user-custom.jar")));
  });

  it("leaves non-empty mods directory when user mod remains", async () => {
    const paths = await tmpInstance();
    await installHarness(paths);
    await seedUserData(paths);

    await applySafeUninstall({ paths });

    await assert.doesNotReject(() => access(paths.absoluteForRelative("mods/user-custom.jar")));
    await assert.doesNotReject(() => access(paths.modsDir()));
  });
});

describe("PACK-10.1F.1 complete uninstall", () => {
  it("removes entire instance and preserves launcher/runtime/other-instance sentinels", async () => {
    const { launcherDataRoot, paths } = await tmpCanonicalLayout();
    await seedLauncherSentinels(launcherDataRoot);
    await installHarness(paths);
    await seedUserData(paths);

    const result = await applyUninstall({
      mode: "COMPLETE",
      paths,
      launcherDataRoot
    });
    assert.equal(result.outcome, "SUCCESS");

    await assert.rejects(() => access(paths.root));
    await assert.doesNotReject(() =>
      access(path.join(defaultRuntimeRoot(launcherDataRoot), "runtime-sentinel.txt"))
    );
    await assert.doesNotReject(() => access(path.join(launcherDataRoot, "settings.json")));
    await assert.doesNotReject(() =>
      access(path.join(launcherDataRoot, "instances", "other-instance", "sentinel.txt"))
    );
  });

  it("safe then complete removes preserved user data", async () => {
    const { launcherDataRoot, paths } = await tmpCanonicalLayout();
    await installHarness(paths);
    await seedUserData(paths);

    await applyUninstall({ mode: "SAFE", paths, launcherDataRoot });
    await assert.doesNotReject(() => access(paths.absoluteForRelative("saves/MyWorld/level.dat")));

    await applyUninstall({ mode: "COMPLETE", paths, launcherDataRoot });
    await assert.rejects(() => access(paths.root));
  });

  it("idempotent when instance root already absent", async () => {
    const launcherDataRoot = await mkdtemp(path.join(tmpdir(), "sc-launcher-data-"));
    const instanceRoot = defaultInstanceRoot(launcherDataRoot);
    const paths = new InstancePaths(instanceRoot);
    const result = await applyUninstall({
      mode: "COMPLETE",
      paths,
      launcherDataRoot
    });
    assert.equal(result.outcome, "NOOP");
    const again = await applyUninstall({
      mode: "COMPLETE",
      paths,
      launcherDataRoot
    });
    assert.equal(again.outcome, "NOOP");
  });

  it("rejects launcher-data root as delete target", async () => {
    const { launcherDataRoot } = await tmpCanonicalLayout();
    const wrong = new InstancePaths(launcherDataRoot);
    await assert.rejects(
      () =>
        applyUninstall({
          mode: "COMPLETE",
          paths: wrong,
          launcherDataRoot
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
  });

  it("rejects runtime root as delete target", async () => {
    const { launcherDataRoot } = await tmpCanonicalLayout();
    const runtimeRoot = defaultRuntimeRoot(launcherDataRoot);
    await mkdir(runtimeRoot, { recursive: true });
    const wrong = new InstancePaths(runtimeRoot);
    await assert.rejects(
      () =>
        applyUninstall({
          mode: "COMPLETE",
          paths: wrong,
          launcherDataRoot
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
  });

  it("does not follow symlink/junction outside instance", async () => {
    const { launcherDataRoot, paths } = await tmpCanonicalLayout();
    await installHarness(paths);
    const external = await mkdtemp(path.join(tmpdir(), "sc-ext-sentinel-"));
    await writeFile(path.join(external, "secret.txt"), "keep-me");

    const linkInside = paths.absoluteForRelative("escape-link");
    await symlink(external, linkInside, process.platform === "win32" ? "junction" : "dir");

    await applyUninstall({ mode: "COMPLETE", paths, launcherDataRoot });
    await assert.doesNotReject(() => access(path.join(external, "secret.txt")));
    await assert.rejects(() => access(paths.root));
  });
});

describe("PACK-10.1F.1 path guard", () => {
  it("assertCompleteUninstallTarget accepts only canonical sweetcraft instance root", async () => {
    const { launcherDataRoot, paths } = await tmpCanonicalLayout();
    const ctx = {
      canonicalInstanceRoot: defaultInstanceRoot(launcherDataRoot),
      launcherDataRoot,
      productUserDataRoot: path.resolve(launcherDataRoot, ".."),
      runtimeRoot: defaultRuntimeRoot(launcherDataRoot)
    };
    assert.doesNotThrow(() => assertCompleteUninstallTarget(paths, ctx));
    assert.equal(DEFAULT_INSTANCE_ID, "sweetcraft");
  });
});
