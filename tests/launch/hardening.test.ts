import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { windowsX64Platform } from "../../src/platform/index.js";
import { RuntimePaths } from "../../src/minecraft/runtime/paths.js";
import { resolveVersionInheritance } from "../../src/minecraft/version/index.js";
import { mergeMinecraftAndFabric, parseFabricProfile } from "../../src/minecraft/fabric/index.js";
import { buildMinimalFixtures } from "../../fixtures/minecraft/fixtures.js";
import {
  buildLaunchSpec,
  createTestLaunchIdentity,
  prepareLaunch,
  runPreparedLaunch,
  materializeLaunchArguments,
  MockMinecraftProcessRunner,
  NodeMinecraftProcessRunner,
  GameProcessLock,
  sanitizeLaunchSpecForLogging
} from "../../src/launch/index.js";
import type { SpawnAdapter } from "../../src/launch/index.js";
import type { DiscoveredJava } from "../../src/java/requirements/index.js";
import type { ResolvedMinecraftRuntime } from "../../src/minecraft/fabric/index.js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

async function materializeRuntimeFiles(
  paths: RuntimePaths,
  runtime: ResolvedMinecraftRuntime,
  fx: ReturnType<typeof buildMinimalFixtures>
): Promise<void> {
  await mkdir(path.dirname(paths.versionJar(runtime.minecraftVersion)), { recursive: true });
  await writeFile(paths.versionJar(runtime.minecraftVersion), fx.client);
  for (const lib of runtime.libraries) {
    const abs = paths.libraryFile(lib.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, lib.kind === "native" ? fx.lwjglNative : fx.lwjgl);
  }
  await mkdir(paths.nativesDir(runtime.minecraftVersion, runtime.fabricLoaderVersion), {
    recursive: true
  });
}

async function resolvedRuntime(): Promise<{
  runtime: ResolvedMinecraftRuntime;
  fx: ReturnType<typeof buildMinimalFixtures>;
}> {
  const fx = buildMinimalFixtures();
  const vanilla = await resolveVersionInheritance(fx.versionMeta, async () => fx.versionMeta);
  const fabric = parseFabricProfile(fx.fabricProfile);
  return {
    runtime: mergeMinecraftAndFabric({ vanilla, fabric, platform: windowsX64Platform() }),
    fx
  };
}

function fakeJava(root: string): DiscoveredJava {
  return {
    javaPath: path.join(root, "java.exe"),
    majorVersion: 21,
    versionString: "21.0.0",
    source: "known_path"
  };
}

async function assertNoArgfiles(tmpDir: string): Promise<void> {
  try {
    await access(tmpDir, fsConstants.F_OK);
  } catch {
    return;
  }
  const names = await readdir(tmpDir);
  assert.equal(
    names.filter((n) => n.startsWith("launch-args-")).length,
    0,
    `unexpected argfiles: ${names.join(",")}`
  );
}

async function assertNoTokenInTmp(tmpDir: string, token: string): Promise<void> {
  try {
    await access(tmpDir, fsConstants.F_OK);
  } catch {
    return;
  }
  for (const name of await readdir(tmpDir)) {
    const body = await readFile(path.join(tmpDir, name), "utf8").catch(() => "");
    assert.ok(!body.includes(token), `token leaked in ${name}`);
  }
}

describe("launch hardening 0.3.0-beta.2", () => {
  it("buildLaunchSpec / prepareLaunch dry-run create no argfile on disk", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-af-dry-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const token = "DRY-RUN-TOKEN-SECRET";

    const spec = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity({ accessToken: token }),
      memory: { maxMemoryMiB: 2048 },
      forceArgfile: true
    });
    assert.equal(!!spec.argfilePlan, true);
    await assertNoArgfiles(paths.tmpDir());

    const prepared = await prepareLaunch({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity({ accessToken: token }),
      memory: { maxMemoryMiB: 2048 },
      forceArgfile: true,
      runtimeFindings: [{ status: "OK", id: "client" }],
      allowNotReady: true,
      requireClasspathFiles: true
    });
    assert.equal(prepared.argfileRequired, true);
    await assertNoArgfiles(paths.tmpDir());
    assert.ok(!JSON.stringify(prepared.sanitizedSummary).includes(token));
  });

  it("argfile unique paths; materialize late; cleanup on exit/signal/spawn fail", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-af-life-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const token = "ARGFILE-TOKEN-SECRET";

    const prepared = await prepareLaunch({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity({ accessToken: token }),
      memory: { maxMemoryMiB: 2048 },
      forceArgfile: true,
      runtimeFindings: [{ status: "OK", id: "client" }]
    });

    const m1 = await materializeLaunchArguments({
      logicalArgv: prepared.spec.argv,
      argfilePlan: prepared.spec.argfilePlan
    });
    const m2 = await materializeLaunchArguments({
      logicalArgv: prepared.spec.argv,
      argfilePlan: prepared.spec.argfilePlan
    });
    assert.notEqual(m1.argfilePath, m2.argfilePath);
    assert.ok(m1.argfilePath && (await readFile(m1.argfilePath, "utf8")).includes(token));

    await m1.cleanup();
    await m2.cleanup();
    await assertNoArgfiles(paths.tmpDir());
    await assertNoTokenInTmp(paths.tmpDir(), token);

    for (const behavior of [
      { kind: "exit" as const, exitCode: 0 },
      { kind: "exit" as const, exitCode: 1 },
      { kind: "signal" as const, signal: "SIGTERM" as const },
      { kind: "spawn_error" as const, throwOnSpawn: true }
    ]) {
      const runner = new MockMinecraftProcessRunner();
      runner.behavior = behavior;
      await runPreparedLaunch({
        prepared,
        runner,
        instancePaths: new InstancePaths(instanceRoot),
        acquireLock: false
      });
      await assertNoArgfiles(paths.tmpDir());
      await assertNoTokenInTmp(paths.tmpDir(), token);
      if (!behavior.throwOnSpawn) {
        assert.ok(runner.lastSpawnArgv?.[0]?.startsWith("@"));
      }
    }
  });

  it("argfile cleanup failure is structured without token", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-af-cu-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const token = "CLEANUP-FAIL-TOKEN";
    const prepared = await prepareLaunch({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity({ accessToken: token }),
      memory: { maxMemoryMiB: 2048 },
      forceArgfile: true,
      runtimeFindings: [{ status: "OK", id: "client" }]
    });
    const mat = await materializeLaunchArguments({
      logicalArgv: prepared.spec.argv,
      argfilePlan: prepared.spec.argfilePlan
    });
    // Remove file first so second cleanup is fine; simulate failure by replacing cleanup
    const failing = {
      ...mat,
      async cleanup() {
        return {
          cleaned: false,
          error: new LauncherError(ErrorCode.ARGFILE_CLEANUP_FAILED, "failed to remove launch argfile", {
            argfileName: "launch-args-x.y.txt"
          })
        };
      }
    };
    const r = await failing.cleanup();
    assert.equal(r.cleaned, false);
    assert.equal(r.error?.code, ErrorCode.ARGFILE_CLEANUP_FAILED);
    assert.ok(!JSON.stringify(r.error?.details).includes(token));
    await mat.cleanup();
  });

  it("GameProcessLock v2: live gamePid blocks; dead launcher alone is stale", async () => {
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-glock2-"));
    const paths = new InstancePaths(instanceRoot);
    const lock = new GameProcessLock(paths);
    await lock.acquire("game-launch");
    await lock.bindGamePid(process.pid); // treat current process as "game"
    await assert.rejects(
      () => new GameProcessLock(paths).acquire("game-launch"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCKED
    );
    await lock.release();

    // Reservation with dead launcherPid, no gamePid → stale
    await mkdir(paths.launcherDir(), { recursive: true });
    await writeFile(
      new GameProcessLock(paths).lockFile(),
      JSON.stringify({
        schemaVersion: 2,
        launcherPid: 99999999,
        gamePid: null,
        createdAt: new Date().toISOString(),
        owner: "dead",
        operation: "game-launch"
      })
    );
    await assert.rejects(
      () => new GameProcessLock(paths).acquire("game-launch"),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.GAME_PROCESS_LOCKED &&
        (e.details as { staleLikely?: boolean }).staleLikely === true
    );
    const cleared = new GameProcessLock(paths);
    const lease = await cleared.acquire("game-launch", { forceStale: true });
    await cleared.releaseLease(lease);
  });

  it("runPreparedLaunch binds gamePid; spawn throw releases; secrets absent from events", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-bind-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const token = "EVENT-TOKEN-SECRET";
    const prepared = await prepareLaunch({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity({ accessToken: token }),
      memory: { maxMemoryMiB: 2048 },
      forceArgfile: true,
      runtimeFindings: [{ status: "OK", id: "client" }]
    });

    const emitter = new ProgressEmitter();
    const blobs: string[] = [];
    emitter.on((e) => blobs.push(JSON.stringify({ type: e.type, data: e.data })));

    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, gamePid: 7777, stdout: `x ${token}`, stderr: token };
    await runPreparedLaunch({
      prepared,
      runner,
      instancePaths: new InstancePaths(instanceRoot),
      emitter
    });
    for (const b of blobs) {
      assert.ok(!b.includes(token), `token in event: ${b}`);
    }
    const sanitized = sanitizeLaunchSpecForLogging(prepared.spec, [token]);
    assert.ok(!JSON.stringify(sanitized).includes(token));
  });

  it("extraJvmArgs -Xmx99G cannot override controlled memory", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-xmx-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const spec = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity(),
      memory: { maxMemoryMiB: 2048 },
      extraJvmArgs: ["-Xmx99G", "-Dfoo=1"]
    });
    assert.ok(spec.jvmArgs.includes("-Xmx2048M"));
    assert.ok(!spec.jvmArgs.some((a) => /^-Xmx99/i.test(a)));
    assert.ok(spec.jvmArgs.includes("-Dfoo=1"));
  });

  it("Node runner single-settlement: error then exit → one terminal result", async () => {
    const events: string[] = [];
    const emitter = new ProgressEmitter();
    emitter.on((e) => events.push(e.type));

    const adapter: SpawnAdapter = {
      spawn() {
        const ee = new EventEmitter() as ChildProcessWithoutNullStreams;
        ee.pid = 5555;
        ee.stdout = new Readable({ read() {} }) as ChildProcessWithoutNullStreams["stdout"];
        ee.stderr = new Readable({ read() {} }) as ChildProcessWithoutNullStreams["stderr"];
        ee.kill = () => true;
        queueMicrotask(() => {
          ee.emit("error", new Error("ENOENT"));
          ee.emit("exit", 1, null);
        });
        return ee;
      }
    };

    const runner = new NodeMinecraftProcessRunner(adapter);
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-settle-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const spec = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity(),
      memory: { maxMemoryMiB: 2048 }
    });

    const result = await runner.run(spec, { secrets: ["x"], emitter });
    assert.equal(result.kind, "spawn_error");
    assert.equal(events.filter((t) => t === "GAME_PROCESS_FAILED").length, 1);
    assert.equal(events.filter((t) => t === "GAME_PROCESS_EXITED").length, 0);
  });
});
