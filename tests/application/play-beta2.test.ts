import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { GameProcessLock } from "../../src/launch/process/lock.js";
import { MockMinecraftProcessRunner } from "../../src/launch/index.js";
import {
  installInstance,
  updateInstance,
  repairInstance,
  startGame,
  playAndWait
} from "../../src/application/index.js";
import { DEFAULT_MS_TOKEN_ENDPOINT } from "../../src/auth/config.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createPlayTestEnv,
  buildPlayDeps,
  seedAccountA,
  FAKE_USERNAME,
  testNetworkPolicy
} from "../../fixtures/playHarness.js";
import { msTokenBody } from "../../fixtures/auth/fixtures.js";

describe("0.5.0-beta.2 game lock lease + abort", { concurrency: 1 }, () => {
  it("malformed game lock != ABSENT; blocks UPDATE/REPAIR/PLAY; forceStale clears", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b2-m-")));
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
    await seedAccountA(built.accounts, built.secure);

    const paths = new InstancePaths(env.instancePath);
    const glock = new GameProcessLock(paths);
    await mkdir(paths.launcherDir(), { recursive: true });
    await writeFile(glock.lockFile(), "{not-json");

    assert.equal(await glock.inspect(), "MALFORMED");
    assert.notEqual(await glock.inspect(), "ABSENT");
    const detailed = await glock.inspectDetailed();
    assert.equal(detailed.status, "MALFORMED");

    const orchDeps = {
      http,
      trust: bundle.trust,
      artefactSource: source,
      antiRollbackStore: built.deps.antiRollbackStore,
      antiRollbackState: built.deps.antiRollbackState,
        ...testNetworkPolicy()
    };
    await assert.rejects(
      () => updateInstance({ ...req, operation: "update", skipRuntimePrep: true }, orchDeps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCK_INVALID
    );
    await assert.rejects(
      () => repairInstance({ ...req, operation: "repair", skipRuntimePrep: true }, orchDeps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCK_INVALID
    );
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCK_INVALID
    );

    // forceStale clears malformed
    const lease = await glock.acquire("play", { forceStale: true });
    await glock.releaseLease(lease);
    assert.equal(await glock.inspect(), "ABSENT");

    const result = await playAndWait(req, built.deps);
    assert.equal(result.outcome, "EXITED");
  });

  it("ACTIVE cannot be force-cleared; schema validation rejects bad fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-b2-a-"));
    const paths = new InstancePaths(path.join(root, "inst"));
    const lock = new GameProcessLock(paths);
    const lease = await lock.acquire("game-launch");
    await lock.bindGamePid(lease, process.pid);

    await assert.rejects(
      () => new GameProcessLock(paths).acquire("x", { forceStale: true }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCKED
    );
    await lock.releaseLease(lease);

    await mkdir(paths.launcherDir(), { recursive: true });
    for (const body of [
      {
        schemaVersion: 3,
        launcherPid: -1,
        leaseId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        gamePid: null,
        createdAt: new Date().toISOString(),
        owner: "o",
        operation: "x"
      },
      {
        schemaVersion: 3,
        launcherPid: 1,
        leaseId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        gamePid: 0,
        createdAt: new Date().toISOString(),
        owner: "o",
        operation: "x"
      },
      {
        schemaVersion: 99,
        launcherPid: 1,
        leaseId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        gamePid: null,
        createdAt: new Date().toISOString(),
        owner: "o",
        operation: "x"
      }
    ]) {
      await writeFile(lock.lockFile(), JSON.stringify(body));
      assert.equal(await lock.inspect(), "MALFORMED");
    }
  });

  it("same-process lease A cannot release/bind B; late A cleanup preserves B", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-b2-l-"));
    const paths = new InstancePaths(path.join(root, "inst"));
    const lockA = new GameProcessLock(paths);
    const leaseA = await lockA.acquire("game-a");
    // Simulate A becoming stale: rewrite with dead gamePid while keeping lease A then force-clear for B
    await writeFile(
      lockA.lockFile(),
      JSON.stringify({
        schemaVersion: 3,
        launcherPid: process.pid,
        leaseId: leaseA.leaseId,
        gamePid: 99999999,
        createdAt: new Date().toISOString(),
        owner: "a",
        operation: "game-a"
      }) + "\n"
    );
    assert.equal(await lockA.inspect(), "STALE");

    const lockB = new GameProcessLock(paths);
    const leaseB = await lockB.acquire("game-b", { forceStale: true });
    await lockB.bindGamePid(leaseB, process.pid);

    await assert.rejects(
      () => lockA.releaseLease(leaseA),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCKED
    );
    await assert.rejects(
      () => lockA.bindGamePid(leaseA, process.pid),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED
    );

    const raw = JSON.parse(await readFile(lockB.lockFile(), "utf8")) as { leaseId: string };
    assert.equal(raw.leaseId, leaseB.leaseId);
    assert.equal(await lockB.inspect(), "ACTIVE");

    // Mutation still refused while B active
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b2-mut-")));
    // use same paths for mutation gate — write B lock into env instance after install
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
    await installInstance(
      {
        channel: "dev",
        instancePath: env.instancePath,
        productBase: ORCH_BASE,
        runtimePath: env.runtimePath,
        operation: "install",
        skipRuntimePrep: true
      },
      {
        http,
        trust: bundle.trust,
        artefactSource: source,
        antiRollbackStore: built.deps.antiRollbackStore,
        antiRollbackState: built.deps.antiRollbackState,
        ...testNetworkPolicy()
      }
    );
    const envPaths = new InstancePaths(env.instancePath);
    const envLock = new GameProcessLock(envPaths);
    const envLease = await envLock.acquire("hold", {});
    await envLock.bindGamePid(envLease, process.pid);
    await assert.rejects(
      () =>
        updateInstance(
          {
            channel: "dev",
            instancePath: env.instancePath,
            productBase: ORCH_BASE,
            operation: "update",
            skipRuntimePrep: true
          },
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
    await envLock.releaseLease(envLease);
    await lockB.releaseLease(leaseB);
  });

  it("abort during refresh cancels PLAY; preserves credential and lastUsed", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b2-ab-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    const built = await buildPlayDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust,
      runner
    });
    const reqBase = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      runtimePath: env.runtimePath
    };
    await installInstance(
      { ...reqBase, operation: "install", skipRuntimePrep: true },
      {
        http,
        trust: bundle.trust,
        artefactSource: source,
        antiRollbackStore: built.deps.antiRollbackStore,
        antiRollbackState: built.deps.antiRollbackState,
        ...testNetworkPolicy()
      }
    );
    const accountId = await seedAccountA(built.accounts, built.secure, { lastUsedAtMs: 55 });
    assert.equal((await built.accounts.get(accountId))?.lastUsedAtMs, 55);

    // Slow restore HTTP so abort can win during Microsoft refresh (≤ default auth timeout)
    built.transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody(), { delayMs: 5_000 });
    const ac = new AbortController();
    const playP = startGame(
      { ...reqBase, signal: ac.signal },
      {
        ...built.deps,
        hooks: {
          afterGameLockReserved: async () => {
            // Abort once we are past lock reservation and about to hit auth HTTP.
            setTimeout(() => ac.abort(), 20);
          }
        }
      }
    );

    await assert.rejects(
      () => playP,
      (e: unknown) => {
        if (!(e instanceof LauncherError)) return false;
        if (e.code !== ErrorCode.AUTH_REQUEST_ABORTED) return false;
        const blob = JSON.stringify(e);
        assert.ok(!blob.includes("ms.refresh"));
        assert.ok(!blob.includes("ms.access"));
        return true;
      }
    );

    assert.equal(runner.spawnCount, 0);
    assert.equal(await new GameProcessLock(new InstancePaths(env.instancePath)).inspect(), "ABSENT");
    assert.equal((await built.accounts.get(accountId))?.lastUsedAtMs, 55);
    assert.ok(await built.secure.load(accountId));
    assert.equal((await built.accounts.get(accountId))?.minecraftUsername, FAKE_USERNAME);
  });

  it("spawn failure uses safe public message; normal lease lifecycle", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-b2-sp-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, throwOnSpawn: true };
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

    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.GAME_PROCESS_SPAWN_FAILED &&
        e.message === "failed to start Minecraft process"
    );
    assert.equal(await new GameProcessLock(new InstancePaths(env.instancePath)).inspect(), "ABSENT");

    runner.behavior = { kind: "exit", exitCode: 7, gamePid: process.pid };
    const exited = await playAndWait(req, built.deps);
    assert.equal(exited.exitCode, 7);
    assert.equal(await new GameProcessLock(new InstancePaths(env.instancePath)).inspect(), "ABSENT");
  });
});
