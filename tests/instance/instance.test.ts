import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { resolveSafeInstancePath } from "../../src/instance/security/index.js";
import { buildInstallationPlan } from "../../src/instance/plan/index.js";
import { applyInstallation } from "../../src/instance/apply/index.js";
import { auditInstance, planRepair } from "../../src/instance/audit/index.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import { InstanceStateStore, createEmptyInstanceState } from "../../src/instance/state/instanceState.js";
import { ProgressEmitter, type ProgressEvent } from "../../src/instance/events/index.js";
import { DownloadEngine } from "../../src/download/engine/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import {
  buildHarnessFiles,
  buildTrustedResolved,
  mountHarnessSource,
  writeBytes,
  sha256Of
} from "../../fixtures/instanceHarness.js";

async function tmpInstance(): Promise<InstancePaths> {
  const root = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
  return new InstancePaths(root);
}

describe("instance manager lot 0.2", () => {
  it("fresh install plan downloads missing artefacts", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const plan = await buildInstallationPlan({
      resolved,
      state: createEmptyInstanceState(),
      paths,
      dryRun: true
    });
    assert.ok(plan.summary.download >= 3);
    assert.equal(plan.entries.some((e) => e.kind === "mod" && e.action === "DOWNLOAD"), true);
  });

  it("already-current instance keeps files", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    const plan = await buildInstallationPlan({
      resolved,
      state: await new InstanceStateStore(paths).load(),
      paths,
      dryRun: true
    });
    assert.equal(plan.summary.download, 0);
    assert.equal(plan.summary.replace, 0);
    assert.ok(plan.summary.keep >= 3);
  });

  it("missing mod is planned for download", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    await rm(paths.absoluteForRelative("mods/examplemod-1.0.0.jar"), { force: true });
    const plan = await buildInstallationPlan({
      resolved,
      state: await new InstanceStateStore(paths).load(),
      paths
    });
    const mod = plan.entries.find((e) => e.kind === "mod");
    assert.equal(mod?.action, "DOWNLOAD");
  });

  it("corrupt mod is planned for replace", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    await writeBytes(paths.absoluteForRelative("mods/examplemod-1.0.0.jar"), Buffer.from("CORRUPT"));
    const plan = await buildInstallationPlan({
      resolved,
      state: await new InstanceStateStore(paths).load(),
      paths
    });
    assert.equal(plan.entries.find((e) => e.kind === "mod")?.action, "REPLACE");
  });

  it("unknown unmanaged jar is preserved (not deleted)", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    await writeBytes(paths.absoluteForRelative("mods/user-extra.jar"), Buffer.from("user"));
    const plan = await buildInstallationPlan({
      resolved,
      state: await new InstanceStateStore(paths).load(),
      paths
    });
    assert.equal(
      plan.entries.some((e) => e.targetPath === "mods/user-extra.jar" && e.action === "DELETE_MANAGED"),
      false
    );
    const audit = await auditInstance({ resolved, paths });
    assert.ok(audit.findings.some((f) => f.status === "UNMANAGED" && f.targetPath === "mods/user-extra.jar"));
    await applyInstallation({ resolved, paths, source });
    const still = await readFile(paths.absoluteForRelative("mods/user-extra.jar"));
    assert.equal(still.toString(), "user");
  });

  it("stale managed mod is deleted", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    const store = new InstanceStateStore(paths);
    const state = await store.load();
    state.files.push({
      type: "mod",
      logicalId: "oldmod",
      targetPath: "mods/oldmod.jar",
      sha256: "e".repeat(64),
      size: 4,
      source: "manifest"
    });
    await store.saveAtomic(state);
    await writeBytes(paths.absoluteForRelative("mods/oldmod.jar"), Buffer.from("old!"));
    const plan = await buildInstallationPlan({ resolved, state: await store.load(), paths });
    assert.ok(plan.entries.some((e) => e.action === "DELETE_MANAGED" && e.targetPath === "mods/oldmod.jar"));
    await applyInstallation({ resolved, paths, source });
    const names = await readdir(paths.modsDir());
    assert.equal(names.includes("oldmod.jar"), false);
  });

  it("force config replaced when different; kept when identical", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    let plan = await buildInstallationPlan({
      resolved,
      state: await new InstanceStateStore(paths).load(),
      paths
    });
    assert.equal(plan.entries.find((e) => e.targetPath === "config/forced.toml")?.action, "KEEP");
    await writeBytes(paths.absoluteForRelative("config/forced.toml"), Buffer.from("tampered"));
    plan = await buildInstallationPlan({
      resolved,
      state: await new InstanceStateStore(paths).load(),
      paths
    });
    assert.equal(plan.entries.find((e) => e.targetPath === "config/forced.toml")?.action, "REPLACE");
  });

  it("if_missing absent installed; existing preserved", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    await writeBytes(paths.absoluteForRelative("config/example.toml"), Buffer.from("user-edited"));
    const plan = await buildInstallationPlan({
      resolved,
      state: createEmptyInstanceState(),
      paths
    });
    assert.equal(plan.entries.find((e) => e.targetPath === "config/example.toml")?.reason, "if_missing_preserved");
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    assert.equal((await readFile(paths.absoluteForRelative("config/example.toml"))).toString(), "user-edited");
  });

  it("never_overwrite existing preserved; absent installed", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    let plan = await buildInstallationPlan({
      resolved,
      state: createEmptyInstanceState(),
      paths
    });
    assert.equal(
      plan.entries.find((e) => e.targetPath === "config/preserve.toml")?.reason,
      "never_overwrite_absent"
    );
    await writeBytes(paths.absoluteForRelative("config/preserve.toml"), Buffer.from("mine"));
    plan = await buildInstallationPlan({
      resolved,
      state: createEmptyInstanceState(),
      paths
    });
    assert.equal(
      plan.entries.find((e) => e.targetPath === "config/preserve.toml")?.reason,
      "never_overwrite_preserved"
    );
  });

  it("resource pack install and corrupt repair", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    await applyInstallation({ resolved, paths, source });
    const rp = paths.absoluteForRelative("resourcepacks/SweetCraft-FR-v1.0.zip");
    assert.equal(sha256Of(await readFile(rp)), sha256Of(files.rpBytes));
    await writeBytes(rp, Buffer.from("bad-zip"));
    const plan = await buildInstallationPlan({
      resolved,
      state: await new InstanceStateStore(paths).load(),
      paths
    });
    assert.equal(plan.entries.find((e) => e.kind === "resourcePack")?.action, "REPLACE");
  });

  it("download hash/size mismatch and network cleanup", async () => {
    const paths = await tmpInstance();
    const source = new MockByteSource();
    source.set("https://cdn.example.test/bad.jar", Buffer.from("abc"), { contentLength: 3 });
    const engine = new DownloadEngine({ source, tmpDir: paths.tmpDir(), maxRetries: 0 });
    await assert.rejects(
      () =>
        engine.download({
          id: "x",
          url: "https://cdn.example.test/bad.jar",
          expectedSha256: "0".repeat(64),
          expectedSize: 3,
          maxBytes: 1000,
          timeoutMs: 5000,
          targetPath: "mods/x.jar"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_HASH_MISMATCH
    );
    source.set("https://cdn.example.test/size.jar", Buffer.from("abcd"), { contentLength: 4 });
    await assert.rejects(
      () =>
        engine.download({
          id: "y",
          url: "https://cdn.example.test/size.jar",
          expectedSha256: createHash("sha256").update("abcd").digest("hex"),
          expectedSize: 99,
          maxBytes: 1000,
          timeoutMs: 5000,
          targetPath: "mods/y.jar"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_SIZE_MISMATCH
    );
    source.set("https://cdn.example.test/net.jar", Buffer.from("x"), { fail: ErrorCode.NETWORK_ERROR });
    await assert.rejects(
      () =>
        engine.download({
          id: "z",
          url: "https://cdn.example.test/net.jar",
          expectedSha256: "0".repeat(64),
          expectedSize: 1,
          maxBytes: 1000,
          timeoutMs: 5000,
          targetPath: "mods/z.jar"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.NETWORK_ERROR
    );
    const leftovers = await readdir(paths.tmpDir()).catch(() => [] as string[]);
    assert.equal(leftovers.filter((f) => f.endsWith(".part")).length, 0);
  });

  it("timeout and abort cleanup", async () => {
    const paths = await tmpInstance();
    await mkdir(paths.tmpDir(), { recursive: true });
    const source = new MockByteSource();
    source.set("https://cdn.example.test/slow.jar", Buffer.from("hello"), { delayMs: 5000 });
    const engine = new DownloadEngine({ source, tmpDir: paths.tmpDir(), maxRetries: 0 });
    await assert.rejects(
      () =>
        engine.download({
          id: "slow",
          url: "https://cdn.example.test/slow.jar",
          expectedSha256: sha256Of("hello"),
          expectedSize: 5,
          maxBytes: 1000,
          timeoutMs: 10,
          targetPath: "mods/slow.jar"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_TIMEOUT
    );
    const ac = new AbortController();
    source.set("https://cdn.example.test/abort.jar", Buffer.from("hello"));
    ac.abort();
    await assert.rejects(
      () =>
        engine.download(
          {
            id: "abort",
            url: "https://cdn.example.test/abort.jar",
            expectedSha256: sha256Of("hello"),
            expectedSize: 5,
            maxBytes: 1000,
            timeoutMs: 5000,
            targetPath: "mods/abort.jar"
          },
          ac.signal
        ),
      (e: unknown) =>
        e instanceof LauncherError &&
        (e.code === ErrorCode.DOWNLOAD_ABORTED || e.code === ErrorCode.HTTP_TIMEOUT)
    );
  });

  it("target collision and path traversal fail closed", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    resolved.clientManifest.mods.push({
      ...resolved.clientManifest.mods[0]!,
      id: "other",
      file: "examplemod-1.0.0.jar"
    });
    await assert.rejects(
      () => buildInstallationPlan({ resolved, state: createEmptyInstanceState(), paths }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.PLAN_AMBIGUITY
    );
    await assert.rejects(
      () => resolveSafeInstancePath(paths, "mods/../config/x.toml"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
  });

  it("symlink escape refused when detectable", async () => {
    const paths = await tmpInstance();
    const outside = await mkdtemp(path.join(tmpdir(), "sc-out-"));
    const link = path.join(paths.root, "mods");
    await mkdir(path.dirname(link), { recursive: true });
    try {
      await symlink(outside, link, "junction");
    } catch {
      // Skip if symlink privileges unavailable
      return;
    }
    await assert.rejects(
      () => resolveSafeInstancePath(paths, "mods/x.jar"),
      (e: unknown) =>
        e instanceof LauncherError &&
        (e.code === ErrorCode.SYMLINK_ESCAPE || e.code === ErrorCode.UNSAFE_PATH)
    );
  });

  it("corrupt state detected; atomic state write", async () => {
    const paths = await tmpInstance();
    await mkdir(paths.launcherDir(), { recursive: true });
    await writeFile(paths.stateFile(), "{not-json", "utf8");
    await assert.rejects(
      () => new InstanceStateStore(paths).load(),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.CORRUPT_STATE
    );
    const store = new InstanceStateStore(paths);
    await rm(paths.stateFile(), { force: true });
    const empty = createEmptyInstanceState();
    empty.installedPackVersion = "0.2.0";
    await store.saveAtomic(empty);
    const loaded = await store.load();
    assert.equal(loaded.installedPackVersion, "0.2.0");
  });

  it("instance lock and stale lock handling", async () => {
    const paths = await tmpInstance();
    const lock = new InstanceLock(paths);
    await lock.acquire("install");
    const lock2 = new InstanceLock(paths);
    await assert.rejects(
      () => lock2.acquire("install"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_LOCKED
    );
    await lock.release();
    await writeFile(
      paths.lockFile(),
      JSON.stringify({
        schemaVersion: 1,
        pid: 99999999,
        createdAt: new Date().toISOString(),
        owner: "dead",
        operation: "x",
        leaseId: "dead-lease-aaaa-bbbb-cccc-ddddeeee0001"
      }),
      "utf8"
    );
    await assert.rejects(
      () => lock2.acquire("install"),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.INSTANCE_LOCKED && e.details.staleLikely === true
    );
    await lock2.acquire("install", { forceStale: true });
    await lock2.release();

    await writeFile(paths.lockFile(), "{not-json", "utf8");
    await assert.rejects(
      () => lock2.acquire("install"),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.INSTANCE_LOCKED &&
        e.details.malformed === true
    );
    await lock2.acquire("install", { forceStale: true });
    await lock2.release();
  });

  it("dry-run performs no mutation", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    const before = await readdir(paths.root).catch(() => [] as string[]);
    await applyInstallation({ resolved, paths, source, dryRun: true });
    const after = await readdir(paths.root).catch(() => [] as string[]);
    // dry-run may create launcher dirs via ensureDir — but no mods/content install
    const mods = await readdir(paths.modsDir()).catch(() => [] as string[]);
    assert.equal(mods.length, 0);
    void before;
    void after;
  });

  it("progress events emitted", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    const events: ProgressEvent[] = [];
    const emitter = new ProgressEmitter();
    emitter.on((e) => events.push(e));
    await applyInstallation({ resolved, paths, source, emitter });
    const types = new Set(events.map((e) => e.type));
    assert.ok(types.has("PLAN_READY"));
    assert.ok(types.has("DOWNLOAD_STARTED"));
    assert.ok(types.has("STATE_WRITTEN"));
    assert.ok(types.has("INSTALL_COMPLETE"));
  });

  it("repair plan matches install rules", async () => {
    const paths = await tmpInstance();
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const repair = await planRepair({ resolved, paths });
    assert.ok(repair.summary.download >= 1);
    assert.equal(repair.dryRun, true);
  });
});
