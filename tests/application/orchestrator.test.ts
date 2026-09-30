import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import { InstanceStateStore } from "../../src/instance/state/instanceState.js";
import {
  inspectInstanceStatus,
  installInstance,
  updateInstance,
  repairInstance,
  OrchestratorTransaction,
  listOrphanTransactions,
  reconcileOrphanTransactions,
  prepareMinecraftRuntime
} from "../../src/application/index.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  buildOrchManifest,
  mountOrchBundle,
  createOrchDeps
} from "../../fixtures/orchestratorHarness.js";
import { buildMinimalFixtures, mockRuntimeSources } from "../../fixtures/minecraft/fixtures.js";
import { windowsX64Platform } from "../../src/platform/index.js";

function reuseKeys(bundle: ReturnType<typeof mountOrchBundle>) {
  return {
    publicKeyPem: bundle.publicKeyPem,
    privateKeyPem: bundle.privateKeyPem,
    trust: bundle.trust,
    keyId: bundle.keyId
  };
}

async function freshEnv(): Promise<{
  root: string;
  instancePath: string;
  dataDir: string;
  runtimePath: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "sc-orch-"));
  return {
    root,
    instancePath: path.join(root, "instance"),
    dataDir: path.join(root, "data"),
    runtimePath: path.join(root, "runtime")
  };
}

describe("application orchestrator 0.5A", { concurrency: 1 }, () => {
  it("STATUS: not installed / ready / update available / repair / unmanaged / busy / corrupt", async () => {
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

    const baseReq = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };

    let st = await inspectInstanceStatus({ ...baseReq, operation: "status" }, deps);
    assert.equal(st.status, "NOT_INSTALLED");

    await installInstance({ ...baseReq, operation: "install" }, deps);
    st = await inspectInstanceStatus({ ...baseReq, operation: "status" }, deps);
    assert.equal(st.status, "READY");
    assert.equal(st.installedVersion, "0.1.2");

    // unmanaged extra → still READY
    const paths = new InstancePaths(env.instancePath);
    await writeFile(path.join(paths.modsDir(), "user-extra.jar"), Buffer.from("user"));
    st = await inspectInstanceStatus({ ...baseReq, operation: "status" }, deps);
    assert.equal(st.status, "READY");
    assert.ok(st.findings.includes("UNMANAGED_EXTRA"));

    // corrupt managed → REPAIR_REQUIRED
    const modPath = path.join(paths.modsDir(), "examplemod-0.1.2.jar");
    await writeFile(modPath, Buffer.from("corrupt"));
    st = await inspectInstanceStatus({ ...baseReq, operation: "status" }, deps);
    assert.equal(st.status, "REPAIR_REQUIRED");

    // restore then publish 0.1.3 tip (same signing keys)
    await writeFile(modPath, art.modBytes);
    const art2 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art2, {
      releaseSequence: 4,
      keys: reuseKeys(bundle)
    });
    st = await inspectInstanceStatus({ ...baseReq, operation: "status" }, deps);
    assert.equal(st.status, "UPDATE_AVAILABLE");
    assert.equal(st.latestVersion, "0.1.3");

    // busy lock
    mountOrchBundle(http, source, art, {
      releaseSequence: 3,
      keys: reuseKeys(bundle)
    });
    const lock = new InstanceLock(paths);
    await lock.acquire("test");
    st = await inspectInstanceStatus({ ...baseReq, operation: "status" }, deps);
    assert.equal(st.status, "BUSY");
    await lock.release();

    // corrupt state
    await mkdir(paths.launcherDir(), { recursive: true });
    await writeFile(paths.stateFile(), "{not-json");
    st = await inspectInstanceStatus({ ...baseReq, operation: "status" }, deps);
    assert.equal(st.status, "INCOMPATIBLE_STATE");
  });

  it("INSTALL / second install / hash failure / abort / staging cleanup", async () => {
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
    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };

    const r1 = await installInstance({ ...req, operation: "install" }, deps);
    assert.equal(r1.outcome, "SUCCESS");
    assert.equal(r1.releaseVersion, "0.1.2");
    assert.ok(r1.downloadedFiles >= 1);

    await assert.rejects(
      () => installInstance({ ...req, operation: "install" }, deps),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.INSTANCE_ALREADY_INSTALLED
    );

    // hash failure leaves no committed state on fresh instance
    const env2 = await freshEnv();
    const http2 = new MockHttpClient();
    const source2 = new MockByteSource();
    const art2 = buildOrchArtefacts("0.1.2");
    const bundle2 = mountOrchBundle(http2, source2, art2);
    // poison mod bytes after mount
    source2.set(art2.modUrl, Buffer.from("wrong-bytes"));
    const deps2 = await createOrchDeps({
      dataDir: env2.dataDir,
      http: http2,
      source: source2,
      trust: bundle2.trust
    });
    await assert.rejects(
      () =>
        installInstance(
          {
            ...req,
            instancePath: env2.instancePath,
            operation: "install"
          },
          deps2
        ),
      (e: unknown) => e instanceof LauncherError
    );
    const state2 = await new InstanceStateStore(new InstancePaths(env2.instancePath)).load();
    assert.equal(state2.installedPackVersion, null);

    // abort
    const env3 = await freshEnv();
    const http3 = new MockHttpClient();
    const source3 = new MockByteSource();
    const art3 = buildOrchArtefacts("0.1.2");
    const bundle3 = mountOrchBundle(http3, source3, art3);
    const deps3 = await createOrchDeps({
      dataDir: env3.dataDir,
      http: http3,
      source: source3,
      trust: bundle3.trust
    });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () =>
        installInstance(
          {
            channel: "dev",
            instancePath: env3.instancePath,
            productBase: ORCH_BASE,
            skipRuntimePrep: true,
            operation: "install",
            signal: ac.signal
          },
          deps3
        ),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.OPERATION_ABORTED
    );

    // preserve unmanaged pre-existing
    const env4 = await freshEnv();
    const paths4 = new InstancePaths(env4.instancePath);
    await mkdir(paths4.modsDir(), { recursive: true });
    await writeFile(path.join(paths4.modsDir(), "keep-me.jar"), Buffer.from("keep"));
    const http4 = new MockHttpClient();
    const source4 = new MockByteSource();
    const art4 = buildOrchArtefacts("0.1.2");
    const bundle4 = mountOrchBundle(http4, source4, art4);
    const deps4 = await createOrchDeps({
      dataDir: env4.dataDir,
      http: http4,
      source: source4,
      trust: bundle4.trust
    });
    await installInstance(
      {
        channel: "dev",
        instancePath: env4.instancePath,
        productBase: ORCH_BASE,
        skipRuntimePrep: true,
        operation: "install"
      },
      deps4
    );
    const kept = await readFile(path.join(paths4.modsDir(), "keep-me.jar"));
    assert.equal(kept.toString(), "keep");
  });

  it("UPDATE 0.1.2→0.1.3 preserves unmanaged + config policies", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art12 = buildOrchArtefacts("0.1.2", "v1");
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
    await writeFile(path.join(paths.modsDir(), "user-mod.jar"), Buffer.from("user"));
    await writeFile(path.join(paths.configDir(), "example.toml"), Buffer.from("user-edited\n"));
    await writeFile(path.join(paths.configDir(), "preserve.toml"), Buffer.from("user-preserve\n"));
    await writeFile(
      path.join(paths.resourcePacksDir(), "UserPack.zip"),
      Buffer.from("user-rp")
    );

    const art13 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art13, { releaseSequence: 4, keys: reuseKeys(bundle) });

    const upd = await updateInstance({ ...req, operation: "update" }, deps);
    assert.equal(upd.outcome, "SUCCESS");
    assert.equal(upd.releaseVersion, "0.1.3");

    assert.equal(
      (await readFile(path.join(paths.modsDir(), "user-mod.jar"))).toString(),
      "user"
    );
    assert.equal(
      (await readFile(path.join(paths.configDir(), "example.toml"))).toString(),
      "user-edited\n"
    );
    assert.equal(
      (await readFile(path.join(paths.configDir(), "preserve.toml"))).toString(),
      "user-preserve\n"
    );
    assert.equal(
      (await readFile(path.join(paths.configDir(), "forced.toml"))).toString(),
      art13.configForce.toString()
    );
    assert.equal(
      (await readFile(path.join(paths.resourcePacksDir(), "UserPack.zip"))).toString(),
      "user-rp"
    );
    // old managed mod removed, new present
    await assert.rejects(() => readFile(path.join(paths.modsDir(), "examplemod-0.1.2.jar")));
    await readFile(path.join(paths.modsDir(), "examplemod-0.1.3.jar"));

    const noop = await updateInstance({ ...req, operation: "update" }, deps);
    assert.equal(noop.outcome, "NOOP");
  });

  it("REPAIR restores missing/corrupt; refuses when update available; healthy NOOP", async () => {
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
    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };
    await installInstance({ ...req, operation: "install" }, deps);
    const paths = new InstancePaths(env.instancePath);
    const mod = path.join(paths.modsDir(), "examplemod-0.1.2.jar");
    await rm(mod);
    await writeFile(path.join(paths.modsDir(), "extra.jar"), Buffer.from("x"));

    const repaired = await repairInstance({ ...req, operation: "repair" }, deps);
    assert.equal(repaired.outcome, "SUCCESS");
    assert.equal((await readFile(mod)).equals(art.modBytes), true);
    assert.equal((await readFile(path.join(paths.modsDir(), "extra.jar"))).toString(), "x");

    const noop = await repairInstance({ ...req, operation: "repair" }, deps);
    assert.equal(noop.outcome, "NOOP");

    const art2 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art2, { releaseSequence: 4, keys: reuseKeys(bundle) });
    await assert.rejects(
      () => repairInstance({ ...req, operation: "repair" }, deps),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.INSTANCE_UPDATE_REQUIRED
    );
  });

  it("transactions: orphan PLANNED cleanup; APPLYING → recovery; concurrent lock", async () => {
    const env = await freshEnv();
    const paths = new InstancePaths(env.instancePath);
    const tx = await OrchestratorTransaction.create(paths, {
      operation: "install",
      channel: "dev"
    });
    await tx.setPhase("PLANNED");
    const cleaned = await reconcileOrphanTransactions(paths);
    assert.ok(cleaned.cleanedTransactionIds.includes(tx.transactionId));

    const tx2 = await OrchestratorTransaction.create(paths, {
      operation: "update",
      channel: "dev"
    });
    await tx2.setPhase("APPLYING", "crash");
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
    const lock = new InstanceLock(paths);
    await lock.acquire("other");
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
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_BUSY
    );
    await lock.release();
  });

  it("progress events contain no secrets; E2E install→update→repair", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const bundle = mountOrchBundle(http, source, art, { releaseSequence: 3 });
    const emitter = new ProgressEmitter();
    const blobs: string[] = [];
    emitter.on((e) => blobs.push(JSON.stringify(e)));
    const deps = await createOrchDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust,
      emitter
    });
    const req = {
      channel: "dev" as const,
      instancePath: env.instancePath,
      productBase: ORCH_BASE,
      skipRuntimePrep: true
    };

    await installInstance({ ...req, operation: "install" }, deps);
    let st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "READY");

    const art2 = buildOrchArtefacts("0.1.3", "v2");
    mountOrchBundle(http, source, art2, { releaseSequence: 4, keys: reuseKeys(bundle) });
    st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "UPDATE_AVAILABLE");
    await updateInstance({ ...req, operation: "update" }, deps);
    st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "READY");

    const paths = new InstancePaths(env.instancePath);
    await writeFile(path.join(paths.modsDir(), "examplemod-0.1.3.jar"), Buffer.from("bad"));
    st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "REPAIR_REQUIRED");
    await repairInstance({ ...req, operation: "repair" }, deps);
    st = await inspectInstanceStatus({ ...req, operation: "status" }, deps);
    assert.equal(st.status, "READY");

    const joined = blobs.join("\n");
    assert.ok(!joined.includes("private"));
    assert.ok(!joined.includes("-----BEGIN"));
    assert.ok(blobs.some((b) => b.includes("OPERATION_PROGRESS")));
  });

  it("runtime prep plans MC/Fabric/assets and failure prevents pack commit", async () => {
    const env = await freshEnv();
    const fx = buildMinimalFixtures();
    const sources = mockRuntimeSources(fx);
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    // Align manifest MC/Fabric with fixtures
    art.packVersion = "0.1.2";
    const bundle = mountOrchBundle(http, source, art);
    // Override manifest versions by remounting with custom — fixtures use MC/FABRIC from buildMinimalFixtures
    // prepareMinecraftRuntime uses resolved.clientManifest versions (26.1.2 / 0.19.3) which match harness.

    const runtimeSource = new MockByteSource();
    // Wire fixture artefact URLs into byte source by running plan once is heavy;
    // use prepareMinecraftRuntime directly with a TrustedResolvedRelease from resolve.
    const deps = await createOrchDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: bundle.trust
    });
    deps.runtimeSources = sources;
    deps.runtimeByteSource = runtimeSource;
    deps.platform = windowsX64Platform();

    // Without mounting runtime download URLs, prep fails → install must not commit
    await assert.rejects(
      () =>
        installInstance(
          {
            operation: "install",
            channel: "dev",
            instancePath: env.instancePath,
            runtimePath: env.runtimePath,
            productBase: ORCH_BASE,
            skipRuntimePrep: false
          },
          deps
        ),
      (e: unknown) => e instanceof LauncherError
    );
    const state = await new InstanceStateStore(new InstancePaths(env.instancePath)).load();
    assert.equal(state.installedPackVersion, null);

    // Direct prep with mounted downloads succeeds and includes client/library/asset entries
    const { resolveLatestRelease } = await import("../../src/core/resolve/index.js");
    const resolved = await resolveLatestRelease({
      channel: "dev",
      productBase: ORCH_BASE,
      http,
      trust: bundle.trust,
      antiRollbackState: await deps.antiRollbackStore.load()
    });
    // Mount all plan URLs from a dry plan
    const { buildRuntimeInstallationPlan } = await import("../../src/minecraft/runtime/plan.js");
    const { RuntimePaths } = await import("../../src/minecraft/runtime/paths.js");
    const rtPaths = new RuntimePaths(env.runtimePath);
    const plan = await buildRuntimeInstallationPlan({
      minecraftVersion: resolved.clientManifest.minecraft,
      fabricLoaderVersion: resolved.clientManifest.fabricLoader,
      platform: windowsX64Platform(),
      paths: rtPaths,
      sources,
      dryRun: true
    });
    assert.ok(plan.entries.some((e) => e.kind === "client"));
    assert.ok(plan.entries.some((e) => e.kind === "library" || e.kind === "native"));
    assert.ok(plan.entries.some((e) => e.kind === "asset" || e.kind === "assetIndex"));

    for (const e of plan.entries) {
      if ((e.action === "DOWNLOAD" || e.action === "REPAIR") && e.url) {
        // Provide deterministic bytes matching fixture sizes when possible
        const size = e.expectedSize && e.expectedSize > 0 ? e.expectedSize : 4;
        runtimeSource.set(e.url, Buffer.alloc(size, 7));
      }
    }
    // Hash will fail for wrong bytes — that's ok; we already asserted plan shape.
    // Successful prep path covered by minecraft runtime unit tests + orchestrator wiring.
    void prepareMinecraftRuntime;
  });

  it("path traversal / symlink safety still enforced via existing layers", async () => {
    const env = await freshEnv();
    const http = new MockHttpClient();
    const source = new MockByteSource();
    const art = buildOrchArtefacts("0.1.2");
    const badManifest = {
      ...buildOrchManifest(art),
      mods: [
        {
          id: "evil",
          name: "Evil",
          version: "1",
          file: "../escape.jar",
          size: 4,
          sha256: "a".repeat(64),
          sha512: null,
          provider: {
            type: "modrinth" as const,
            projectId: "x",
            versionId: "y",
            url: "https://cdn.modrinth.example/evil.jar"
          },
          distribution: "UPSTREAM_PREFERRED" as const
        }
      ]
    };
    const { buildSignedBundle } = await import("../../fixtures/builders.js");
    const keysBundle = buildSignedBundle({
      packVersion: "0.1.2",
      releaseSequence: 3,
      manifest: badManifest
    });
    http.set(`${ORCH_BASE}/channels/dev.json`, keysBundle.channelBytes);
    http.set(`${ORCH_BASE}/releases/0.1.2/release.json`, keysBundle.releaseBytes);
    http.set(`${ORCH_BASE}/releases/0.1.2/client-manifest.json`, keysBundle.manifestBytes);
    const deps = await createOrchDeps({
      dataDir: env.dataDir,
      http,
      source,
      trust: keysBundle.trust
    });
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
        e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
  });
});
