/**
 * Offline fake-auth smoke for 0.6.0-beta.2 selection hardening.
 * No Electron / no browser.
 */
import assert from "node:assert/strict";
import { AuthDesktopService } from "../desktop/main/auth/auth-desktop-service.js";
import { FakeAuthBackend } from "../desktop/main/auth/fake-auth-backend.js";
import type { AuthStateDto } from "../desktop/shared/contract.js";

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

async function main(): Promise<void> {
  const events: AuthStateDto[] = [];
  const backend = new FakeAuthBackend();
  backend.seedAccount(A, { withCredential: true });
  backend.seedAccount(B, { withCredential: true });
  const svc = new AuthDesktopService(backend, {
    onState: (s) => events.push({ ...s }),
    onProgress: () => undefined
  });

  await svc.restore(A.accountId);
  assert.equal(svc.getAuthenticatedAccountId(), A.accountId);
  assert.equal(svc.getState().state, "AUTHENTICATED");

  events.length = 0;
  await svc.select(B.accountId);
  assert.equal(svc.getSelectedAccountId(), B.accountId);
  assert.equal(svc.getState().state, "SIGNED_OUT");
  assert.equal(svc.getAuthenticatedAccountId(), null);
  assert.ok(!events.some((e) => e.state === "AUTHENTICATED" && e.selectedAccountId === B.accountId));

  await svc.restore(B.accountId);
  assert.equal(svc.getState().state, "AUTHENTICATED");
  assert.equal(svc.getAuthenticatedAccountId(), B.accountId);

  await svc.logout(A.accountId);
  assert.equal(svc.getState().state, "AUTHENTICATED");
  assert.equal(svc.getAuthenticatedAccountId(), B.accountId);

  await svc.logout(B.accountId);
  assert.equal(svc.getState().state, "SIGNED_OUT");
  assert.equal(svc.getAuthenticatedAccountId(), null);

  console.log("fake-auth smoke OK — switch A→B / restore B / logout semantics");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
