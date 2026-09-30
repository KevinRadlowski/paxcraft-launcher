/**
 * PACK-10.1SYNC-13B — last-non-ready-status.json diagnostic snapshot.
 */
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import {
  inspectInstanceStatus,
  installInstance,
  lastNonReadyStatusPath
} from "../../src/application/index.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createOrchDeps
} from "../../fixtures/orchestratorHarness.js";

async function freshEnv(customInstanceRel = "instance"): Promise<{
  root: string;
  instancePath: string;
  dataDir: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "sc-status-snap-"));
  return {
    root,
    instancePath: path.join(root, customInstanceRel),
    dataDir: path.join(root, "data")
  };
}

describe("last-non-ready-status diagnostic snapshot", { concurrency: 1 }, () => {
  it("non-READY writes instance-local snapshot with status/findings evidence", async () => {
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
    const snap = lastNonReadyStatusPath(paths);
    await assert.rejects(() => access(snap));

    const modPath = path.join(paths.modsDir(), "examplemod-0.1.2.jar");
    await writeFile(modPath, Buffer.from("corrupt"));
    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "REPAIR_REQUIRED");
    assert.ok(st.findings.some(f => f.startsWith("CORRUPT:") || f.includes("CORRUPT")));

    const raw = await readFile(snap, "utf8");
    const doc = JSON.parse(raw) as {
      status: string;
      findings: string[];
      missedMigrationNotes: string[];
      installedPackVersion: string | null;
      priorPackVersions: string[];
      appliedConfigMigrations: string[];
    };
    assert.equal(doc.status, "REPAIR_REQUIRED");
    assert.ok(Array.isArray(doc.findings) && doc.findings.length > 0);
    assert.ok(doc.findings.some(f => f.includes("CORRUPT")));
    assert.ok(Array.isArray(doc.missedMigrationNotes));
    assert.equal(doc.installedPackVersion, "0.1.2");
    assert.deepEqual(doc.priorPackVersions, []);
    assert.ok(Array.isArray(doc.appliedConfigMigrations));
    assert.equal(path.dirname(snap), paths.launcherDir());
  });

  it("READY clears stale non-ready snapshot evidence", async () => {
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
    const snap = lastNonReadyStatusPath(paths);
    await mkdir(paths.launcherDir(), { recursive: true });
    await writeFile(snap, JSON.stringify({ status: "REPAIR_REQUIRED", stale: true }), "utf8");

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "READY");
    await assert.rejects(() => access(snap));
  });

  it("UPDATE_AVAILABLE writes snapshot with RELEASE_BEHIND evidence", async () => {
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
    const art2 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art2, {
      releaseSequence: 4,
      keys: {
        publicKeyPem: bundle.publicKeyPem,
        privateKeyPem: bundle.privateKeyPem,
        trust: bundle.trust,
        keyId: bundle.keyId
      }
    });

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "UPDATE_AVAILABLE");
    assert.ok(st.findings.includes("RELEASE_BEHIND"));
    const paths = new InstancePaths(env.instancePath);
    const doc = JSON.parse(await readFile(lastNonReadyStatusPath(paths), "utf8")) as {
      status: string;
      findings: string[];
    };
    assert.equal(doc.status, "UPDATE_AVAILABLE");
    assert.ok(doc.findings.includes("RELEASE_BEHIND"));
  });

  it("diagnostic write failure must not change authoritative status", async () => {
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
    const snap = lastNonReadyStatusPath(paths);
    // Occupy snapshot path with a directory so atomic write cannot replace it with a file.
    await mkdir(snap, { recursive: true });
    await writeFile(path.join(snap, "blocker"), "x", "utf8");

    await writeFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar"), Buffer.from("corrupt"));
    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "REPAIR_REQUIRED");
    assert.ok(st.findings.some(f => f.includes("CORRUPT")));
    // Path remains a directory (write failed); status still authoritative.
    const { stat } = await import("node:fs/promises");
    assert.ok((await stat(snap)).isDirectory());
  });

  it("custom instance location uses that instance launcher path for snapshot", async () => {
    const env = await freshEnv(path.join("games", "SweetCraft-Custom"));
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
    await writeFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar"), Buffer.from("corrupt"));

    const st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "REPAIR_REQUIRED");
    const snap = lastNonReadyStatusPath(paths);
    assert.ok(snap.replace(/\\/g, "/").includes("/games/SweetCraft-Custom/launcher/"));
    await access(snap);
    const doc = JSON.parse(await readFile(snap, "utf8")) as { status: string };
    assert.equal(doc.status, "REPAIR_REQUIRED");
  });
});
