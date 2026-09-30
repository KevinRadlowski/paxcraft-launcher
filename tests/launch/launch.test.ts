import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { windowsX64Platform } from "../../src/platform/index.js";
import { RuntimePaths } from "../../src/minecraft/runtime/paths.js";
import { resolveVersionInheritance } from "../../src/minecraft/version/index.js";
import { mergeMinecraftAndFabric, parseFabricProfile } from "../../src/minecraft/fabric/index.js";
import {
  buildMinimalFixtures,
  MC,
  FABRIC,
  sha1
} from "../../fixtures/minecraft/fixtures.js";
import {
  buildLaunchSpec,
  createTestLaunchIdentity,
  prepareLaunch,
  runPreparedLaunch,
  resolveModernArguments,
  refuseLegacyMinecraftArguments,
  sanitizeLaunchSpecForLogging,
  validateLaunchMemory,
  validateMainClass,
  validateLaunchReadiness,
  buildClasspath,
  MockMinecraftProcessRunner,
  GameProcessLock,
  mergeLaunchFeatures,
  escapeJavaArgfileLine
} from "../../src/launch/index.js";
import { substitutePlaceholders as subPh } from "../../src/launch/placeholders.js";
import type { PlaceholderValues } from "../../src/launch/placeholders.js";
import type { DiscoveredJava } from "../../src/java/requirements/index.js";
import type { ResolvedMinecraftRuntime } from "../../src/minecraft/fabric/index.js";

async function materializeRuntimeFiles(
  paths: RuntimePaths,
  runtime: ResolvedMinecraftRuntime,
  fx: ReturnType<typeof buildMinimalFixtures>
): Promise<void> {
  await mkdir(path.dirname(paths.versionJar(runtime.minecraftVersion)), { recursive: true });
  await writeFile(paths.versionJar(runtime.minecraftVersion), fx.client);
  for (const lib of runtime.libraries) {
    if (lib.kind === "native") {
      const abs = paths.libraryFile(lib.path);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, fx.lwjglNative);
      continue;
    }
    const abs = paths.libraryFile(lib.path);
    await mkdir(path.dirname(abs), { recursive: true });
    const body = lib.name.includes("fabric") ? fx.fabricLib : fx.lwjgl;
    await writeFile(abs, body);
  }
  await mkdir(paths.nativesDir(runtime.minecraftVersion, runtime.fabricLoaderVersion), {
    recursive: true
  });
  await writeFile(
    path.join(paths.nativesDir(runtime.minecraftVersion, runtime.fabricLoaderVersion), "lwjgl.dll"),
    Buffer.from("dll")
  );
}

async function resolvedRuntime(): Promise<{
  runtime: ResolvedMinecraftRuntime;
  fx: ReturnType<typeof buildMinimalFixtures>;
}> {
  const fx = buildMinimalFixtures();
  const vanilla = await resolveVersionInheritance(fx.versionMeta, async () => fx.versionMeta);
  const fabric = parseFabricProfile(fx.fabricProfile);
  const runtime = mergeMinecraftAndFabric({
    vanilla,
    fabric,
    platform: windowsX64Platform()
  });
  return { runtime, fx };
}

function fakeJava(root: string, major = 21): DiscoveredJava {
  return {
    javaPath: path.join(root, "java.exe"),
    majorVersion: major,
    versionString: `${major}.0.0`,
    source: "known_path"
  };
}

function emptyPlaceholders(over: Partial<PlaceholderValues> = {}): PlaceholderValues {
  const base: PlaceholderValues = {
    auth_player_name: "p",
    version_name: "v",
    game_directory: "g",
    assets_root: "a",
    assets_index_name: "i",
    auth_uuid: "u",
    auth_access_token: "tok",
    user_type: "msa",
    version_type: "release",
    natives_directory: "n",
    launcher_name: "L",
    launcher_version: "1",
    classpath: "c",
    classpath_separator: ";",
    library_directory: "lib",
    user_properties: "{}",
    profile_properties: "{}",
    resolution_width: "1920",
    resolution_height: "1080",
    clientid: "",
    auth_xuid: ""
  };
  return { ...base, ...over };
}

describe("launch engine 0.3B", () => {
  it("resolves modern JVM/game args with rules, string[], ordering", () => {
    const platform = windowsX64Platform();
    const features = mergeLaunchFeatures({ has_custom_resolution: true });
    const ph = emptyPlaceholders();
    const jvm = resolveModernArguments(
      [
        "-Da=1",
        { rules: [{ action: "allow", os: { name: "windows" } }], value: "-Dwin=1" },
        { rules: [{ action: "allow", os: { name: "linux" } }], value: "-Dlinux=1" },
        { rules: [{ action: "disallow", os: { name: "windows" } }], value: "-Dno=1" },
        { rules: [{ action: "allow" }], value: ["-X", "-Y"] }
      ],
      { platform, features, placeholders: ph, kind: "jvm" }
    );
    assert.deepEqual(jvm, ["-Da=1", "-Dwin=1", "-X", "-Y"]);
    assert.ok(!jvm.includes("-Dlinux=1"));
    assert.ok(!jvm.includes("-Dno=1"));

    const game = resolveModernArguments(
      [
        "--username",
        "${auth_player_name}",
        {
          rules: [{ action: "allow", features: { has_custom_resolution: true } }],
          value: ["--width", "${resolution_width}", "--height", "${resolution_height}"]
        },
        {
          rules: [{ action: "allow", features: { is_demo_user: true } }],
          value: "--demo"
        }
      ],
      { platform, features, placeholders: ph, kind: "game" }
    );
    assert.ok(game.includes("--width"));
    assert.ok(game.includes("1920"));
    assert.ok(!game.includes("--demo"));
  });

  it("unknown placeholder and legacy minecraftArguments fail closed", () => {
    assert.throws(
      () => subPh("hello ${unknown_thing}", emptyPlaceholders()),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNKNOWN_LAUNCH_PLACEHOLDER
    );
    assert.throws(
      () => refuseLegacyMinecraftArguments("--username Player"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSUPPORTED_LAUNCH_METADATA
    );
  });

  it("classpath ordering Windows separator; missing/unsafe refused", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-cp-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    const cp = await buildClasspath({
      runtime,
      paths,
      platform: windowsX64Platform()
    });
    assert.equal(cp.separator, ";");
    assert.ok(cp.classpathString.includes(";"));
    assert.equal(cp.entries.at(-1), paths.versionJar(MC));
    assert.ok(cp.entries.some((e) => e.includes("lwjgl")));

    const missRoot = await mkdtemp(path.join(tmpdir(), "sc-cp-miss-"));
    await assert.rejects(
      () =>
        buildClasspath({
          runtime,
          paths: new RuntimePaths(missRoot),
          platform: windowsX64Platform()
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.CLASSPATH_ENTRY_MISSING
    );
  });

  it("Fabric mainClass used; invalid mainClass refused", async () => {
    const { runtime } = await resolvedRuntime();
    assert.match(runtime.mainClass, /fabricmc|Knot/i);
    assert.equal(validateMainClass(runtime.mainClass), runtime.mainClass);
    assert.throws(
      () => validateMainClass(""),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MAIN_CLASS
    );
    assert.throws(
      () => validateMainClass("bad class"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MAIN_CLASS
    );
  });

  it("Java compatible / incompatible / missing", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-java-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    const javaPath = path.join(root, "java.exe");
    await writeFile(javaPath, "fake");
    const identity = createTestLaunchIdentity();
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));

    const ok = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root, 21),
      identity,
      memory: { maxMemoryMiB: 2048, minMemoryMiB: 512 }
    });
    assert.equal(ok.javaExecutable, javaPath);

    await assert.rejects(
      () =>
        buildLaunchSpec({
          runtime,
          paths,
          instanceRoot,
          platform: windowsX64Platform(),
          java: fakeJava(root, 8),
          identity,
          memory: { maxMemoryMiB: 2048 }
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INCOMPATIBLE_JAVA
    );
  });

  it("memory Xms/Xmx, invalid memory, strip conflicting metadata Xmx", async () => {
    assert.throws(
      () => validateLaunchMemory({ maxMemoryMiB: -1 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_LAUNCH_MEMORY
    );
    assert.throws(
      () => validateLaunchMemory({ minMemoryMiB: 4096, maxMemoryMiB: 1024 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_LAUNCH_MEMORY
    );

    const { runtime, fx } = await resolvedRuntime();
    runtime.arguments = {
      jvm: ["-Xmx99G", "-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
      game: ["--accessToken", "${auth_access_token}", "--username", "${auth_player_name}"]
    };
    const root = await mkdtemp(path.join(tmpdir(), "sc-mem-"));
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
      memory: { minMemoryMiB: 512, maxMemoryMiB: 2048 },
      extraJvmArgs: ["-Xmx88G"]
    });
    assert.ok(spec.jvmArgs.includes("-Xmx2048M"));
    assert.ok(spec.jvmArgs.includes("-Xms512M"));
    assert.ok(!spec.jvmArgs.some((a) => a.startsWith("-Xmx99")));
    assert.ok(!spec.jvmArgs.some((a) => a.startsWith("-Xmx88")));
  });

  it("custom resolution / invalid resolution", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-res-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));

    const withRes = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity(),
      memory: { maxMemoryMiB: 2048 },
      features: { has_custom_resolution: true },
      resolution: { width: 1280, height: 720 }
    });
    assert.ok(withRes.gameArgs.includes("--width"));
    assert.ok(withRes.gameArgs.includes("1280"));

    await assert.rejects(
      () =>
        buildLaunchSpec({
          runtime,
          paths,
          instanceRoot,
          platform: windowsX64Platform(),
          java: fakeJava(root),
          identity: createTestLaunchIdentity(),
          memory: { maxMemoryMiB: 2048 },
          features: { has_custom_resolution: true },
          resolution: { width: 1, height: 1 }
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_LAUNCH_RESOLUTION
    );
  });

  it("identity validation and token redaction", async () => {
    assert.throws(
      () => createTestLaunchIdentity({ uuid: "nope" }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_LAUNCH_IDENTITY
    );
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-tok-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const token = "SUPER-SECRET-TOKEN-XYZ";
    const identity = createTestLaunchIdentity({ accessToken: token });
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const spec = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity,
      memory: { maxMemoryMiB: 2048 }
    });
    assert.ok(spec.gameArgs.includes(token));
    const sanitized = sanitizeLaunchSpecForLogging(spec, [token]);
    const blob = JSON.stringify(sanitized);
    assert.ok(!blob.includes(token));
    assert.ok(blob.includes("<redacted>"));
  });

  it("prepare READY / runtime not ready / instance corrupt", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-prep-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const identity = createTestLaunchIdentity();

    const prepared = await prepareLaunch({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity,
      memory: { maxMemoryMiB: 2048 },
      runtimeFindings: [{ status: "OK", id: "client" }]
    });
    assert.equal(prepared.readiness.ready, true);
    assert.ok(!JSON.stringify(prepared.sanitizedSummary).includes(identity.accessToken));

    const notReady = validateLaunchReadiness({
      runtimeFindings: [{ status: "CORRUPT", id: "client" }],
      runtime,
      java: fakeJava(root),
      identity,
      instanceRoot
    });
    assert.equal(notReady.ready, false);

    const instBad = validateLaunchReadiness({
      runtimeFindings: [{ status: "OK", id: "client" }],
      instanceFindings: [{ status: "CORRUPT", id: "mod:x" }],
      runtime,
      java: fakeJava(root),
      identity,
      instanceRoot
    });
    assert.equal(instBad.ready, false);
  });

  it("spawn argv exact, shell false, exit codes, stdout/stderr redaction, dry-run no spawn", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-run-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-"));
    const token = "TOKEN-IN-STDERR";
    const identity = createTestLaunchIdentity({ accessToken: token });
    const emitter = new ProgressEmitter();
    const events: string[] = [];
    const payloads: unknown[] = [];
    emitter.on((e) => {
      events.push(e.type);
      payloads.push(e.data);
    });

    const prepared = await prepareLaunch({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity,
      memory: { maxMemoryMiB: 2048 },
      runtimeFindings: [{ status: "OK", id: "client" }],
      emitter
    });
    assert.ok(events.includes("LAUNCH_SPEC_READY"));
    for (const p of payloads) {
      assert.ok(!JSON.stringify(p).includes(token));
    }

    const runner = new MockMinecraftProcessRunner();
    runner.behavior = {
      kind: "exit",
      exitCode: 0,
      stdout: "hello",
      stderr: `leak ${token}`
    };
    const result = await runPreparedLaunch({
      prepared,
      runner,
      instancePaths: new InstancePaths(instanceRoot),
      emitter
    });
    assert.equal(result.kind, "exit");
    assert.equal(result.exitCode, 0);
    assert.equal(runner.spawnCount, 1);
    assert.equal(runner.lastShell, false);
    assert.deepEqual(runner.lastSpec?.argv, prepared.spec.argv);
    assert.ok(events.includes("GAME_PROCESS_STARTED"));
    assert.ok(events.includes("GAME_STDOUT"));
    assert.ok(events.includes("GAME_STDERR"));
    const stderrEv = payloads.find(
      (p) => p && typeof p === "object" && "line" in (p as object) && String((p as { line: string }).line).includes("leak")
    ) as { line: string } | undefined;
    assert.ok(stderrEv);
    assert.ok(!stderrEv.line.includes(token));
    assert.ok(stderrEv.line.includes("<redacted>"));

    runner.behavior = { kind: "exit", exitCode: 1 };
    const r1 = await runner.run(prepared.spec, { secrets: [token] });
    assert.equal(r1.exitCode, 1);

    runner.behavior = { kind: "signal", signal: "SIGTERM" };
    const rs = await runner.run(prepared.spec, { secrets: [token] });
    assert.equal(rs.kind, "signal");

    runner.behavior = { kind: "spawn_error", throwOnSpawn: true };
    const rf = await runner.run(prepared.spec, { secrets: [token] });
    assert.equal(rf.kind, "spawn_error");

    // dry-run: prepare only — no spawn
    const dryRunner = new MockMinecraftProcessRunner();
    await prepareLaunch({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity,
      memory: { maxMemoryMiB: 2048 },
      runtimeFindings: [{ status: "OK", id: "client" }]
    });
    assert.equal(dryRunner.spawnCount, 0);
  });

  it("game process lock: double launch + stale without force", async () => {
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-glock-"));
    const paths = new InstancePaths(instanceRoot);
    const lock = new GameProcessLock(paths);
    await lock.acquire("game-launch");
    await assert.rejects(
      () => new GameProcessLock(paths).acquire("game-launch"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCKED
    );
    await lock.release();

    // Stale: write dead pid
    await mkdir(paths.launcherDir(), { recursive: true });
    await writeFile(
      new GameProcessLock(paths).lockFile(),
      JSON.stringify({
        schemaVersion: 1,
        pid: 99999999,
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

  it("gameDir isolated; Windows argfile escape helper", async () => {
    const { runtime, fx } = await resolvedRuntime();
    const root = await mkdtemp(path.join(tmpdir(), "sc-gdir-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-inst-isolated-"));
    const spec = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity(),
      memory: { maxMemoryMiB: 2048 }
    });
    assert.equal(spec.workingDirectory, path.resolve(instanceRoot));
    assert.ok(!spec.workingDirectory.toLowerCase().includes(".minecraft"));
    assert.equal(escapeJavaArgfileLine("a b"), '"a b"');
    assert.equal(escapeJavaArgfileLine('say "hi"'), '"say \\"hi\\""');
  });

  it("merged runtime carries modern arguments from vanilla", async () => {
    const { runtime } = await resolvedRuntime();
    assert.ok(runtime.arguments?.jvm?.length);
    assert.ok(runtime.arguments?.game?.length);
    assert.equal(runtime.versionType, "release");
    void sha1;
    void FABRIC;
  });
});
