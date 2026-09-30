/**
 * 0.6C desktop install — fake harness, gate, progress, errors.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FakeInstallBackend,
  InstallDesktopService,
  assertFakeInstallFixturePayload,
  clearFakeInstallStore,
  fixtureToState,
  loadFakeInstallStore,
  mapInstallError,
  normalizeInstallProgress,
  shouldUseFakeInstallBackend,
  FAKE_INSTALL_FIXTURES
} from "../../desktop/main/install/index.js";
import { CANCELLATION_SUPPORTED } from "../../desktop/shared/contract.js";
import { assertUninstallPayload } from "../../desktop/shared/validate.js";

describe("0.6C install fake harness gating", () => {
  it("packaged + fake env → never fake", () => {
    assert.equal(
      shouldUseFakeInstallBackend({ isPackaged: true, fakeEnv: "1" }),
      false
    );
  });

  it("unpackaged without env → real backend", () => {
    assert.equal(
      shouldUseFakeInstallBackend({ isPackaged: false, fakeEnv: undefined }),
      false
    );
  });

  it("unpackaged + env=1 → fake backend", () => {
    assert.equal(
      shouldUseFakeInstallBackend({ isPackaged: false, fakeEnv: "1" }),
      true
    );
  });
});

describe("0.6C CANCELLATION_SUPPORTED", () => {
  it("is false — no Cancel IPC invented", () => {
    assert.equal(CANCELLATION_SUPPORTED, false);
  });
});

describe("0.6C fixture enum + IPC payload", () => {
  it("fixture enum strict", () => {
    for (const id of FAKE_INSTALL_FIXTURES) {
      assert.ok(fixtureToState(id));
    }
    assert.throws(() => assertFakeInstallFixturePayload({ fixture: "NOPE" }));
    assert.throws(() => assertFakeInstallFixturePayload({ path: "C:\\\\evil" }));
    assert.throws(() => assertFakeInstallFixturePayload({ fixture: "READY", extra: 1 }));
  });

  it("accepts exact fixture payload", () => {
    assert.equal(assertFakeInstallFixturePayload({ fixture: "READY" }), "READY");
  });
});

describe("0.6C fake install transitions", () => {
  it("NOT_INSTALLED → install → READY", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("NOT_INSTALLED");
    const svc = new InstallDesktopService(backend);
    const phases: string[] = [];
    const sink = {
      onStatus() {},
      onProgress(p: { phase: string }) {
        phases.push(p.phase);
      }
    };
    const svc2 = new InstallDesktopService(backend, sink);
    const before = await svc2.getStatus();
    assert.equal(before.readiness, "NOT_INSTALLED");
    const after = await svc2.install();
    assert.equal(after.readiness, "READY");
    assert.ok(phases.includes("DOWNLOADING"));
    assert.ok(phases.includes("COMPLETED"));
    void svc;
  });

  it("UPDATE_AVAILABLE → update → READY", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("UPDATE_AVAILABLE");
    const svc = new InstallDesktopService(backend);
    const after = await svc.update();
    assert.equal(after.readiness, "READY");
    assert.equal(after.installedVersion, "1.1.0-fake");
  });

  it("REPAIR_REQUIRED → repair → READY", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("REPAIR_REQUIRED");
    const svc = new InstallDesktopService(backend);
    const after = await svc.repair();
    assert.equal(after.readiness, "READY");
  });

  it("READY → uninstall → NOT_INSTALLED → install → READY", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("READY");
    const svc = new InstallDesktopService(backend);
    const uninstalled = await svc.uninstall("SAFE");
    assert.equal(uninstalled.readiness, "NOT_INSTALLED");
    const reinstalled = await svc.install();
    assert.equal(reinstalled.readiness, "READY");
  });

  it("assertUninstallPayload accepts SAFE/COMPLETE only", () => {
    assert.equal(assertUninstallPayload({ mode: "SAFE" }), "SAFE");
    assert.equal(assertUninstallPayload({ mode: "COMPLETE" }), "COMPLETE");
    assert.throws(() => assertUninstallPayload({ mode: "FULL" }));
    assert.throws(() => assertUninstallPayload({ path: "C:\\\\evil" }));
  });

  it("NOT_INSTALLED uninstall is idempotent", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("NOT_INSTALLED");
    const svc = new InstallDesktopService(backend);
    const after = await svc.uninstall("SAFE");
    assert.equal(after.readiness, "NOT_INSTALLED");
  });

  it("uninstall rejects concurrent mutation", async () => {
    const backend = new FakeInstallBackend({
      stepDelayMs: 15,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    });
    backend.applyFixture("READY");
    const svc = new InstallDesktopService(backend);
    const first = svc.uninstall("SAFE");
    await assert.rejects(() => svc.install(), (e: unknown) => {
      assert.equal(mapInstallError(e).code, "INSTANCE_BUSY");
      return true;
    });
    const result = await first;
    assert.equal(result.readiness, "NOT_INSTALLED");
  });

  it("NETWORK_ERROR does not become READY", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("NETWORK_ERROR");
    const svc = new InstallDesktopService(backend);
    await assert.rejects(() => svc.install(), (e: unknown) => {
      const err = mapInstallError(e);
      assert.equal(err.code, "NETWORK_ERROR");
      assert.equal(err.messageKey, "error.install.network");
      return true;
    });
    const st = await svc.getStatus();
    assert.notEqual(st.readiness, "READY");
  });

  it("INTEGRITY_ERROR does not become READY", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("INTEGRITY_ERROR");
    const svc = new InstallDesktopService(backend);
    await assert.rejects(() => svc.update(), (e: unknown) => {
      const err = mapInstallError(e);
      assert.equal(err.code, "INTEGRITY_ERROR");
      assert.equal(err.messageKey, "error.install.integrity");
      return true;
    });
    const st = await svc.getStatus();
    assert.notEqual(st.readiness, "READY");
  });

  it("RECOVERY_REQUIRED blocks mutation", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("RECOVERY_REQUIRED");
    const svc = new InstallDesktopService(backend);
    await assert.rejects(() => svc.install(), (e: unknown) => {
      assert.equal(mapInstallError(e).code, "RECOVERY_REQUIRED");
      return true;
    });
  });

  it("BUSY rejects mutation", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("BUSY");
    const svc = new InstallDesktopService(backend);
    await assert.rejects(() => svc.update(), (e: unknown) => {
      assert.equal(mapInstallError(e).code, "INSTANCE_BUSY");
      return true;
    });
  });
});

describe("0.6C concurrency gate", () => {
  it("double install → one mutation; competing → BUSY", async () => {
    const backend = new FakeInstallBackend({
      stepDelayMs: 15,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    });
    backend.applyFixture("NOT_INSTALLED");
    const svc = new InstallDesktopService(backend);
    const first = svc.install();
    await assert.rejects(() => svc.update(), (e: unknown) => {
      assert.equal(mapInstallError(e).code, "INSTANCE_BUSY");
      return true;
    });
    await assert.rejects(() => svc.install(), (e: unknown) => {
      assert.equal(mapInstallError(e).code, "INSTANCE_BUSY");
      return true;
    });
    const result = await first;
    assert.equal(result.readiness, "READY");
    assert.equal(svc.getActiveOperation(), "IDLE");
  });

  it("gate clears after failure", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("GENERIC_ERROR");
    const svc = new InstallDesktopService(backend);
    await assert.rejects(() => svc.install());
    assert.equal(svc.getActiveOperation(), "IDLE");
  });
});

describe("0.6C progress normalization", () => {
  it("normalized progress; raw path not emitted", () => {
    const p = normalizeInstallProgress({
      phase: "DOWNLOADING",
      operation: "install",
      completedItems: 1,
      totalItems: 4,
      currentItem: "C:\\\\Users\\\\secret\\\\file.jar"
    });
    assert.equal(p.phase, "DOWNLOADING");
    assert.equal(p.percent, 25);
    assert.equal(p.currentItemLabel, undefined);
    assert.equal(p.indeterminate, false);
  });

  it("no fake percent when denominator unknown", () => {
    const p = normalizeInstallProgress({
      phase: "PLANNING",
      operation: "update"
    });
    assert.equal(p.indeterminate, true);
    assert.equal(p.percent, undefined);
  });
});

describe("0.6C success refresh", () => {
  it("successful operation does not blindly force READY without refresh", async () => {
    const statuses: string[] = [];
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("NOT_INSTALLED");
    const svc = new InstallDesktopService(backend, {
      onStatus(s) {
        statuses.push(s.readiness);
      },
      onProgress() {}
    });
    await svc.install();
    // Last status must come from getStatus refresh (READY), intermediate BUSY ok
    assert.equal(statuses.at(-1), "READY");
    assert.ok(statuses.includes("BUSY"));
  });
});

describe("0.6C error mapping", () => {
  it("maps network/integrity/trust/fs/recovery/unknown safely", () => {
    assert.equal(mapInstallError({ code: "NETWORK_ERROR" }).messageKey, "error.install.network");
    assert.equal(
      mapInstallError({ code: "DOWNLOAD_HASH_MISMATCH" }).code,
      "INTEGRITY_ERROR"
    );
    assert.equal(mapInstallError({ code: "UNSIGNED_REFUSED" }).code, "TRUST_ERROR");
    assert.equal(mapInstallError({ code: "FILE_LOCKED" }).code, "FILESYSTEM_ERROR");
    assert.equal(
      mapInstallError({ code: "INSTANCE_RECOVERY_REQUIRED" }).code,
      "RECOVERY_REQUIRED"
    );
    const unk = mapInstallError(new Error("secret path C:\\\\x and stack"));
    assert.equal(unk.code, "INTERNAL_ERROR");
    assert.equal(unk.messageKey, "error.install.generic");
    assert.ok(!JSON.stringify(unk).includes("secret"));
  });
});

describe("0.6C fake persistence", () => {
  it("persists across backend recreation; reset clears; isolated path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-install-"));
    try {
      const a = new FakeInstallBackend({ persistDir: dir, stepDelayMs: 0 });
      a.applyFixture("READY");
      const loaded = loadFakeInstallStore(dir);
      assert.equal(loaded.readiness, "READY");
      const b = new FakeInstallBackend({ persistDir: dir, stepDelayMs: 0 });
      assert.equal(b.currentFixture, "READY");
      clearFakeInstallStore(dir);
      const c = new FakeInstallBackend({ persistDir: dir, stepDelayMs: 0 });
      assert.equal(c.currentFixture, "NOT_INSTALLED");
      assert.ok(dir.includes("sc-fake-install-"));
      assert.ok(!dir.includes("launcher-data"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no real network invoked in fake harness", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("NOT_INSTALLED");
    await backend.install({});
    assert.equal(backend.networkInvocations, 0);
    assert.equal(backend.realBackendInvocations, 0);
  });
});
