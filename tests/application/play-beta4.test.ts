import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { InstanceLock, inspectInstanceLock } from "../../src/instance/lock/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import {
  GameProcessLock,
  isPidAlive,
  MockMinecraftProcessRunner
} from "../../src/launch/index.js";
import {
  installInstance,
  updateInstance,
  startGame,
  releaseGameProcessLockCoordinated
} from "../../src/application/index.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createPlayTestEnv,
  buildPlayDeps,
  seedAccountA,
  testNetworkPolicy
} from "../../fixtures/playHarness.js";

const workerPath = fileURLToPath(
  new URL("../fixtures/crossProcessGameLockWorker.ts", import.meta.url)
);

function deadPid(): number {
  for (let p = 46_000_000; p < 46_000_200; p++) {
    if (!isPidAlive(p)) return p;
  }
  throw new Error("no dead pid");
}

async function forkWorker(
  syncDir: string,
  cfg: Record<string, unknown>
): Promise<ChildProcess> {
  const cfgPath = path.join(syncDir, `cfg-${cfg.role}-${Date.now()}-${Math.random()}.json`);
  await writeFile(cfgPath, JSON.stringify(cfg), "utf8");
  const child = fork(workerPath, [cfgPath], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  child.stderr?.on("data", (buf: Buffer) => {
    // surface worker crashes into test runner output when debugging
    process.stderr.write(buf);
  });
  return child;
}

function waitMsg(
  child: ChildProcess,
  type: string,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      child.off("message", onMsg);
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);
    const onMsg = (msg: Record<string, unknown>) => {
      if (msg?.type === "error") {
        clearTimeout(t);
        child.off("message", onMsg);
        reject(new Error(String(msg.message)));
        return;
      }
      if (msg?.type === type) {
        clearTimeout(t);
        child.off("message", onMsg);
        resolve(msg);
      }
    };
    child.on("message", onMsg);
    child.on("exit", (code) => {
      if (code && code !== 0) {
        clearTimeout(t);
        reject(new Error(`worker exited ${code} while waiting for ${type}`));
      }
    });
  });
}

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((r) => child.once("exit", () => r()));
}

describe("0.5.0-beta.4 cross-process GameProcessLock", { concurrency: 1 }, () => {
  it("cross-process: A holds InstanceLock during release → B takeover yields surviving B", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-b4-xp-"));
    const instancePath = path.join(root, "instance");
    const syncDir = path.join(root, "sync");
    await mkdir(path.join(instancePath, "launcher"), { recursive: true });
    await mkdir(syncDir, { recursive: true });

    const childA = await forkWorker(syncDir, { role: "release-hold", instancePath, syncDir });
    await waitMsg(childA, "ready");
    await waitMsg(childA, "holding");

    const childB = await forkWorker(syncDir, { role: "force-take", instancePath, syncDir });
    await new Promise((r) => setTimeout(r, 100));
    childA.send({ type: "continue" });

    const doneA = await waitMsg(childA, "done");
    assert.equal(doneA.outcome, "released");

    const doneB = await waitMsg(childB, "done");
    const leaseB = JSON.parse(await readFile(path.join(syncDir, "lease-b.json"), "utf8")) as {
      leaseId: string;
    };
    assert.equal(doneB.leaseId, leaseB.leaseId);

    const lock = new GameProcessLock(new InstancePaths(instancePath));
    const insp = await lock.inspectDetailed();
    assert.equal(insp.status, "ACTIVE");
    if (insp.status === "ACTIVE") {
      assert.equal(insp.lock.leaseId, leaseB.leaseId);
    }

    // Release B only after ACTIVE assertion — B held alive so launcherPid stays live.
    childB.send({ type: "continue" });
    await waitExit(childA);
    await waitExit(childB);
  });

  it("cross-process: B force-takes first → late A release cannot unlink B", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-b4-xp2-"));
    const instancePath = path.join(root, "instance");
    const syncDir = path.join(root, "sync");
    await mkdir(path.join(instancePath, "launcher"), { recursive: true });
    await mkdir(syncDir, { recursive: true });

    const childA = await forkWorker(syncDir, {
      role: "release-after-b",
      instancePath,
      syncDir
    });
    await waitMsg(childA, "ready");

    const childB = await forkWorker(syncDir, { role: "force-take", instancePath, syncDir });
    const doneB = await waitMsg(childB, "done");

    const doneA = await waitMsg(childA, "done");
    assert.ok(
      doneA.outcome === "ownership_mismatch" || doneA.outcome === "already_absent"
    );
    const leaseB = JSON.parse(await readFile(path.join(syncDir, "lease-b.json"), "utf8")) as {
      leaseId: string;
    };
    assert.equal(doneB.leaseId, leaseB.leaseId);
    assert.equal(doneA.finalLeaseId, leaseB.leaseId);
    // B stays alive until continue — reservation with live launcherPid is ACTIVE.
    assert.equal(doneA.finalStatus, "ACTIVE");
    assert.notEqual(doneA.finalStatus, "ABSENT");

    childB.send({ type: "continue" });
    await waitExit(childA);
    await waitExit(childB);
  });

  it("completion coordinated release; normal exit removes own lock", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b4-ok-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, gamePid: process.pid };
    const built = await buildPlayDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust,
      runner
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
        antiRollbackState: built.deps.antiRollbackState,
        ...testNetworkPolicy()
      }
    );
    await seedAccountA(built.accounts, built.secure);
    const game = await startGame(req, built.deps);
    await game.completion;
    assert.equal(await new GameProcessLock(new InstancePaths(env.instancePath)).inspect(), "ABSENT");
  });

  it("InstanceLock busy → deferred cleanup; stale blocks UPDATE; force PLAY clears", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b4-busy-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const built = await buildPlayDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust
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
        antiRollbackState: built.deps.antiRollbackState,
        ...testNetworkPolicy()
      }
    );

    const paths = new InstancePaths(env.instancePath);
    const instanceLock = new InstanceLock(paths);
    const gameLock = new GameProcessLock(paths);
    const seed = await instanceLock.acquire("seed", { owner: "seed" });
    const leaseA = await gameLock.acquire("play-a");
    await gameLock.bindGamePid(leaseA, deadPid());
    await instanceLock.releaseLease(seed);

    const busy = await instanceLock.acquire("mutate", { owner: "busy-op" });
    const warnings: Array<Record<string, unknown>> = [];
    const emitter = new ProgressEmitter();
    emitter.on((e) => {
      if (e.type === "PLAY_CLEANUP_WARNING") warnings.push(e.data);
    });

    const outcome = await releaseGameProcessLockCoordinated({
      paths,
      gameLease: leaseA,
      operationId: "cleanup-test",
      emitter,
      retry: { attempts: 3, delayMs: 10 }
    });
    assert.equal(outcome, "deferred");
    assert.equal(warnings[0]?.reason, "game_lock_release_deferred");
    assert.ok(!JSON.stringify(warnings).includes("lock.json"));

    const insp = await gameLock.inspectDetailed();
    assert.ok(insp.status === "STALE" || insp.status === "ACTIVE");
    if (insp.status === "STALE" || insp.status === "ACTIVE") {
      assert.equal(insp.lock.leaseId, leaseA.leaseId);
    }

    await instanceLock.releaseLease(busy);

    await assert.rejects(
      () =>
        updateInstance(
          { ...req, operation: "update", skipRuntimePrep: true },
          {
            http,
            trust: bundle.trust,
            artefactSource: source,
            antiRollbackStore: built.deps.antiRollbackStore,
            antiRollbackState: built.deps.antiRollbackState,
        ...testNetworkPolicy()
          }
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );

    await seedAccountA(built.accounts, built.secure);
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, gamePid: process.pid };
    built.deps.runner = runner;
    const game = await startGame({ ...req, forceStaleGameLock: true }, built.deps);
    await game.completion;
    assert.equal(await gameLock.inspect(), "ABSENT");
  });

  it("coordinated release uses exact InstanceLock lease (game-cleanup)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-b4-lease-"));
    await mkdir(path.join(root, "launcher"), { recursive: true });
    const paths = new InstancePaths(root);
    const gameLock = new GameProcessLock(paths);
    const instanceLock = new InstanceLock(paths);
    const seed = await instanceLock.acquire("seed");
    const lease = await gameLock.acquire("play");
    await instanceLock.releaseLease(seed);

    let sawCleanupOp = false;
    const outcome = await releaseGameProcessLockCoordinated({
      paths,
      gameLease: lease,
      operationId: "exact-lease",
      afterOwnershipVerifiedUnderInstanceLock: async () => {
        const raw = await readFile(paths.lockFile(), "utf8");
        const info = JSON.parse(raw) as { operation: string; leaseId: string };
        assert.equal(info.operation, "game-cleanup");
        assert.ok(typeof info.leaseId === "string" && info.leaseId.length >= 8);
        sawCleanupOp = true;
      }
    });
    assert.equal(outcome, "released");
    assert.equal(sawCleanupOp, true);
    assert.equal(await gameLock.inspect(), "ABSENT");
    assert.equal((await inspectInstanceLock(paths)).kind, "ABSENT");
  });
});
