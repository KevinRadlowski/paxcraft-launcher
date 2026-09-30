import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AuthDesktopService,
  FakeAuthBackend,
  assertAccountIdPayload,
  assertLoginPayload,
  evaluateIpcSenderTrust,
  createRendererTrustPolicy,
  normalizeAuthProgressDto,
  normalizeAuthStateDto,
  tryNormalizeAuthStateEvent,
  FORBIDDEN_AUTH_SECRET_KEYS
} from "./auth-test-helpers.js";
import path from "node:path";
import type { AuthStateDto, UiError } from "../../desktop/shared/contract.js";

const A = {
  accountId: "mc:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  minecraftUsername: "Alice",
  minecraftUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  lastUsedAtMs: 100
};
const B = {
  accountId: "mc:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  minecraftUsername: "Bob",
  minecraftUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  lastUsedAtMs: 200
};

describe("0.6B auth desktop service", () => {
  it("restore saved account success — no browser", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    const before = svc.getBrowserOpenCount();
    const result = await svc.restore();
    assert.equal(result.state.state, "AUTHENTICATED");
    assert.equal(result.state.account?.minecraftUsername, "Alice");
    assert.equal(svc.getBrowserOpenCount(), before);
  });

  it("restore missing credential → SIGNED_OUT / login required", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: false });
    const svc = new AuthDesktopService(backend);
    const before = svc.getBrowserOpenCount();
    const result = await svc.restore();
    assert.equal(result.state.state, "SIGNED_OUT");
    assert.equal(result.state.error?.code, "AUTH_LOGIN_REQUIRED");
    assert.equal(svc.getBrowserOpenCount(), before);
  });

  it("restore invalid_grant → REAUTH_REQUIRED — no browser", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.restoreScenario = "invalid_grant";
    const svc = new AuthDesktopService(backend);
    const before = svc.getBrowserOpenCount();
    const result = await svc.restore();
    assert.equal(result.state.state, "REAUTH_REQUIRED");
    assert.equal(svc.getBrowserOpenCount(), before);
  });

  it("restore transient error → ERROR, credential preserved", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.restoreScenario = "transient_error";
    const svc = new AuthDesktopService(backend);
    const result = await svc.restore();
    assert.equal(result.state.state, "ERROR");
    assert.equal(backend.hasCredential(A.accountId), true);
  });

  it("login success safe DTO — no secrets", async () => {
    const backend = new FakeAuthBackend();
    const svc = new AuthDesktopService(backend);
    const result = await svc.login();
    assert.equal(result.state.state, "AUTHENTICATED");
    const json = JSON.stringify(result);
    for (const key of FORBIDDEN_AUTH_SECRET_KEYS) {
      assert.ok(!json.includes(key), `must not contain ${key}`);
    }
    // Fake never opens a real browser.
    assert.equal(svc.getBrowserOpenCount(), 0);
    assert.ok(backend.getInteractiveLoginAttemptCount() >= 1);
  });

  it("login AppID blocked", async () => {
    const backend = new FakeAuthBackend();
    backend.loginScenario = "appid_blocked";
    const svc = new AuthDesktopService(backend);
    const result = await svc.login();
    assert.equal(result.state.state, "ERROR");
    assert.equal(result.state.error?.code, "MINECRAFT_APP_NOT_AUTHORIZED");
    assert.notEqual(result.state.state, "AUTHENTICATED");
  });

  it("login Minecraft not owned", async () => {
    const backend = new FakeAuthBackend();
    backend.loginScenario = "not_owned";
    const svc = new AuthDesktopService(backend);
    const result = await svc.login();
    assert.equal(result.state.error?.code, "MINECRAFT_NOT_OWNED");
  });

  it("login account mismatch", async () => {
    const backend = new FakeAuthBackend();
    backend.loginScenario = "account_mismatch";
    const svc = new AuthDesktopService(backend);
    const result = await svc.login();
    assert.equal(result.state.error?.code, "AUTH_ACCOUNT_MISMATCH");
  });

  it("logout selected account", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore();
    const result = await svc.logout(A.accountId);
    assert.equal(result.state.state, "SIGNED_OUT");
    assert.equal(result.accounts.length, 0);
  });

  it("logout one account does not affect others", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.logout(A.accountId);
    const list = await svc.listAccounts();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.accountId, B.accountId);
    assert.equal(backend.hasCredential(B.accountId), true);
  });

  it("duplicate login → AUTH_OPERATION_BUSY", async () => {
    const backend = new FakeAuthBackend();
    backend.restoreDelayMs = 50;
    const svc = new AuthDesktopService(backend);
    backend.seedAccount(A, { withCredential: true });
    const p = svc.restore();
    await assert.rejects(() => svc.login(), (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY");
    await p;
  });

  it("duplicate restore serialized / busy", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.restoreDelayMs = 40;
    const svc = new AuthDesktopService(backend);
    const first = svc.restore();
    await assert.rejects(() => svc.restore(), (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY");
    await first;
  });

  it("startup missing credential never opens browser", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: false });
    const svc = new AuthDesktopService(backend);
    assert.equal(svc.getBrowserOpenCount(), 0);
    await svc.restore();
    assert.equal(svc.getBrowserOpenCount(), 0);
  });

  it("multi-account lastUsed deterministic", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    const result = await svc.restore();
    assert.equal(result.state.selectedAccountId, B.accountId);
  });

  it("multi-account without lastUsed → AUTH_ACCOUNT_REQUIRED", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount({ ...A, lastUsedAtMs: 0 }, { withCredential: true });
    backend.seedAccount({ ...B, lastUsedAtMs: 0 }, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    const result = await svc.restore();
    assert.equal(result.state.error?.code, "AUTH_ACCOUNT_REQUIRED");
  });
});

describe("0.6B beta.2 selection / auth session hardening", () => {
  it("1. A authenticated → select B does not mark B authenticated", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    assert.equal(svc.getAuthenticatedAccountId(), A.accountId);

    const selected = await svc.select(B.accountId);
    assert.equal(svc.getSelectedAccountId(), B.accountId);
    assert.notEqual(selected.state.state, "AUTHENTICATED");
    assert.equal(selected.state.state, "SIGNED_OUT");
    assert.equal(selected.state.selectedAccountId, B.accountId);
    assert.equal(svc.getAuthenticatedAccountId(), null);
  });

  it("2. select A while A authenticated preserves authenticated state", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    const result = await svc.select(A.accountId);
    assert.equal(result.state.state, "AUTHENTICATED");
    assert.equal(svc.getAuthenticatedAccountId(), A.accountId);
    assert.equal(result.state.selectedAccountId, A.accountId);
  });

  it("3. select B → restore B → authenticated B", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const events: AuthStateDto[] = [];
    const svc = new AuthDesktopService(backend, {
      onState: (s) => events.push(s),
      onProgress: () => undefined
    });
    await svc.restore(A.accountId);
    events.length = 0;

    await svc.select(B.accountId);
    assert.equal(svc.getState().state, "SIGNED_OUT");
    assert.equal(svc.getAuthenticatedAccountId(), null);

    const restored = await svc.restore(B.accountId);
    assert.equal(restored.state.state, "AUTHENTICATED");
    assert.equal(svc.getAuthenticatedAccountId(), B.accountId);
    assert.equal(restored.state.selectedAccountId, B.accountId);

    const idxRestoring = events.findIndex((e) => e.state === "RESTORING");
    const beforeRestore = idxRestoring >= 0 ? events.slice(0, idxRestoring) : events;
    assert.ok(
      !beforeRestore.some(
        (e) => e.state === "AUTHENTICATED" && e.selectedAccountId === B.accountId
      )
    );
  });

  it("4. restore pending → select rejected BUSY", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    backend.restoreDelayMs = 60;
    const pending = svc.restore(A.accountId);
    await assert.rejects(
      () => svc.select(B.accountId),
      (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY"
    );
    assert.equal(svc.getSelectedAccountId(), A.accountId);
    await pending;
  });

  it("5. login pending → select rejected BUSY", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(B, { withCredential: true });
    backend.loginDelayMs = 60;
    const svc = new AuthDesktopService(backend);
    const pending = svc.login();
    await assert.rejects(
      () => svc.select(B.accountId),
      (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY"
    );
    await pending;
  });

  it("6. logout pending → select rejected BUSY", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    backend.logoutDelayMs = 60;
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    const pending = svc.logout(A.accountId);
    await assert.rejects(
      () => svc.select(B.accountId),
      (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY"
    );
    assert.equal(svc.getSelectedAccountId(), A.accountId);
    await pending;
  });

  it("7. select pending → incompatible op rejected", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    backend.listAccountsDelayMs = 60;
    const pending = svc.select(B.accountId);
    await assert.rejects(() => svc.login(), (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY");
    await assert.rejects(
      () => svc.restore(A.accountId),
      (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY"
    );
    await assert.rejects(
      () => svc.logout(A.accountId),
      (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY"
    );
    await pending;
  });

  it("8. selectedAccountId not mutated on rejected selection", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    const before = svc.getSelectedAccountId();
    backend.restoreDelayMs = 50;
    const pending = svc.restore(A.accountId);
    await assert.rejects(
      () => svc.select(B.accountId),
      (e: { code?: string }) => e.code === "AUTH_OPERATION_BUSY"
    );
    assert.equal(svc.getSelectedAccountId(), before);
    await pending;
  });

  it("9. post-login listAccounts failure does not fail login", async () => {
    const warnings: UiError[] = [];
    const backend = new FakeAuthBackend();
    backend.failOnListAccountsCall = 1;
    const svc = new AuthDesktopService(backend, {
      onState: () => undefined,
      onProgress: () => undefined,
      onWarning: (w) => warnings.push(w)
    });
    const result = await svc.login();
    assert.equal(result.state.state, "AUTHENTICATED");
    assert.ok(svc.getAuthenticatedAccountId());
    assert.equal(result.state.selectedAccountId, svc.getAuthenticatedAccountId());
    assert.ok(warnings.some((w) => w.code === "AUTH_ACCOUNT_METADATA_WARNING"));
    assert.notEqual(result.state.state, "ERROR");
  });

  it("10. post-restore listAccounts failure does not fail restore", async () => {
    const warnings: UiError[] = [];
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.failOnListAccountsCall = 2;
    const svc = new AuthDesktopService(backend, {
      onState: () => undefined,
      onProgress: () => undefined,
      onWarning: (w) => warnings.push(w)
    });
    const result = await svc.restore(A.accountId);
    assert.equal(result.state.state, "AUTHENTICATED");
    assert.equal(svc.getAuthenticatedAccountId(), A.accountId);
    assert.ok(warnings.some((w) => w.code === "AUTH_ACCOUNT_METADATA_WARNING"));
  });

  it("11. pre-restore listAccounts failure still prevents restore", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.failOnListAccountsCall = 1;
    const svc = new AuthDesktopService(backend);
    const result = await svc.restore(A.accountId);
    assert.equal(result.state.state, "ERROR");
    assert.equal(svc.getAuthenticatedAccountId(), null);
    assert.notEqual(result.state.state, "AUTHENTICATED");
  });

  it("12. logout B leaves authenticated A intact", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    const result = await svc.logout(B.accountId);
    assert.equal(result.state.state, "AUTHENTICATED");
    assert.equal(svc.getAuthenticatedAccountId(), A.accountId);
    assert.equal(result.state.selectedAccountId, A.accountId);
  });

  it("13. logout A clears authenticated session", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    const result = await svc.logout(A.accountId);
    assert.equal(result.state.state, "SIGNED_OUT");
    assert.equal(svc.getAuthenticatedAccountId(), null);
  });

  it("14. remaining B after logout A is not auto-authenticated", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    const result = await svc.logout(A.accountId);
    assert.equal(result.state.state, "SIGNED_OUT");
    assert.equal(svc.getSelectedAccountId(), B.accountId);
    assert.equal(svc.getAuthenticatedAccountId(), null);
    assert.notEqual(result.state.state, "AUTHENTICATED");
  });

  it("15. auth events never emit AUTHENTICATED for unvalidated selected account", async () => {
    const events: AuthStateDto[] = [];
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend, {
      onState: (s) => events.push({ ...s }),
      onProgress: () => undefined
    });
    await svc.restore(A.accountId);
    events.length = 0;
    await svc.select(B.accountId);
    for (const e of events) {
      if (e.state === "AUTHENTICATED") {
        assert.notEqual(e.selectedAccountId, B.accountId);
      }
    }
    assert.ok(events.some((e) => e.state === "SIGNED_OUT" && e.selectedAccountId === B.accountId));
  });

  it("16. getState invariant under account switching", async () => {
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend);
    await svc.restore(A.accountId);
    let state = svc.getState();
    assert.equal(state.state, "AUTHENTICATED");
    assert.equal(state.selectedAccountId, svc.getAuthenticatedAccountId());

    await svc.select(B.accountId);
    state = svc.getState();
    assert.equal(state.state, "SIGNED_OUT");
    assert.equal(state.selectedAccountId, B.accountId);
    assert.equal(svc.getAuthenticatedAccountId(), null);

    await svc.restore(B.accountId);
    state = svc.getState();
    assert.equal(state.state, "AUTHENTICATED");
    assert.equal(state.selectedAccountId, B.accountId);
    assert.equal(state.selectedAccountId, svc.getAuthenticatedAccountId());
  });

  it("17. no new secret fields in DTO/events", async () => {
    const events: AuthStateDto[] = [];
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend, {
      onState: (s) => events.push(s),
      onProgress: () => undefined
    });
    await svc.restore(A.accountId);
    await svc.select(B.accountId);
    await svc.restore(B.accountId);
    const blob = JSON.stringify({ events, state: svc.getState() });
    for (const key of FORBIDDEN_AUTH_SECRET_KEYS) {
      assert.ok(!blob.includes(`"${key}"`), `must not contain ${key}`);
    }
  });

  it("19. account selection event order A→B safe", async () => {
    const events: AuthStateDto[] = [];
    const backend = new FakeAuthBackend();
    backend.seedAccount(A, { withCredential: true });
    backend.seedAccount(B, { withCredential: true });
    const svc = new AuthDesktopService(backend, {
      onState: (s) => events.push({ ...s }),
      onProgress: () => undefined
    });
    await svc.restore(A.accountId);
    events.length = 0;
    await svc.select(B.accountId);
    await svc.restore(B.accountId);

    let sawSignedOutB = false;
    let sawRestoringB = false;
    for (const e of events) {
      if (e.state === "SIGNED_OUT" && e.selectedAccountId === B.accountId) sawSignedOutB = true;
      if (e.state === "RESTORING" && e.selectedAccountId === B.accountId) {
        assert.ok(sawSignedOutB, "SIGNED_OUT B before RESTORING B");
        sawRestoringB = true;
      }
      if (e.state === "AUTHENTICATED" && e.selectedAccountId === B.accountId) {
        assert.ok(sawRestoringB, "RESTORING B before AUTHENTICATED B");
      }
    }
    const idxAuthB = events.findIndex(
      (e) => e.state === "AUTHENTICATED" && e.selectedAccountId === B.accountId
    );
    const idxRestB = events.findIndex(
      (e) => e.state === "RESTORING" && e.selectedAccountId === B.accountId
    );
    assert.ok(idxRestB >= 0 && idxAuthB > idxRestB);
  });
});

describe("0.6B auth IPC validation & events", () => {
  it("rejects OAuth params from renderer login payload", () => {
    assert.throws(() => assertLoginPayload({ clientId: "x" }));
    assert.throws(() => assertLoginPayload({ scopes: ["a"] }));
    assert.doesNotThrow(() => assertLoginPayload(undefined));
  });

  it("validates accountId payload", () => {
    assert.equal(assertAccountIdPayload({ accountId: A.accountId }), A.accountId);
    assert.throws(() => assertAccountIdPayload({ accountId: "x", clientId: "evil" }));
  });

  it("normalizes auth state/progress events; drops malformed", () => {
    const ok = normalizeAuthStateDto({ state: "AUTHENTICATED", selectedAccountId: A.accountId });
    assert.equal(ok.state, "AUTHENTICATED");
    assert.equal(tryNormalizeAuthStateEvent({ state: "NOPE" }), null);
    const progress = normalizeAuthProgressDto({ phase: "OPENING_BROWSER" });
    assert.equal(progress.phase, "OPENING_BROWSER");
  });

  it("untrusted sender / subframe rejected for auth trust gate", () => {
    const policy = createRendererTrustPolicy({
      mode: "production",
      indexHtmlPath: path.join("C:", "app", "index.html")
    });
    const entry = (policy.target as { entryFileUrl: string }).entryFileUrl;
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: true,
        isTopFrame: true,
        frameUrl: entry
      }),
      true
    );
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: true,
        isTopFrame: false,
        frameUrl: entry
      }),
      false
    );
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: false,
        isTopFrame: true,
        frameUrl: entry
      }),
      false
    );
  });

  it("renderer-visible auth DTO has no token field names", () => {
    const dto = normalizeAuthStateDto({
      state: "AUTHENTICATED",
      account: {
        accountId: A.accountId,
        minecraftUsername: "Alice",
        minecraftUuid: A.minecraftUuid
      }
    });
    const json = JSON.stringify(dto);
    for (const key of FORBIDDEN_AUTH_SECRET_KEYS) {
      assert.ok(!json.includes(`"${key}"`));
    }
  });
});
