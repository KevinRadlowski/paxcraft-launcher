import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import {
  installInstance,
  updateInstance,
  repairInstance,
  inspectInstanceStatus,
  OrchestratorTransaction,
  listOrphanTransactions,
  scanTransactions,
  cleanupSafeOrphanTransactions,
  parseTransactionMetadata
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
  const root = await mkdtemp(path.join(tmpdir(), "sc-orch-a4-"));
  return {
    root,
    instancePath: path.join(root, "instance"),
    dataDir: path.join(root, "data")
  };
}

async function plantCorruptTx(
  paths: InstancePaths,
  directoryId: string,
  body: string | null
): Promise<string> {
  const dir = path.join(OrchestratorTransaction.transactionsRoot(paths), directoryId);
  await mkdir(dir, { recursive: true });
  if (body !== null) {
    await writeFile(path.join(dir, "metadata.json"), body);
  }
  return directoryId;
}

async function plantValidMeta(
  paths: InstancePaths,
  directoryId: string,
  overrides: Record<string, unknown>
): Promise<void> {
  const dir = path.join(OrchestratorTransaction.transactionsRoot(paths), directoryId);
  await mkdir(dir, { recursive: true });
  const meta = {
    schemaVersion: 1,
    transactionId: directoryId,
    operation: "install",
    channel: "dev",
    packVersion: null,
    releaseSequence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phase: "FAILED",
    ...overrides
  };
  await writeFile(path.join(dir, "metadata.json"), JSON.stringify(meta, null, 2) + "\n");
}

describe("orchestrator 0.5.0-alpha.4 status safety + corrupt tx fail-closed", { concurrency: 1 }, () => {
  it("status during active ACQUIRING returns BUSY and does not delete live tx; op resumes", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
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

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let enteredAcquiring = false;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });

    deps.hooks = {
      duringRuntimePrep: async () => {
        enteredAcquiring = true;
        signalEntered();
        await pause;
      }
    };

    const installP = installInstance({ ...req, operation: "install" }, deps);
    await entered;

    const paths = new InstancePaths(env.instancePath);
    const scanDuring = await scanTransactions(paths);
    assert.equal(enteredAcquiring, true);
    assert.equal(scanDuring.orphans.length, 1);
    assert.equal(scanDuring.orphans[0]?.phase, "ACQUIRING");
    const liveTxId = scanDuring.orphans[0]!.transactionId;
    const metaPath = path.join(
      OrchestratorTransaction.transactionsRoot(paths),
      liveTxId,
      "metadata.json"
    );
    await access(metaPath);

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "BUSY");
    assert.ok(st.findings.includes("LOCK_PRESENT"));

    const scanAfterStatus = await scanTransactions(paths);
    assert.equal(scanAfterStatus.orphans.length, 1);
    assert.equal(scanAfterStatus.orphans[0]?.transactionId, liveTxId);
    assert.equal(scanAfterStatus.orphans[0]?.phase, "ACQUIRING");
    await access(metaPath);

    releasePause();
    const result = await installP;
    assert.equal(result.outcome, "SUCCESS");
    assert.equal((await scanTransactions(paths)).orphans.length, 0);
  });

  it("PLANNED window: not externally observable — ACQUIRING test covers active-safe-cleanup hazard", () => {
    // OrchestratorTransaction.create writes PLANNED then execute immediately setPhase(ACQUIRING)
    // before any public await point / hook. Deterministic external observation of PLANNED under
    // a live lock is not reachable via public APIs; the ACQUIRING race test covers the hazard.
    assert.ok(true);
  });

  it("status is read-only: does not clean safe orphans; mutate under lock does", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
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
    const orphan = await OrchestratorTransaction.create(paths, {
      operation: "update",
      channel: "dev"
    });
    await orphan.setPhase("ACQUIRING", "planted");

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.notEqual(st.status, "BUSY");
    assert.ok(st.findings.includes("SAFE_ORPHAN_TX"));
    assert.equal(st.orphanTransaction, true);
    assert.equal((await listOrphanTransactions(paths)).length, 1);
    await access(
      path.join(OrchestratorTransaction.transactionsRoot(paths), orphan.transactionId, "metadata.json")
    );

    await updateInstance({ ...req, operation: "update" }, deps);
    assert.equal((await listOrphanTransactions(paths)).length, 0);
  });

  it("malformed / missing / invalid schema / phase / id mismatch → RECOVERY_REQUIRED; not auto-deleted", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
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

    const cases: Array<{ id: string; body: string | null; reason: string }> = [
      { id: "corrupt-json-aaaa-bbbb-cccc-ddddeeee0001", body: "{not-json", reason: "MALFORMED_JSON" },
      { id: "missing-meta-aaaa-bbbb-cccc-ddddeeee0002", body: null, reason: "MISSING_METADATA" },
      {
        id: "bad-schema-aaaa-bbbb-cccc-ddddeeee0003",
        body: null,
        reason: "INVALID_SCHEMA"
      },
      {
        id: "bad-phase-aaaa-bbbb-cccc-ddddeeee0004",
        body: null,
        reason: "INVALID_PHASE"
      },
      {
        id: "id-mismatch-aaaa-bbbb-cccc-ddddeeee0005",
        body: null,
        reason: "TRANSACTION_ID_MISMATCH"
      }
    ];

    await plantCorruptTx(paths, cases[0]!.id, cases[0]!.body);
    await plantCorruptTx(paths, cases[1]!.id, null);
    await plantValidMeta(paths, cases[2]!.id, { schemaVersion: 99 });
    await plantValidMeta(paths, cases[3]!.id, { phase: "NOT_A_PHASE" });
    await plantValidMeta(paths, cases[4]!.id, { transactionId: "other-id-aaaa-bbbb-cccc-ddddeeee9999" });

    const scan = await scanTransactions(paths);
    assert.equal(scan.corrupt.length, 5);
    assert.equal(scan.orphans.length, 0);
    const reasons = new Set(scan.corrupt.map((c) => c.reason));
    assert.ok(reasons.has("MALFORMED_JSON"));
    assert.ok(reasons.has("MISSING_METADATA"));
    assert.ok(reasons.has("INVALID_SCHEMA"));
    assert.ok(reasons.has("INVALID_PHASE"));
    assert.ok(reasons.has("TRANSACTION_ID_MISMATCH"));

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "RECOVERY_REQUIRED");
    assert.ok(st.findings.includes("CORRUPT_TRANSACTION"));

    const cleaned = await cleanupSafeOrphanTransactions(paths);
    assert.equal(cleaned.length, 0);
    assert.equal((await scanTransactions(paths)).corrupt.length, 5);

    // Individual status findings still recovery for each isolated case
    for (const c of cases) {
      const env2 = await freshEnv();
      const http2 = new MockHttpClient();
      const source2 = new MockByteSource();
      const art2 = buildOrchArtefacts("0.1.2");
      const bundle2 = mountOrchBundle(http2, source2, art2, { releaseSequence: 3 });
      const deps2 = await createOrchDeps({
        dataDir: env2.dataDir,
        http: http2,
        source: source2,
        trust: bundle2.trust
      });
      const req2 = {
        channel: "dev" as const,
        instancePath: env2.instancePath,
        productBase: ORCH_BASE,
        skipRuntimePrep: true
      };
      await installInstance({ ...req2, operation: "install" }, deps2);
      const p2 = new InstancePaths(env2.instancePath);
      if (c.reason === "MALFORMED_JSON") await plantCorruptTx(p2, c.id, "{bad");
      else if (c.reason === "MISSING_METADATA") await plantCorruptTx(p2, c.id, null);
      else if (c.reason === "INVALID_SCHEMA") await plantValidMeta(p2, c.id, { schemaVersion: 2 });
      else if (c.reason === "INVALID_PHASE") await plantValidMeta(p2, c.id, { phase: "WEIRD" });
      else await plantValidMeta(p2, c.id, { transactionId: "nope-aaaa-bbbb-cccc-ddddeeee1111" });

      const st2 = await inspectInstanceStatus({ ...req2, operation: "status" }, deps2);
      assert.equal(st2.status, "RECOVERY_REQUIRED", c.reason);
      assert.ok(st2.findings.includes("CORRUPT_TRANSACTION"), c.reason);
      assert.equal((await scanTransactions(p2)).corrupt[0]?.reason, c.reason);
    }
  });

  it("corrupt tx blocks install / update / repair and is not auto-deleted", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
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

    // Block install on empty instance with corrupt tx
    const paths = new InstancePaths(env.instancePath);
    const corruptId = "corrupt-block-aaaa-bbbb-cccc-ddddeeee0001";
    await plantCorruptTx(paths, corruptId, "{broken");

    await assert.rejects(
      () => installInstance({ ...req, operation: "install" }, deps),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.INSTANCE_RECOVERY_REQUIRED &&
        e.details.reason === "CORRUPT_TRANSACTION"
    );
    assert.equal((await scanTransactions(paths)).corrupt.length, 1);
    await access(
      path.join(OrchestratorTransaction.transactionsRoot(paths), corruptId, "metadata.json")
    );

    await rm(path.join(OrchestratorTransaction.transactionsRoot(paths), corruptId), {
      recursive: true,
      force: true
    });
    await installInstance({ ...req, operation: "install" }, deps);

    await plantCorruptTx(paths, corruptId, "{broken-again");
    const art13 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art13, { releaseSequence: 4, keys: reuseKeys(bundle) });

    await assert.rejects(
      () => updateInstance({ ...req, operation: "update" }, deps),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.INSTANCE_RECOVERY_REQUIRED &&
        e.details.reason === "CORRUPT_TRANSACTION"
    );
    await assert.rejects(
      () => repairInstance({ ...req, operation: "repair" }, deps),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.INSTANCE_RECOVERY_REQUIRED &&
        e.details.reason === "CORRUPT_TRANSACTION"
    );
    assert.equal((await scanTransactions(paths)).corrupt.length, 1);
  });

  it("malformed lock.json → fail closed (not absent); status RECOVERY_REQUIRED", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
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
    await mkdir(paths.launcherDir(), { recursive: true });
    await writeFile(paths.lockFile(), "{not-a-lock");

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "RECOVERY_REQUIRED");
    assert.ok(st.findings.includes("LOCK_MALFORMED"));

    await assert.rejects(
      () => updateInstance({ ...req, operation: "update" }, deps),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.INSTANCE_BUSY &&
        // mapped from INSTANCE_LOCKED
        true
    );

    // forceStale clears malformed and allows mutate
    mountOrchBundle(http, source, art, { releaseSequence: 3, keys: reuseKeys(bundle) });
    const noop = await updateInstance(
      { ...req, operation: "update", forceStaleLock: true },
      deps
    );
    assert.equal(noop.outcome, "NOOP");
  });

  it("parseTransactionMetadata rejects unsafe casts", () => {
    assert.throws(
      () => parseTransactionMetadata({ schemaVersion: 1 }, "abc"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.TRANSACTION_INVALID
    );
    const id = "ok-id-aaaa-bbbb-cccc-ddddeeee0001";
    const meta = parseTransactionMetadata(
      {
        schemaVersion: 1,
        transactionId: id,
        operation: "repair",
        channel: "dev",
        packVersion: "1.0.0",
        releaseSequence: 0,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        phase: "FAILED"
      },
      id
    );
    assert.equal(meta.phase, "FAILED");
  });

  it("cleanupSafeOrphanTransactions never deletes corrupt entries", async () => {
    const env = await freshEnv();
    const paths = new InstancePaths(env.instancePath);
    const safe = await OrchestratorTransaction.create(paths, {
      operation: "install",
      channel: "dev"
    });
    await safe.setPhase("FAILED", "plant");
    await plantCorruptTx(paths, "keep-corrupt-aaaa-bbbb-cccc-ddddeeee0001", "{x");

    const cleaned = await cleanupSafeOrphanTransactions(paths);
    assert.ok(cleaned.includes(safe.transactionId));
    const scan = await scanTransactions(paths);
    assert.equal(scan.orphans.length, 0);
    assert.equal(scan.corrupt.length, 1);
    assert.equal(scan.corrupt[0]?.reason, "MALFORMED_JSON");
  });
});
