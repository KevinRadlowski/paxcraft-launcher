import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import {
  GameProcessLock,
  gameProcessLockTestHooks,
  isPidAlive,
  MockMinecraftProcessRunner,
  NodeMinecraftProcessRunner,
  type LaunchSpec,
  type SpawnAdapter
} from "../../src/launch/index.js";
import {
  installInstance,
  updateInstance,
  repairInstance,
  startGame
} from "../../src/application/index.js";
import type { AccountRecord } from "../../src/auth/account.js";
import type { AccountRegistry } from "../../src/auth/accountsFile.js";
import { InMemoryAccountRegistry } from "../../src/auth/account.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createPlayTestEnv,
  buildPlayDeps,
  seedAccountA
} from "../../fixtures/playHarness.js";
import { DEFAULT_LAUNCH_FEATURES } from "../../src/launch/features.js";

function deadPid(): number {
  for (let p = 48_000_000; p < 48_000_200; p++) {
    if (!isPidAlive(p)) return p;
  }
  throw new Error("could not find dead pid");
}

function minimalSpec(): LaunchSpec {
  return {
    javaExecutable: "java",
    workingDirectory: process.cwd(),
    mainClass: "x",
    classpathEntries: [],
    jvmArgs: [],
    gameArgs: [],
    argv: ["-version"],
    environment: {},
    nativesDirectory: process.cwd(),
    memory: { maxMemoryMiB: 512 },
    features: DEFAULT_LAUNCH_FEATURES,
    metadata: {
      minecraftVersion: "1",
      fabricLoaderVersion: "1",
      versionType: "release",
      assetsIndexName: "1",
      launcherName: "test",
      launcherVersion: "0"
    }
  };
}

function fakeChild(pid: number): ChildProcessWithoutNullStreams & {
  emitExit: (code: number | null, signal?: NodeJS.Signals | null) => void;
  emitProcError: (err: Error) => void;
} {
  const ee = new EventEmitter() as ChildProcessWithoutNullStreams & {
    emitExit: (code: number | null, signal?: NodeJS.Signals | null) => void;
    emitProcError: (err: Error) => void;
  };
  ee.pid = pid;
  ee.stdout = new Readable({ read() {} }) as ChildProcessWithoutNullStreams["stdout"];
  ee.stderr = new Readable({ read() {} }) as ChildProcessWithoutNullStreams["stderr"];
  ee.kill = () => true;
  ee.emitExit = (code, signal = null) => {
    ee.emit("exit", code, signal);
  };
  ee.emitProcError = (err) => {
    ee.emit("error", err);
  };
  return ee;
}

/** Registry that throws only when lastUsedAtMs is being updated after spawn. */
class LastUsedFailRegistry implements AccountRegistry {
  constructor(
    private readonly inner: InMemoryAccountRegistry,
    private readonly failSecret: string
  ) {}
  list(): AccountRecord[] {
    return this.inner.list();
  }
  get(accountId: string): AccountRecord | undefined {
    return this.inner.get(accountId);
  }
  upsert(record: AccountRecord): void {
    const prev = this.inner.get(record.accountId);
    if (prev && record.lastUsedAtMs !== prev.lastUsedAtMs) {
      throw new Error(`DISK_FULL ${this.failSecret}`);
    }
    this.inner.upsert(record);
  }
}

describe("0.5.0-beta.3 post-spawn ownership + runner race", { concurrency: 1 }, () => {
  it("lastUsed failure after spawn does not fail PLAY; keeps lock; blocks mutate/PLAY; completion releases", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b3-lu-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, gamePid: process.pid, deferExit: true };
    const built = await buildPlayDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust,
      runner
    });
    const secret = "C:\\Users\\secret\\accounts.json";
    const failingAccounts = new LastUsedFailRegistry(built.accounts, secret);
    built.deps.accounts = failingAccounts;
    built.deps.auth.accounts = failingAccounts;

    const warnings: Array<Record<string, unknown>> = [];
    const emitter = built.deps.emitter ?? new ProgressEmitter();
    built.deps.emitter = emitter;
    emitter.on((e) => {
      if (e.type === "PLAY_ACCOUNT_METADATA_WARNING") warnings.push(e.data);
    });

    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      runtimePath: env.runtimePath
    };
    await installInstance(
      { ...req, operation: "install", skipRuntimePrep: true },
      {
        http,
        trust: bundle.trust,
        artefactSource: source,
        antiRollbackStore: built.deps.antiRollbackStore,
        antiRollbackState: built.deps.antiRollbackState
      }
    );
    await seedAccountA(built.accounts, built.secure, { lastUsedAtMs: 55 });

    const game = await startGame(req, built.deps);
    assert.ok(game.gamePid);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.reason, "last_used_persist_failed");
    assert.ok(!JSON.stringify(warnings).includes(secret));
    assert.ok(!JSON.stringify(warnings).includes("DISK_FULL"));

    const lock = new GameProcessLock(new InstancePaths(env.instancePath));
    assert.equal(await lock.inspect(), "ACTIVE");

    await assert.rejects(
      () =>
        updateInstance(
          { ...req, operation: "update", skipRuntimePrep: true },
          {
            http,
            trust: bundle.trust,
            artefactSource: source,
            antiRollbackStore: built.deps.antiRollbackStore,
            antiRollbackState: built.deps.antiRollbackState
          }
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );
    await assert.rejects(
      () =>
        repairInstance(
          { ...req, operation: "repair", skipRuntimePrep: true },
          {
            http,
            trust: bundle.trust,
            artefactSource: source,
            antiRollbackStore: built.deps.antiRollbackStore,
            antiRollbackState: built.deps.antiRollbackState
          }
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );

    assert.equal((await built.accounts.get(game.accountId))?.lastUsedAtMs, 55);

    runner.releaseDeferredExit();
    await game.completion;
    assert.equal(await lock.inspect(), "ABSENT");
  });

  it("throwing RUNNING / CLEANUP listeners cannot drop ownership or skip lock release", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b3-ev-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, gamePid: process.pid, deferExit: true };
    const built = await buildPlayDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust,
      runner
    });
    const emitter = new ProgressEmitter();
    built.deps.emitter = emitter;
    emitter.on((e) => {
      if (e.type === "PLAY_PROGRESS" && e.data.phase === "RUNNING") {
        throw new Error("hostile RUNNING listener");
      }
      if (e.type === "PLAY_PROGRESS" && e.data.phase === "CLEANUP") {
        throw new Error("hostile CLEANUP listener");
      }
      if (e.type === "PLAY_PROGRESS" && e.data.phase === "GAME_EXITED") {
        throw new Error("hostile GAME_EXITED listener");
      }
    });

    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      runtimePath: env.runtimePath
    };
    await installInstance(
      { ...req, operation: "install", skipRuntimePrep: true },
      {
        http,
        trust: bundle.trust,
        artefactSource: source,
        antiRollbackStore: built.deps.antiRollbackStore,
        antiRollbackState: built.deps.antiRollbackState
      }
    );
    await seedAccountA(built.accounts, built.secure);

    const game = await startGame(req, built.deps);
    const lock = new GameProcessLock(new InstancePaths(env.instancePath));
    assert.equal(await lock.inspect(), "ACTIVE");

    runner.releaseDeferredExit();
    await game.completion;
    assert.equal(await lock.inspect(), "ABSENT");
  });

  it("exit while onSpawned pending + bind success → start after bind; completion has exit", async () => {
    let resolveBind!: () => void;
    const bindGate = new Promise<void>((r) => {
      resolveBind = r;
    });
    let child: ReturnType<typeof fakeChild> | null = null;
    const adapter: SpawnAdapter = {
      spawn() {
        child = fakeChild(7771);
        return child;
      }
    };
    const runner = new NodeMinecraftProcessRunner(adapter);
    const startP = runner.start(minimalSpec(), {
      secrets: [],
      onSpawned: async () => {
        await bindGate;
      }
    });

    await new Promise((r) => setTimeout(r, 5));
    assert.ok(child);
    child!.emitExit(1, null);
    resolveBind();

    const started = await startP;
    assert.equal(started.gamePid, 7771);
    const result = await started.completion;
    assert.equal(result.kind, "exit");
    assert.equal(result.exitCode, 1);
  });

  it("exit while onSpawned pending + bind failure → start rejects; exit cannot swallow bind", async () => {
    let resolveBind!: (err: Error) => void;
    const bindGate = new Promise<Error>((r) => {
      resolveBind = r;
    });
    let child: ReturnType<typeof fakeChild> | null = null;
    const adapter: SpawnAdapter = {
      spawn() {
        child = fakeChild(7772);
        return child;
      }
    };
    const runner = new NodeMinecraftProcessRunner(adapter);
    const startP = runner.start(minimalSpec(), {
      secrets: [],
      onSpawned: async () => {
        const err = await bindGate;
        throw err;
      }
    });

    await new Promise((r) => setTimeout(r, 5));
    assert.ok(child);
    child!.emitExit(0, null);
    resolveBind(new Error("bind boom"));

    await assert.rejects(
      () => startP,
      (e: unknown) => e instanceof Error && e.message === "bind boom"
    );
  });

  it("terminal settlement remains exactly once (error then exit)", async () => {
    const events: string[] = [];
    const emitter = new ProgressEmitter();
    emitter.on((e) => events.push(e.type));
    const adapter: SpawnAdapter = {
      spawn() {
        const ee = fakeChild(5555);
        queueMicrotask(() => {
          ee.emitProcError(new Error("ENOENT"));
          ee.emitExit(1, null);
        });
        return ee;
      }
    };
    const runner = new NodeMinecraftProcessRunner(adapter);
    const result = await runner.run(minimalSpec(), { secrets: ["x"], emitter });
    assert.equal(result.kind, "spawn_error");
    assert.equal(events.filter((t) => t === "GAME_PROCESS_FAILED").length, 1);
    assert.equal(events.filter((t) => t === "GAME_PROCESS_EXITED").length, 0);
  });

  it("force-stale takeover vs late release race preserves new lease", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-b3-race-"));
    await mkdir(path.join(root, "launcher"), { recursive: true });
    const paths = new InstancePaths(root);

    const lockA = new GameProcessLock(paths);
    const leaseA = await lockA.acquire("play-a");
    await lockA.bindGamePid(leaseA, deadPid()); // STALE once gamePid dead

    let releaseContinue!: () => void;
    const hold = new Promise<void>((r) => {
      releaseContinue = r;
    });
    let releaseEnteredResolve!: () => void;
    const entered = new Promise<void>((r) => {
      releaseEnteredResolve = r;
    });
    gameProcessLockTestHooks.afterReleaseOwnershipVerified = async () => {
      releaseEnteredResolve();
      await hold;
    };

    try {
      const releaseP = lockA.releaseLease(leaseA);
      await entered;

      const lockB = new GameProcessLock(paths);
      const acquireP = lockB.acquire("play-b", { forceStale: true });

      await new Promise((r) => setTimeout(r, 30));
      releaseContinue();
      await releaseP.catch(() => undefined);
      const leaseB = await acquireP;

      const detailed = await lockB.inspectDetailed();
      assert.equal(detailed.status, "ACTIVE");
      if (detailed.status === "ACTIVE") {
        assert.equal(detailed.lock.leaseId, leaseB.leaseId);
      }

      await assert.rejects(() => lockA.releaseLease(leaseA));
      const again = await lockB.inspectDetailed();
      assert.equal(again.status, "ACTIVE");
      if (again.status === "ACTIVE") {
        assert.equal(again.lock.leaseId, leaseB.leaseId);
      }

      await lockB.releaseLease(leaseB);
    } finally {
      delete gameProcessLockTestHooks.afterReleaseOwnershipVerified;
    }
  });
});
