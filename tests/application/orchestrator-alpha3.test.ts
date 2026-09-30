import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { InstanceStateStore } from "../../src/instance/state/instanceState.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import type { AntiRollbackState } from "../../src/instance/state/index.js";
import {
  installInstance,
  updateInstance,
  repairInstance,
  inspectInstanceStatus,
  OrchestratorTransaction,
  listOrphanTransactions
} from "../../src/application/index.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createOrchDeps
} from "../../fixtures/orchestratorHarness.js";

function reuseKeys(bundle: ReturnType<typeof mountOrchBundle>) {
  return {
    publicKeyPem: bundle.publicKeyPem,
    privateKeyPem: bundle.privateKeyPem,
    trust: bundle.trust,
    keyId: bundle.keyId
  };
}

async function freshEnv() {
  const root = await mkdtemp(path.join(tmpdir(), "sc-orch-a3-"));
  return {
    root,
    instancePath: path.join(root, "instance"),
    dataDir: path.join(root, "data")
  };
}

async function plantRiskyOrphan(
  paths: InstancePaths,
  opts: {
    phase: "APPLYING" | "VERIFYING" | "COMMITTING";
    operation: "install" | "update" | "repair";
    packVersion: string;
    releaseSequence: number;
  }
): Promise<string> {
  const tx = await OrchestratorTransaction.create(paths, {
    operation: opts.operation,
    channel: "dev",
    packVersion: opts.packVersion,
    releaseSequence: opts.releaseSequence
  });
  await tx.setPhase(opts.phase, "planted");
  return tx.transactionId;
}

describe("orchestrator 0.5.0-alpha.3 recovery gate + lock ownership", { concurrency: 1 }, () => {
  it("VERIFYING orphan blocks update; no new tx / mutation / runtime; state+AR unchanged", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art12 = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art12, { releaseSequence: 3 });
    const deps = await createOrchDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust
    });
    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };
    await installInstance({ ...req, operation: "install" }, deps);

    const paths = new InstancePaths(env.instancePath);
    const orphanId = await plantRiskyOrphan(paths, {
      phase: "VERIFYING",
      operation: "update",
      packVersion: "0.1.3",
      releaseSequence: 4
    });
    const orphansBefore = await listOrphanTransactions(paths);
    assert.equal(orphansBefore.length, 1);

    const art13 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art13, { releaseSequence: 4, keys: reuseKeys(bundle) });

    let runtimeHookFired = false;
    deps.hooks = {
      duringRuntimePrep: async () => {
        runtimeHookFired = true;
      }
    };

    const modBefore = await readFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar"));
    const arBefore = await deps.antiRollbackStore.load();

    await assert.rejects(
      () => updateInstance({ ...req, operation: "update" }, deps),
      (e: unknown) => {
        assert.ok(e instanceof LauncherError);
        assert.equal(e.code, ErrorCode.INSTANCE_RECOVERY_REQUIRED);
        assert.equal(e.details.phase, "VERIFYING");
        assert.equal(e.details.transactionId, orphanId);
        assert.equal(e.details.packVersion, "0.1.3");
        assert.equal(e.details.releaseSequence, 4);
        assert.equal(e.details.riskyCount, 1);
        return true;
      }
    );

    assert.equal(runtimeHookFired, false);
    assert.equal((await listOrphanTransactions(paths)).length, 1);
    assert.equal((await listOrphanTransactions(paths))[0]?.transactionId, orphanId);
    assert.ok(!(await readdir(paths.modsDir())).includes("examplemod-0.1.3.jar"));
    assert.equal(
      (await readFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar"))).equals(modBefore),
      true
    );
    const state = await new InstanceStateStore(paths).load();
    assert.equal(state.installedPackVersion, "0.1.2");
    const arAfter = await deps.antiRollbackStore.load();
    assert.deepEqual(
      arAfter.channels.dev?.highestAcceptedReleaseSequence,
      arBefore.channels.dev?.highestAcceptedReleaseSequence
    );
  });

  it("APPLYING orphan blocks install; COMMITTING orphan blocks repair", async () => {
    // APPLYING blocks install on fresh instance
    {
      const env = await freshEnv();
      const http = new MockHttpClient();
      const source = new MockByteSource();
      const art = buildOrchArtefacts("0.1.2");
      const bundle = mountOrchBundle(http, source, art);
      const deps = await createOrchDeps({
        dataDir: env.dataDir,
        http,
        source,
        trust: bundle.trust
      });
      const paths = new InstancePaths(env.instancePath);
      await mkdir(paths.launcherDir(), { recursive: true });
      await plantRiskyOrphan(paths, {
        phase: "APPLYING",
        operation: "install",
        packVersion: "0.1.2",
        releaseSequence: 3
      });
      let runtime = false;
      deps.hooks = { duringRuntimePrep: async () => { runtime = true; } };
      await assert.rejects(
        () =>
          installInstance(
            {
              operation: "install",
              channel: "dev",
              instancePath: env.instancePath,
              productBase: ORCH_BASE,
              skipRuntimePrep: true
            },
            deps
          ),
        (e: unknown) =>
          e instanceof LauncherError &&
          e.code === ErrorCode.INSTANCE_RECOVERY_REQUIRED &&
          e.details.phase === "APPLYING"
      );
      assert.equal(runtime, false);
      assert.equal((await new InstanceStateStore(paths).load()).installedPackVersion, null);
    }

    // COMMITTING blocks repair
    {
      const env = await freshEnv();
      const http = new MockHttpClient();
      const source = new MockByteSource();
      const art = buildOrchArtefacts("0.1.2");
      const bundle = mountOrchBundle(http, source, art);
      const deps = await createOrchDeps({
        dataDir: env.dataDir,
        http,
        source,
        trust: bundle.trust
      });
      await installInstance(
        {
          operation: "install",
          channel: "dev",
          instancePath: env.instancePath,
          productBase: ORCH_BASE,
          skipRuntimePrep: true
        },
        deps
      );
      const paths = new InstancePaths(env.instancePath);
      await plantRiskyOrphan(paths, {
        phase: "COMMITTING",
        operation: "repair",
        packVersion: "0.1.2",
        releaseSequence: 3
      });
      await assert.rejects(
        () =>
          repairInstance(
            {
              operation: "repair",
              channel: "dev",
              instancePath: env.instancePath,
              productBase: ORCH_BASE,
              skipRuntimePrep: true
            },
            deps
          ),
        (e: unknown) =>
          e instanceof LauncherError &&
          e.code === ErrorCode.INSTANCE_RECOVERY_REQUIRED &&
          e.details.phase === "COMMITTING"
      );
    }
  });

  it("antiRollback persist failure → COMMITTING + blocks next mutation", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art12 = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art12, { releaseSequence: 3 });
    const deps = await createOrchDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust
    });
    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };
    await installInstance({ ...req, operation: "install" }, deps);

    const art13 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art13, { releaseSequence: 4, keys: reuseKeys(bundle) });

    const originalSave = deps.antiRollbackStore.saveAtomic.bind(deps.antiRollbackStore);
    let failNext = true;
    deps.antiRollbackStore.saveAtomic = async (state: AntiRollbackState) => {
      if (failNext) {
        failNext = false;
        throw new Error("forced anti-rollback write failure");
      }
      return originalSave(state);
    };

    await assert.rejects(
      () => updateInstance({ ...req, operation: "update" }, deps),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.ANTI_ROLLBACK_PERSIST_FAILED
    );

    const paths = new InstancePaths(env.instancePath);
    const state = await new InstanceStateStore(paths).load();
    assert.equal(state.installedPackVersion, "0.1.3");

    const orphans = await listOrphanTransactions(paths);
    assert.ok(orphans.some((o) => o.phase === "COMMITTING"));

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "RECOVERY_REQUIRED");

    // Restore save so gate is the only failure mode
    deps.antiRollbackStore.saveAtomic = originalSave;
    let runtime = false;
    deps.hooks = { duringRuntimePrep: async () => { runtime = true; } };

    await assert.rejects(
      () => updateInstance({ ...req, operation: "update" }, deps),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.INSTANCE_RECOVERY_REQUIRED
    );
    assert.equal(runtime, false);
    assert.equal((await listOrphanTransactions(paths)).filter((o) => o.phase === "COMMITTING").length, 1);
  });

  it("wrong lease cannot remove same-pid newer lock; orchestrator has no pid-only fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-lease-"));
    const paths = new InstancePaths(root);
    const lock = new InstanceLock(paths);
    const leaseA = await lock.acquire("op-a");

    // Simulate lock now owned by lease B (same PID)
    const leaseBId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await writeFile(
      paths.lockFile(),
      JSON.stringify(
        {
          schemaVersion: 1,
          pid: process.pid,
          createdAt: new Date().toISOString(),
          owner: "lease-b",
          operation: "op-b",
          leaseId: leaseBId
        },
        null,
        2
      ) + "\n"
    );

    await assert.rejects(
      () => lock.releaseLease(leaseA),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_LOCKED
    );

    const raw = JSON.parse(await readFile(paths.lockFile(), "utf8")) as { leaseId: string };
    assert.equal(raw.leaseId, leaseBId);

    // Legacy pid-only release WOULD remove B — orchestrator must not call it after lease failure.
    // Document/prove release() still exists for legacy but is unsafe across leases:
    await lock.release(); // pid-only — removes B (legacy API)
    // Recreate B and prove releaseLease(A) leaves it when we don't call release()
    await writeFile(
      paths.lockFile(),
      JSON.stringify(
        {
          schemaVersion: 1,
          pid: process.pid,
          createdAt: new Date().toISOString(),
          owner: "lease-b",
          operation: "op-b",
          leaseId: leaseBId
        },
        null,
        2
      ) + "\n"
    );
    await assert.rejects(() => lock.releaseLease(leaseA));
    assert.equal(JSON.parse(await readFile(paths.lockFile(), "utf8")).leaseId, leaseBId);
  });
});
