import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AuthDesktopService,
  FakeAuthBackend,
  assertFakeAuthFixturePayload,
  clearFakeAuthStore,
  loadFakeAuthStore,
  shouldUseFakeAuthBackend,
  FAKE_AUTH_FIXTURES
} from "./auth-test-helpers.js";
import type { AuthStateDto } from "../../desktop/shared/contract.js";
import { IpcChannels } from "../../desktop/shared/contract.js";

/**
 * Simulates Account-page Retry after ERROR: must call login() (not restore()).
 */
async function retryAfterError(
  svc: AuthDesktopService
): Promise<Awaited<ReturnType<AuthDesktopService["login"]>>> {
  return svc.login();
}

describe("0.6B beta.4 SUCCESS fixture / retry acceptance", () => {
  it("1. APPID_BLOCKED → login fail → SUCCESS → retry(login) → AUTHENTICATED", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    backend.applyFixture("APPID_BLOCKED");
    const fail = await svc.login();
    assert.equal(fail.state.state, "ERROR");
    assert.equal(fail.state.error?.code, "MINECRAFT_APP_NOT_AUTHORIZED");
    assert.equal(svc.getAuthenticatedAccountId(), null);

    backend.applyFixture("SUCCESS");
    assert.equal(backend.getCurrentFixture(), "SUCCESS");

    // Reproduce beta.3 bug path: restore after APPID without seed ≠ AUTHENTICATED
    const wrongPath = await svc.restore();
    assert.notEqual(wrongPath.state.state, "AUTHENTICATED");

    const ok = await retryAfterError(svc);
    assert.equal(ok.state.state, "AUTHENTICATED");
    assert.equal(ok.state.account?.minecraftUsername, "JoueurDemo");
    assert.equal(svc.getAuthenticatedAccountId(), ok.state.selectedAccountId);
    assert.equal(ok.state.error, undefined);
    assert.equal(svc.getBrowserOpenCount(), 0);
  });

  it("2. NOT_OWNED → SUCCESS → retry → AUTHENTICATED", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    backend.applyFixture("NOT_OWNED");
    const fail = await svc.login();
    assert.equal(fail.state.error?.code, "MINECRAFT_NOT_OWNED");
    backend.applyFixture("SUCCESS");
    const ok = await retryAfterError(svc);
    assert.equal(ok.state.state, "AUTHENTICATED");
    assert.equal(ok.state.account?.minecraftUsername, "JoueurDemo");
    assert.equal(svc.getBrowserOpenCount(), 0);
  });

  it("3. ERROR → SUCCESS → retry → AUTHENTICATED", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    backend.applyFixture("ERROR");
    const fail = await svc.login();
    assert.equal(fail.state.state, "ERROR");
    assert.equal(fail.state.error?.code, "AUTH_HTTP_TIMEOUT");
    backend.applyFixture("SUCCESS");
    const ok = await retryAfterError(svc);
    assert.equal(ok.state.state, "AUTHENTICATED");
    assert.equal(ok.state.account?.minecraftUsername, "JoueurDemo");
  });

  it("4. REAUTH_REQUIRED → SUCCESS → reconnect(login) → AUTHENTICATED", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    backend.applyFixture("REAUTH_REQUIRED");
    const fail = await svc.login();
    assert.equal(fail.state.state, "REAUTH_REQUIRED");
    assert.equal(fail.state.error?.code, "AUTH_REAUTH_REQUIRED");
    backend.applyFixture("SUCCESS");
    const ok = await svc.login();
    assert.equal(ok.state.state, "AUTHENTICATED");
    assert.equal(ok.state.account?.minecraftUsername, "JoueurDemo");
  });

  it("5. previous UiError cleared when next operation starts", async () => {
    const events: AuthStateDto[] = [];
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend, {
      onState: (s) => events.push({ ...s }),
      onProgress: () => undefined
    });
    backend.applyFixture("APPID_BLOCKED");
    await svc.login();
    events.length = 0;
    backend.applyFixture("SUCCESS");
    const pending = svc.login();
    // First emitted state of new login must be RESTORING without APPID error
    await pending;
    const restoring = events.find((e) => e.state === "RESTORING");
    assert.ok(restoring);
    assert.equal(restoring!.error, undefined);
  });

  it("6. previous UiError absent after successful authentication", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    backend.applyFixture("APPID_BLOCKED");
    await svc.login();
    backend.applyFixture("SUCCESS");
    const ok = await svc.login();
    assert.equal(ok.state.state, "AUTHENTICATED");
    assert.equal(ok.state.error, undefined);
    assert.equal(svc.getState().error, undefined);
  });

  it("7. new failure replaces previous error", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    backend.applyFixture("APPID_BLOCKED");
    const a = await svc.login();
    assert.equal(a.state.error?.code, "MINECRAFT_APP_NOT_AUTHORIZED");
    backend.applyFixture("NOT_OWNED");
    const b = await svc.login();
    assert.equal(b.state.error?.code, "MINECRAFT_NOT_OWNED");
    assert.notEqual(b.state.error?.code, "MINECRAFT_APP_NOT_AUTHORIZED");
  });

  it("8. SUCCESS produces JoueurDemo", async () => {
    const backend = new FakeAuthBackend();
    backend.applyFixture("SUCCESS");
    const ok = await new AuthDesktopService(backend).login();
    assert.equal(ok.state.account?.minecraftUsername, "JoueurDemo");
    assert.equal(ok.state.account?.accountId, "mc:11111111-1111-1111-1111-111111111111");
  });

  it("9. zero browser opens for all fake fixture transitions", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    for (const f of FAKE_AUTH_FIXTURES) {
      backend.applyFixture(f);
      await svc.login();
      assert.equal(svc.getBrowserOpenCount(), 0, `fixture ${f}`);
    }
    backend.applyFixture("SUCCESS");
    await svc.login();
    assert.equal(svc.getBrowserOpenCount(), 0);
  });

  it("10. fake account persistence still survives backend recreation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-b4-persist-"));
    try {
      const a = new FakeAuthBackend({ persistDir: dir });
      await new AuthDesktopService(a).login();
      const b = new FakeAuthBackend({ persistDir: dir });
      assert.equal(b.getCurrentFixture(), "SUCCESS");
      const restored = await new AuthDesktopService(b).restore();
      assert.equal(restored.state.state, "AUTHENTICATED");
      assert.equal(b.getBrowserOpenCount(), 0);
    } finally {
      clearFakeAuthStore(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("11. logout removes fake account/restorable marker", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-b4-logout-"));
    try {
      const backend = new FakeAuthBackend({ persistDir: dir });
      const svc = new AuthDesktopService(backend);
      await svc.login();
      const id = svc.getAuthenticatedAccountId()!;
      await svc.logout(id);
      assert.equal(loadFakeAuthStore(dir).accounts.length, 0);
    } finally {
      clearFakeAuthStore(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("12. restart after logout remains signed out", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-b4-restart-"));
    try {
      const a = new FakeAuthBackend({ persistDir: dir });
      const svc = new AuthDesktopService(a);
      await svc.login();
      await svc.logout(svc.getAuthenticatedAccountId()!);
      const b = new FakeAuthBackend({ persistDir: dir });
      const svc2 = new AuthDesktopService(b);
      const again = await svc2.restore();
      assert.equal(again.state.state, "SIGNED_OUT");
      assert.equal(svc2.getAuthenticatedAccountId(), null);
    } finally {
      clearFakeAuthStore(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("13. packaged cannot activate fake backend", () => {
    assert.equal(shouldUseFakeAuthBackend({ isPackaged: true, fakeEnv: "1" }), false);
  });

  it("14. fixture IPC channel exists but harness gating is Main-side", () => {
    assert.equal(IpcChannels.DEV_AUTH_SET_FIXTURE, "sc:dev:auth:setFixture");
    assert.equal(shouldUseFakeAuthBackend({ isPackaged: false, fakeEnv: "" }), false);
  });

  it("15. fixture enum remains strict", () => {
    assert.throws(() => assertFakeAuthFixturePayload({ fixture: "SUCCESS", x: 1 }));
    assert.throws(() => assertFakeAuthFixturePayload({ fixture: "NOPE" }));
    assert.equal(assertFakeAuthFixturePayload({ fixture: "SUCCESS" }), "SUCCESS");
  });

  it("beta.3 bug: restore-after-APPID without seed does not authenticate under SUCCESS", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    backend.applyFixture("APPID_BLOCKED");
    await svc.login();
    backend.applyFixture("SUCCESS");
    const restored = await svc.restore();
    assert.notEqual(restored.state.state, "AUTHENTICATED");
    assert.equal(svc.getAuthenticatedAccountId(), null);
  });
});
