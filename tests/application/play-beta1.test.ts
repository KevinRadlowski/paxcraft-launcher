import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import { GameProcessLock } from "../../src/launch/process/lock.js";
import { MockMinecraftProcessRunner } from "../../src/launch/index.js";
import {
  installInstance,
  updateInstance,
  repairInstance,
  inspectInstanceStatus,
  startGame,
  playAndWait,
  OrchestratorTransaction
} from "../../src/application/index.js";
import { uninstallInstance } from "../../src/application/orchestrator/uninstall.js";
import { InMemoryAccountRegistry } from "../../src/auth/index.js";
import { MC_PROFILE_URL } from "../../src/auth/minecraft/services.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createPlayTestEnv,
  buildPlayDeps,
  seedAccountA,
  playAccountIdA,
  playAccountIdB,
  FAKE_USERNAME
} from "../../fixtures/playHarness.js";
import { profileBody } from "../../fixtures/auth/fixtures.js";

function reuseKeys(bundle: ReturnType<typeof mountOrchBundle>) {
  return {
    publicKeyPem: bundle.publicKeyPem,
    privateKeyPem: bundle.privateKeyPem,
    trust: bundle.trust,
    keyId: bundle.keyId
  };
}

describe("play orchestrator 0.5.0-beta.1", { concurrency: 1 }, () => {
  it("readiness: NOT_INSTALLED / UPDATE / REPAIR / RECOVERY / BUSY / READY", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-play-r-")));
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

    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.PLAY_INSTALL_REQUIRED
    );

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

    // READY path reaches auth/session then launch — seed done
    const st = await inspectInstanceStatus({ ...req, operation: "status" }, {
      http,
      trust: bundle.trust,
      artefactSource: source,
      antiRollbackStore: built.deps.antiRollbackStore,
      antiRollbackState: built.deps.antiRollbackState
    });
    assert.equal(st.status, "READY");

    // UPDATE_AVAILABLE
    const art2 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art2, { releaseSequence: 4, keys: reuseKeys(bundle) });
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.PLAY_UPDATE_REQUIRED
    );

    // back to tip then corrupt managed file → REPAIR
    mountOrchBundle(http, source, art, { releaseSequence: 3, keys: reuseKeys(bundle) });
    const paths = new InstancePaths(env.instancePath);
    await writeFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar"), "corrupt");
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.PLAY_REPAIR_REQUIRED
    );

    // recovery
    await writeFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar"), art.modBytes);
    const tx = await OrchestratorTransaction.create(paths, {
      operation: "update",
      channel: "dev"
    });
    await tx.setPhase("APPLYING", "plant");
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_RECOVERY_REQUIRED
    );
    await tx.cleanup();

    // busy lock
    const lock = new InstanceLock(paths);
    const lease = await lock.acquire("other");
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_BUSY
    );
    await lock.releaseLease(lease);
  });

  it("account selection + binding mismatch + cold restore E2E", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-play-a-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, gamePid: 7777 };
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
        antiRollbackState: built.deps.antiRollbackState
      }
    );

    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_ACCOUNT_REQUIRED
    );

    await assert.rejects(
      () => startGame({ ...req, accountId: "mc:missing" }, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_ACCOUNT_NOT_FOUND
    );

    const idA = await seedAccountA(built.accounts, built.secure, { lastUsedAtMs: 0 });
    built.accounts.upsert({
      accountId: playAccountIdB(),
      minecraftUuid: "ffeeddcc-bbaa-9988-7766-554433221100",
      minecraftUsername: "Other",
      lastUsedAtMs: 0
    });
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_ACCOUNT_REQUIRED
    );

    // single account after removing B
    built.accounts.delete(playAccountIdB());
    const result = await playAndWait(req, built.deps);
    assert.equal(result.outcome, "EXITED");
    assert.equal(result.gamePid, 7777);
    assert.equal(result.accountId, idA);
    assert.equal(result.minecraftUsername, FAKE_USERNAME);
    assert.equal(result.exitCode, 0);
    assert.equal(runner.spawnCount, 1);
    assert.ok((await built.accounts.get(idA))!.lastUsedAtMs > 0);

    // mismatch: profile B for account A
    const env2 = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-play-m-")));
    const http2 = new MockHttpClient();
    const source2 = new MockByteSource();
    const bundle2 = mountOrchBundle(http2, source2, art, { releaseSequence: 3, keys: reuseKeys(bundle) });
    const runner2 = new MockMinecraftProcessRunner();
    const built2 = await buildPlayDeps({
      dataDir: env2.dataDir,
      http: http2,
      source: source2,
      trust: bundle2.trust,
      runner: runner2,
      profileId: "ffeeddccbbaa99887766554433221100"
    });
    await installInstance(
      {
        channel: "dev",
        instancePath: env2.instancePath,
        productBase: ORCH_BASE,
        runtimePath: env2.runtimePath,
        operation: "install",
        skipRuntimePrep: true
      },
      {
        http: http2,
        trust: bundle2.trust,
        artefactSource: source2,
        antiRollbackStore: built2.deps.antiRollbackStore,
        antiRollbackState: built2.deps.antiRollbackState
      }
    );
    const idA2 = await seedAccountA(built2.accounts, built2.secure, { lastUsedAtMs: 42 });
    const metaBefore = await built2.accounts.get(idA2);
    await assert.rejects(
      () =>
        startGame(
          {
            channel: "dev",
            instancePath: env2.instancePath,
            productBase: ORCH_BASE,
            runtimePath: env2.runtimePath,
            accountId: idA2
          },
          built2.deps
        ),
      (e: unknown) => {
        if (!(e instanceof LauncherError) || e.code !== ErrorCode.AUTH_ACCOUNT_MISMATCH) return false;
        const blob = JSON.stringify(e);
        assert.ok(!blob.includes("ms.access"));
        assert.ok(!blob.includes("mc.access"));
        assert.ok(!blob.includes("ms.refresh"));
        return true;
      }
    );
    assert.equal(runner2.spawnCount, 0);
    assert.equal((await built2.accounts.get(idA2))?.lastUsedAtMs, 42);
    assert.equal((await built2.accounts.get(idA2))?.minecraftUsername, metaBefore?.minecraftUsername);
    assert.equal(built2.accounts.list().length, 1);
    assert.ok(await built2.secure.load(idA2));
  });

  it("game lock handoff blocks update/repair; second play refused", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-play-l-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, deferExit: true, gamePid: process.pid };
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
        antiRollbackState: built.deps.antiRollbackState
      }
    );
    await seedAccountA(built.accounts, built.secure);

    const game = await startGame(req, built.deps);
    assert.equal(game.gamePid, process.pid);

    const orchDeps = {
      http,
      trust: bundle.trust,
      artefactSource: source,
      antiRollbackStore: built.deps.antiRollbackStore,
      antiRollbackState: built.deps.antiRollbackState
    };
    await assert.rejects(
      () => updateInstance({ ...req, operation: "update", skipRuntimePrep: true }, orchDeps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );
    await assert.rejects(
      () => repairInstance({ ...req, operation: "repair", skipRuntimePrep: true }, orchDeps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );
    await assert.rejects(
      () => uninstallInstance({ ...req, operation: "uninstall", skipRuntimePrep: true }, orchDeps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.GAME_ALREADY_RUNNING
    );

    const paths = new InstancePaths(env.instancePath);
    assert.equal(await new GameProcessLock(paths).inspect(), "ACTIVE");

    runner.releaseDeferredExit();
    const exit = await game.completion;
    assert.equal(exit.exitCode, 0);
    assert.equal(await new GameProcessLock(paths).inspect(), "ABSENT");
  });

  it("PLAY reserves game lock then UPDATE fails after InstanceLock handoff", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-play-h-")));
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const runner = new MockMinecraftProcessRunner();
    runner.behavior = { kind: "exit", exitCode: 0, deferExit: true, gamePid: process.pid };

    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>((r) => {
      releaseUpdate = r;
    });
    let signaled!: () => void;
    const afterReserved = new Promise<void>((r) => {
      signaled = r;
    });

    const built = await buildPlayDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust,
      runner
    });
    built.deps.hooks = {
      afterGameLockReserved: async () => {
        signaled();
        await updateGate;
      }
    };

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

    const playP = startGame(req, built.deps);
    await afterReserved;

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

    releaseUpdate();
    const game = await playP;
    runner.releaseDeferredExit();
    await game.completion;
  });

  it("abort before spawn releases game lock; logout → AUTH_LOGIN_REQUIRED", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-play-c-")));
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
    const ac = new AbortController();
    built.deps.hooks = {
      beforeSpawn: async () => {
        ac.abort();
      }
    };
    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      runtimePath: env.runtimePath,
      signal: ac.signal
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
    await assert.rejects(
      () => startGame(req, built.deps),
      (e: unknown) =>
        e instanceof LauncherError &&
        (e.code === ErrorCode.OPERATION_ABORTED || e.code === ErrorCode.AUTH_REQUEST_ABORTED)
    );
    assert.equal(runner.spawnCount, 0);
    assert.equal(await new GameProcessLock(new InstancePaths(env.instancePath)).inspect(), "ABSENT");

    await built.deps.auth.store.delete(playAccountIdA());
    built.deps.sessionCache?.clear();
    built.deps.hooks = undefined;
    await assert.rejects(
      () =>
        startGame(
          {
            channel: "dev",
            instancePath: env.instancePath,
            productBase: ORCH_BASE,
            runtimePath: env.runtimePath
          },
          built.deps
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_LOGIN_REQUIRED
    );
  });

  it("unmanaged extra does not block READY play", async () => {
    const env = await createPlayTestEnv(await mkdtemp(path.join(tmpdir(), "sc-play-u-")));
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
    const paths = new InstancePaths(env.instancePath);
    await writeFile(path.join(paths.modsDir(), "unmanaged-extra.jar"), "extra");
    await seedAccountA(built.accounts, built.secure);
    const result = await playAndWait(req, built.deps);
    assert.equal(result.outcome, "EXITED");
    assert.equal(result.exitCode, 0);
  });
});
