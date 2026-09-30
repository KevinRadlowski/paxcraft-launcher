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
import { applyInstallation } from "../../src/instance/apply/index.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import {
  installInstance,
  updateInstance,
  inspectInstanceStatus,
  OrchestratorTransaction,
  listOrphanTransactions,
  reconcileOrphanTransactions
} from "../../src/application/index.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createOrchDeps
} from "../../fixtures/orchestratorHarness.js";
import { buildTrustedResolved, buildHarnessFiles, mountHarnessSource } from "../../fixtures/instanceHarness.js";

function reuseKeys(bundle: ReturnType<typeof mountOrchBundle>) {
  return {
    publicKeyPem: bundle.publicKeyPem,
    privateKeyPem: bundle.privateKeyPem,
    trust: bundle.trust,
    keyId: bundle.keyId
  };
}

async function freshEnv() {
  const root = await mkdtemp(path.join(tmpdir(), "sc-orch-a2-"));
  return {
    root,
    instancePath: path.join(root, "instance"),
    dataDir: path.join(root, "data")
  };
}

describe("orchestrator 0.5.0-alpha.2 transactional hardening", { concurrency: 1 }, () => {
  it("install final audit failure → installedPackVersion remains null", async () => {
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
    deps.hooks = {
      beforeFinalAudit: async () => {
        const paths = new InstancePaths(env.instancePath);
        await writeFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar"), Buffer.from("corrupt-after-apply"));
      }
    };

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
        e instanceof LauncherError && e.code === ErrorCode.OPERATION_VERIFY_FAILED
    );

    const state = await new InstanceStateStore(new InstancePaths(env.instancePath)).load();
    assert.equal(state.installedPackVersion, null);
    assert.equal(state.installedReleaseSequence, null);

    const ar = await deps.antiRollbackStore.load();
    assert.equal(ar.channels.dev, undefined);

    const orphans = await listOrphanTransactions(new InstancePaths(env.instancePath));
    assert.ok(orphans.some((o) => o.phase === "VERIFYING" || o.phase === "APPLYING"));
  });

  it("update final audit failure → previous 0.1.2 state retained; antiRollback not advanced", async () => {
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
    const reqBase = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };
    await installInstance({ ...reqBase, operation: "install" }, deps);

    const beforeAr = await deps.antiRollbackStore.load();
    assert.equal(beforeAr.channels.dev?.highestAcceptedReleaseSequence, 3);

    const art13 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art13, { releaseSequence: 4, keys: reuseKeys(bundle) });

    deps.hooks = {
      beforeFinalAudit: async () => {
        const paths = new InstancePaths(env.instancePath);
        await writeFile(
          path.join(paths.modsDir(), "examplemod-0.1.3.jar"),
          Buffer.from("corrupt-target")
        );
      }
    };

    await assert.rejects(
      () => updateInstance({ ...reqBase, operation: "update" }, deps),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.OPERATION_VERIFY_FAILED
    );

    const state = await new InstanceStateStore(new InstancePaths(env.instancePath)).load();
    assert.equal(state.installedPackVersion, "0.1.2");
    assert.equal(state.installedReleaseSequence, 3);
    assert.notEqual(state.installedPackVersion, "0.1.3");

    const afterAr = await deps.antiRollbackStore.load();
    assert.equal(afterAr.channels.dev?.highestAcceptedReleaseSequence, 3);
    assert.equal(afterAr.channels.dev?.acceptedPackVersion, "0.1.2");

    const st = await inspectInstanceStatus({ ...reqBase, operation: "status" }, deps);
    assert.equal(st.status, "RECOVERY_REQUIRED");
  });

  it("concurrent operation B fails INSTANCE_BUSY before mutation while A holds lock", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art);
    const depsA = await createOrchDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust
    });
    const depsB = await createOrchDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust
    });

    let releaseA!: () => void;
    const gate = new Promise<void>((r) => {
      releaseA = r;
    });
    let signalEntered!: () => void;
    const entered = new Promise<void>((r) => {
      signalEntered = r;
    });
    depsA.hooks = {
      duringRuntimePrep: async () => {
        signalEntered();
        await gate;
      }
    };

    const req = {
      operation: "install" as const,
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };

    const pA = installInstance(req, depsA);
    await entered;

    const paths = new InstancePaths(env.instancePath);
    const txBefore = await listOrphanTransactions(paths);
    assert.equal(txBefore.length, 1);
    assert.equal(txBefore[0]?.phase, "ACQUIRING");

    await assert.rejects(
      () => installInstance(req, depsB),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_BUSY
    );

    const txAfter = await listOrphanTransactions(paths);
    // B must not create a mutating transaction
    assert.equal(txAfter.length, 1);
    assert.equal(txAfter[0]?.transactionId, txBefore[0]?.transactionId);

    const mods = await readdir(paths.modsDir()).catch(() => [] as string[]);
    // A paused before apply — no managed mod yet (or empty)
    assert.ok(!mods.includes("examplemod-0.1.2.jar"));

    const stateMid = await new InstanceStateStore(paths).load();
    assert.equal(stateMid.installedPackVersion, null);

    releaseA();
    const result = await pA;
    assert.equal(result.outcome, "SUCCESS");
  });

  it("APPLYING / VERIFYING orphan → RECOVERY_REQUIRED; safe cleanup does not delete them", async () => {
    const env = await freshEnv();
    const paths = new InstancePaths(env.instancePath);
    const tx = await OrchestratorTransaction.create(paths, {
      operation: "update",
      channel: "dev",
      packVersion: "0.1.3",
      releaseSequence: 4
    });
    await tx.setPhase("APPLYING", "crash");
    const report = await reconcileOrphanTransactions(paths);
    assert.equal(report.action, "AUDIT_REQUIRED");
    assert.equal((await listOrphanTransactions(paths)).length, 1);

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
    // Seed installed 0.1.2 state without clearing orphan
    await mkdir(paths.launcherDir(), { recursive: true });
    await new InstanceStateStore(paths).saveAtomic({
      schemaVersion: 1,
      installedPackVersion: "0.1.2",
      installedReleaseSequence: 3,
      installedReleaseSha256: "d".repeat(64),
      installedManifestSha256: "e".repeat(64),
      channel: "dev",
      productBase: ORCH_BASE,
      files: [],
      updatedAt: new Date().toISOString()
    });

    const st = await inspectInstanceStatus(
      {
        operation: "status",
        channel: "dev",
        instancePath: env.instancePath,
        productBase: ORCH_BASE
      },
      deps
    );
    assert.equal(st.status, "RECOVERY_REQUIRED");
    assert.equal(st.installedVersion, "0.1.2");
  });

  it("VERIFYING crash leaves prior state authoritative", async () => {
    const env = await freshEnv();
    const paths = new InstancePaths(env.instancePath);
    await mkdir(paths.launcherDir(), { recursive: true });
    await new InstanceStateStore(paths).saveAtomic({
      schemaVersion: 1,
      installedPackVersion: "0.1.2",
      installedReleaseSequence: 3,
      installedReleaseSha256: "a".repeat(64),
      installedManifestSha256: "b".repeat(64),
      channel: "dev",
      productBase: ORCH_BASE,
      files: [],
      updatedAt: new Date().toISOString()
    });
    const tx = await OrchestratorTransaction.create(paths, {
      operation: "update",
      channel: "dev",
      packVersion: "0.1.3",
      releaseSequence: 4
    });
    await tx.setPhase("VERIFYING", "crash");
    const state = await new InstanceStateStore(paths).load();
    assert.equal(state.installedPackVersion, "0.1.2");
    const orphans = await listOrphanTransactions(paths);
    assert.equal(orphans[0]?.phase, "VERIFYING");
  });

  it("COMMITTING orphan: recovery inspects state identity vs transaction release", async () => {
    const env = await freshEnv();
    const paths = new InstancePaths(env.instancePath);
    await mkdir(paths.launcherDir(), { recursive: true });
    await new InstanceStateStore(paths).saveAtomic({
      schemaVersion: 1,
      installedPackVersion: "0.1.2",
      installedReleaseSequence: 3,
      installedReleaseSha256: "a".repeat(64),
      installedManifestSha256: "b".repeat(64),
      channel: "dev",
      productBase: ORCH_BASE,
      files: [],
      updatedAt: new Date().toISOString()
    });
    const tx = await OrchestratorTransaction.create(paths, {
      operation: "update",
      channel: "dev",
      packVersion: "0.1.3",
      releaseSequence: 4
    });
    await tx.setPhase("COMMITTING", "crash-before-state");
    const orphans = await listOrphanTransactions(paths);
    assert.equal(orphans[0]?.phase, "COMMITTING");
    assert.equal(orphans[0]?.packVersion, "0.1.3");
    const state = await new InstanceStateStore(paths).load();
    assert.equal(state.installedPackVersion, "0.1.2");
    // Mismatch → operator must audit; status RECOVERY_REQUIRED
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
    const st = await inspectInstanceStatus(
      {
        channel: "dev",
        instancePath: env.instancePath,
        productBase: ORCH_BASE
      },
      deps
    );
    assert.equal(st.status, "RECOVERY_REQUIRED");
  });

  it("COMMITTED success: state matches release; no orphan tx; no unused staging dir", async () => {
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
    const result = await installInstance(
      {
        operation: "install",
        channel: "dev",
        instancePath: env.instancePath,
        productBase: ORCH_BASE,
        skipRuntimePrep: true
      },
      deps
    );
    assert.equal(result.outcome, "SUCCESS");
    const paths = new InstancePaths(env.instancePath);
    const state = await new InstanceStateStore(paths).load();
    assert.equal(state.installedPackVersion, result.releaseVersion);
    assert.equal(state.installedReleaseSequence, result.releaseSequence);
    assert.equal((await listOrphanTransactions(paths)).length, 0);
    // Transaction staging/ must not exist as claimed unused layout
    const txRoot = path.join(paths.launcherDir(), "transactions");
    const names = await readdir(txRoot).catch(() => [] as string[]);
    assert.equal(names.length, 0);
  });

  it("legacy applyInstallation still commits state immediately (compat)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-legacy-apply-"));
    const paths = new InstancePaths(root);
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    const result = await applyInstallation({ resolved, paths, source });
    assert.equal(result.dryRun, false);
    assert.equal(result.pending, undefined);
    assert.equal(result.state.installedPackVersion, "0.2.0");
    const loaded = await new InstanceStateStore(paths).load();
    assert.equal(loaded.installedPackVersion, "0.2.0");
  });

  it("deferred apply under lease does not write state until commit()", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-defer-"));
    const paths = new InstancePaths(root);
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const source = new MockByteSource();
    mountHarnessSource(source, files);
    const lock = new InstanceLock(paths);
    const lease = await lock.acquire("orch");
    const result = await applyInstallation({
      resolved,
      paths,
      source,
      deferStateCommit: true,
      lockLease: lease
    });
    assert.ok(result.pending);
    assert.equal(result.state.installedPackVersion, null);
    const mid = await new InstanceStateStore(paths).load();
    assert.equal(mid.installedPackVersion, null);
    await result.pending!.commit();
    const after = await new InstanceStateStore(paths).load();
    assert.equal(after.installedPackVersion, "0.2.0");
    await lock.releaseLease(lease);
  });
});
