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
  parseFakeAuthStore,
  shouldUseFakeAuthBackend,
  FAKE_AUTH_FIXTURES
} from "./auth-test-helpers.js";
import { FORBIDDEN_AUTH_SECRET_KEYS } from "../../desktop/shared/contract.js";
import { DESKTOP_DEV_UI_PORT, DESKTOP_DEV_SERVER_DEFAULT } from "../../desktop/shared/dev-server.js";

describe("0.6B beta.3 fake auth harness", () => {
  it("1. packaged cannot activate FakeAuthBackend via env", () => {
    assert.equal(
      shouldUseFakeAuthBackend({ isPackaged: true, fakeEnv: "1" }),
      false
    );
    assert.equal(
      shouldUseFakeAuthBackend({ isPackaged: true, fakeEnv: "true" }),
      false
    );
  });

  it("2. unpackaged + explicit flag can activate fake", () => {
    assert.equal(
      shouldUseFakeAuthBackend({ isPackaged: false, fakeEnv: "1" }),
      true
    );
    assert.equal(
      shouldUseFakeAuthBackend({ isPackaged: false, fakeEnv: "true" }),
      true
    );
    assert.equal(
      shouldUseFakeAuthBackend({ isPackaged: false, fakeEnv: undefined }),
      false
    );
    assert.equal(
      shouldUseFakeAuthBackend({ isPackaged: false, fakeEnv: "0" }),
      false
    );
  });

  it("3. fake persistent login survives backend recreation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-auth-"));
    try {
      const a = new FakeAuthBackend({ persistDir: dir });
      const svc = new AuthDesktopService(a);
      const login = await svc.login();
      assert.equal(login.state.state, "AUTHENTICATED");
      assert.equal(login.state.account?.minecraftUsername, "JoueurDemo");

      const b = new FakeAuthBackend({ persistDir: dir });
      const svc2 = new AuthDesktopService(b);
      const before = svc2.getBrowserOpenCount();
      const restored = await svc2.restore();
      assert.equal(restored.state.state, "AUTHENTICATED");
      assert.equal(restored.state.account?.minecraftUsername, "JoueurDemo");
      assert.equal(svc2.getBrowserOpenCount(), before);
    } finally {
      clearFakeAuthStore(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("4. fake logout removes persistent marker", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-auth-"));
    try {
      const a = new FakeAuthBackend({ persistDir: dir });
      const svc = new AuthDesktopService(a);
      await svc.login();
      const id = svc.getAuthenticatedAccountId()!;
      await svc.logout(id);

      const store = loadFakeAuthStore(dir);
      assert.equal(store.accounts.length, 0);

      const b = new FakeAuthBackend({ persistDir: dir });
      const list = await b.listAccounts();
      assert.equal(list.length, 0);
    } finally {
      clearFakeAuthStore(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("5. corrupt fake persistence fails safely", () => {
    assert.deepEqual(parseFakeAuthStore(null).accounts, []);
    assert.deepEqual(parseFakeAuthStore({ schemaVersion: 99, accounts: [] }).accounts, []);
    assert.deepEqual(
      parseFakeAuthStore({
        schemaVersion: 1,
        accounts: [{ accountId: "x", restorable: true }]
      }).accounts,
      []
    );
    assert.deepEqual(
      parseFakeAuthStore({
        schemaVersion: 1,
        accounts: "nope"
      }).accounts,
      []
    );

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-corrupt-"));
    try {
      fs.writeFileSync(path.join(dir, "accounts.json"), "{not-json", "utf8");
      const backend = new FakeAuthBackend({ persistDir: dir });
      assert.equal(backend.getBrowserOpenCount(), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("6. fake store never contains forbidden auth secret keys", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-sec-"));
    try {
      const backend = new FakeAuthBackend({ persistDir: dir });
      const svc = new AuthDesktopService(backend);
      await svc.login();
      const raw = fs.readFileSync(path.join(dir, "accounts.json"), "utf8");
      for (const key of FORBIDDEN_AUTH_SECRET_KEYS) {
        assert.ok(!raw.includes(`"${key}"`), `must not contain ${key}`);
      }
      assert.ok(raw.includes('"restorable"'));
    } finally {
      clearFakeAuthStore(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("7. bootstrap fake restore opens browser 0 times", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-br-"));
    try {
      const seed = new FakeAuthBackend({ persistDir: dir });
      await new AuthDesktopService(seed).login();

      const backend = new FakeAuthBackend({ persistDir: dir });
      const svc = new AuthDesktopService(backend);
      assert.equal(svc.getBrowserOpenCount(), 0);
      await svc.restore();
      assert.equal(svc.getBrowserOpenCount(), 0);
    } finally {
      clearFakeAuthStore(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("15. fixture enum validation", () => {
    for (const fixture of FAKE_AUTH_FIXTURES) {
      assert.equal(assertFakeAuthFixturePayload({ fixture }), fixture);
    }
    assert.throws(() => assertFakeAuthFixturePayload({ fixture: "EVIL" }));
    assert.throws(() => assertFakeAuthFixturePayload({ fixture: "SUCCESS", extra: 1 }));
    assert.throws(() => assertFakeAuthFixturePayload({ clientId: "x" }));
    assert.throws(() => assertFakeAuthFixturePayload(undefined));
  });

  it("16. APPID fixture maps correct French UX", async () => {
    const backend = new FakeAuthBackend();
    backend.applyFixture("APPID_BLOCKED");
    const result = await new AuthDesktopService(backend).login();
    assert.equal(result.state.error?.code, "MINECRAFT_APP_NOT_AUTHORIZED");
    assert.equal(result.state.error?.messageKey, "error.minecraft_app_not_authorized");
  });

  it("17. REAUTH fixture maps correct UX", async () => {
    const backend = new FakeAuthBackend();
    backend.applyFixture("REAUTH_REQUIRED");
    const result = await new AuthDesktopService(backend).login();
    assert.equal(result.state.state, "REAUTH_REQUIRED");
    assert.equal(result.state.error?.code, "AUTH_REAUTH_REQUIRED");
  });

  it("18. NOT_OWNED fixture maps correct UX", async () => {
    const backend = new FakeAuthBackend();
    backend.applyFixture("NOT_OWNED");
    const result = await new AuthDesktopService(backend).login();
    assert.equal(result.state.error?.code, "MINECRAFT_NOT_OWNED");
    assert.equal(result.state.error?.messageKey, "error.minecraft_not_owned");
  });

  it("dev port defaults to 4201", () => {
    assert.equal(DESKTOP_DEV_UI_PORT, 4201);
    assert.equal(DESKTOP_DEV_SERVER_DEFAULT, "http://127.0.0.1:4201/");
  });

  it("13/14. fixture channel only when harness active (gating logic)", () => {
    assert.equal(shouldUseFakeAuthBackend({ isPackaged: true, fakeEnv: "1" }), false);
    assert.equal(shouldUseFakeAuthBackend({ isPackaged: false, fakeEnv: "" }), false);
  });
});
