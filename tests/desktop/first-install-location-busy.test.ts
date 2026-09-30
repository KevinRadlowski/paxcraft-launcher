/**
 * PACK-10.1G.4.1 — false "installation already in progress" on first Home install.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FakeInstallBackend,
  InstallDesktopService,
  mapInstallError
} from "../../desktop/main/install/index.js";
import type { InstallBackendPort } from "../../desktop/main/install/install-types.js";

function withSlowGetStatus(backend: FakeInstallBackend, delayMs: number): InstallBackendPort {
  return {
    getStatus: async (opts) => {
      await new Promise((r) => setTimeout(r, delayMs));
      return backend.getStatus(opts);
    },
    install: (opts) => backend.install(opts),
    update: (opts) => backend.update(opts),
    repair: (opts) => backend.repair(opts),
    uninstall: (opts) => backend.uninstall(opts)
  };
}

/** Mirrors setLocation: validation getStatus + onLocationChanged refresh. */
async function simulateSetLocationRefresh(
  install: InstallDesktopService,
  opts: { awaitLocationRefresh: boolean }
): Promise<void> {
  await install.getStatus();
  const refresh = install.getStatus();
  if (opts.awaitLocationRefresh) {
    await refresh;
  }
}

describe("PACK-10.1G.4.1 first-install false busy", () => {
  it("install rejects while CHECKING overlay is active", async () => {
    const backend = new FakeInstallBackend({
      stepDelayMs: 20,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    });
    backend.applyFixture("NOT_INSTALLED");
    const install = new InstallDesktopService(backend);

    const checking = install.getStatus();
    await assert.rejects(
      () => install.install(),
      (e: unknown) => {
        assert.equal(mapInstallError(e).code, "INSTANCE_BUSY");
        assert.equal(mapInstallError(e).messageKey, "error.install.busy");
        return true;
      }
    );
    await checking;
    assert.equal(install.getActiveOperation(), "IDLE");
  });

  it("reproduces human bug: fire-and-forget location refresh races install()", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("NOT_INSTALLED");
    const install = new InstallDesktopService(withSlowGetStatus(backend, 80));

    await simulateSetLocationRefresh(install, { awaitLocationRefresh: false });

    await assert.rejects(
      () => install.install(),
      (e: unknown) => mapInstallError(e).messageKey === "error.install.busy"
    );
    await install.getStatus();
  });

  it("fix: awaited location refresh allows immediate install on first attempt", async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture("NOT_INSTALLED");
    const install = new InstallDesktopService(withSlowGetStatus(backend, 80));

    await simulateSetLocationRefresh(install, { awaitLocationRefresh: true });
    assert.equal(install.getActiveOperation(), "IDLE");

    const after = await install.install();
    assert.equal(after.readiness, "READY");
    assert.equal(install.getActiveOperation(), "IDLE");
  });

  it("genuine install mutation still rejects concurrent install", async () => {
    const backend = new FakeInstallBackend({
      stepDelayMs: 30,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    });
    backend.applyFixture("NOT_INSTALLED");
    const install = new InstallDesktopService(backend);

    const first = install.install();
    await assert.rejects(
      () => install.install(),
      (e: unknown) => mapInstallError(e).code === "INSTANCE_BUSY"
    );
    const after = await first;
    assert.equal(after.readiness, "READY");
  });
});
