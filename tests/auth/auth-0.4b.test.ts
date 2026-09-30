import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import {
  FakeClock,
  FakeSystemBrowser,
  createFixtureOAuthConfig,
  createOAuthFlowState,
  createLoopbackCallbackWaiter,
  startLoopbackOAuthCallbackServer,
  signInInteractively,
  resolveLauncherAuthConfig,
  assertLiveAuthEnabled,
  MemorySecureRefreshTokenStore,
  UnavailableSecureRefreshTokenStore,
  SecureBackedAuthTokenStore,
  FileAccountRegistry,
  accountsRegistryPath,
  refreshAuthSession,
  restoreAuthSession,
  logoutAccount,
  MockAuthHttpTransport,
  InMemoryAccountRegistry,
  createMicrosoftAuthorizationFlow,
  MAX_CALLBACK_URL_BYTES,
  FIXTURE_MS_CLIENT_ID,
  PRODUCT_MICROSOFT_CLIENT_ID,
  ENV_MICROSOFT_CLIENT_ID,
  DEFAULT_MS_AUTHORITY
} from "../../src/auth/index.js";
import {
  installHappyAuthRoutes,
  FAKE_MS_REFRESH,
  FAKE_MS_REFRESH_ROTATED,
  FAKE_USERNAME,
  FAKE_PROFILE_ID_HYPHEN,
  msTokenBody
} from "../../fixtures/auth/fixtures.js";
import { DEFAULT_MS_TOKEN_ENDPOINT } from "../../src/auth/config.js";

const MS_REFRESH_SECRET = "MS_REFRESH_SECRET_123";
const XBOX_SECRET = "XBOX_SECRET_456";
const XSTS_SECRET = "XSTS_SECRET_789";
const MC_SECRET = "MC_SECRET_ABC";

async function retryFetch(url: string, init?: RequestInit, attempts = 40): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

describe("auth 0.4B live login offline", () => {
  it("authority is /consumers/ for personal Xbox/Minecraft accounts", () => {
    assert.equal(DEFAULT_MS_AUTHORITY, "https://login.microsoftonline.com/consumers");
  });

  it("client id product default / override / UUID validation / live gate", () => {
    const product = resolveLauncherAuthConfig({ env: {} });
    assert.equal(product.microsoftClientId, PRODUCT_MICROSOFT_CLIENT_ID);
    const overridden = resolveLauncherAuthConfig({
      env: { [ENV_MICROSOFT_CLIENT_ID]: FIXTURE_MS_CLIENT_ID }
    });
    assert.equal(overridden.microsoftClientId, FIXTURE_MS_CLIENT_ID);
    assert.throws(
      () => resolveLauncherAuthConfig({ clientId: "not-a-uuid" }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_OAUTH_CONFIG
    );
    const cfg = resolveLauncherAuthConfig({ clientId: FIXTURE_MS_CLIENT_ID });
    assert.equal(cfg.microsoftClientId, FIXTURE_MS_CLIENT_ID);
    assert.throws(
      () => assertLiveAuthEnabled({ env: {}, liveFlag: false }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.LIVE_AUTH_NOT_ENABLED
    );
    assertLiveAuthEnabled({ liveFlag: true });
  });

  it("loopback binds 127.0.0.1 only with dynamic port and localhost redirectUri", async () => {
    const clock = new FakeClock(0);
    const lb = await startLoopbackOAuthCallbackServer({ clock, path: "/" });
    try {
      assert.equal(lb.bindHost, "127.0.0.1");
      assert.ok(lb.port > 0);
      assert.equal(lb.redirectUri, `http://localhost:${lb.port}/`);
      assert.ok(!lb.redirectUri.includes("0.0.0.0"));
    } finally {
      await lb.close();
    }
  });

  it("callback GET success, POST 405, no-store, page has no secrets", async () => {
    const clock = new FakeClock(0);
    const lb = await startLoopbackOAuthCallbackServer({ clock, path: "/" });
    const flow = createOAuthFlowState({
      redirectUri: lb.redirectUri,
      clock
    });
    const waitP = lb.waitForCallback(flow, { timeoutMs: 8_000 });
    const base = `http://127.0.0.1:${lb.port}/`;

    const post = await retryFetch(base, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("cache-control"), "no-store");

    const wrong = await retryFetch(
      `${base}?code=x&state=wrong`,
      { method: "GET" }
    );
    assert.equal(wrong.status, 400);
    // waiter still open after wrong state
    const ok = await retryFetch(
      `${base}?code=auth-code&state=${encodeURIComponent(flow.state)}`
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const html = await ok.text();
    assert.ok(html.includes("Connexion réussie"));
    assert.ok(!html.includes("auth-code"));
    assert.ok(!html.includes(flow.state));
    assert.ok(!html.includes(flow.codeVerifier));
    const result = await waitP;
    assert.equal(result.code, "auth-code");
  });

  it("callback timeout and abort", async () => {
    const clock = new FakeClock(0);
    const lb = await startLoopbackOAuthCallbackServer({ clock });
    const flow = createOAuthFlowState({ redirectUri: lb.redirectUri, clock });
    await assert.rejects(
      () => lb.waitForCallback(flow, { timeoutMs: 50 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.OAUTH_FLOW_EXPIRED
    );

    const lb2 = await startLoopbackOAuthCallbackServer({ clock });
    const flow2 = createOAuthFlowState({ redirectUri: lb2.redirectUri, clock });
    const ac = new AbortController();
    const p = lb2.waitForCallback(flow2, { timeoutMs: 5_000, signal: ac.signal });
    ac.abort();
    await assert.rejects(
      () => p,
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_REQUEST_ABORTED
    );
  });

  it("legacy waiter one-shot", async () => {
    const clock = new FakeClock(0);
    const port = await freePort();
    const waiter = createLoopbackCallbackWaiter({ port, path: "/callback", clock });
    const flow = createOAuthFlowState({
      redirectUri: `http://127.0.0.1:${port}/callback`,
      clock
    });
    const waitP = waiter.waitForCallback(flow, { timeoutMs: 5_000 });
    await retryFetch(
      `http://127.0.0.1:${port}/callback?code=c1&state=${encodeURIComponent(flow.state)}`
    );
    const r = await waitP;
    assert.equal(r.code, "c1");
  });

  it("browser opens authorization URL exactly once; failure mapped", async () => {
    const browser = new FakeSystemBrowser();
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    installHappyAuthRoutes(transport);
    const store = new SecureBackedAuthTokenStore(new MemorySecureRefreshTokenStore());
    const accounts = new InMemoryAccountRegistry();

    const signP = signInInteractively({
      launcherAuth: {
        microsoftClientId: FIXTURE_MS_CLIENT_ID,
        redirectStrategy: "localhost-dynamic"
      },
      browser,
      clock,
      store,
      accounts,
      transport,
      persistRefresh: true,
      secureStore: store.secureStore,
      callbackTimeoutMs: 8_000
    });

    // Wait until browser opened
    for (let i = 0; i < 40 && browser.opened.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(browser.opened.length, 1);
    const authUrl = browser.opened[0]!;
    assert.ok(authUrl.startsWith("https://login.microsoftonline.com/consumers/"));
    const u = new URL(authUrl);
    const state = u.searchParams.get("state")!;
    const redirect = u.searchParams.get("redirect_uri")!;
    assert.ok(redirect.startsWith("http://localhost:"));
    const redir = new URL(redirect);
    await retryFetch(
      `http://127.0.0.1:${redir.port}${redir.pathname}?code=live-code&state=${encodeURIComponent(state)}`
    );
    const { session, securePersistence } = await signP;
    assert.equal(session.profile.name, FAKE_USERNAME);
    assert.equal(session.launchIdentity.uuid, FAKE_PROFILE_ID_HYPHEN);
    assert.equal(securePersistence, true);
    assert.equal(browser.opened.length, 1);

    browser.failNext = true;
    await assert.rejects(
      () => browser.open("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.BROWSER_OPEN_FAILED
    );
  });

  it("interactive abort", async () => {
    const browser = new FakeSystemBrowser();
    const clock = new FakeClock(0);
    const transport = new MockAuthHttpTransport();
    installHappyAuthRoutes(transport);
    const store = new SecureBackedAuthTokenStore(new MemorySecureRefreshTokenStore());
    const ac = new AbortController();
    const p = signInInteractively({
      launcherAuth: {
        microsoftClientId: FIXTURE_MS_CLIENT_ID,
        redirectStrategy: "localhost-dynamic"
      },
      browser,
      clock,
      store,
      transport,
      signal: ac.signal,
      callbackTimeoutMs: 5_000,
      secureStore: store.secureStore
    });
    for (let i = 0; i < 40 && browser.opened.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    ac.abort();
    await assert.rejects(
      () => p,
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_REQUEST_ABORTED
    );
  });

  it("secure store save/load/delete + multi-account + rotation + reauth", async () => {
    const secure = new MemorySecureRefreshTokenStore();
    const store = new SecureBackedAuthTokenStore(secure);
    await store.save("mc:aaa", {
      accountId: "mc:aaa",
      microsoft: {
        accessToken: "volatile",
        refreshToken: MS_REFRESH_SECRET,
        tokenType: "Bearer",
        expiresAtMs: 1
      },
      minecraft: { accessToken: MC_SECRET, expiresAtMs: 1 },
      profile: { id: "x", name: "A" },
      entitlements: { items: [], ownsMinecraftJava: true },
      updatedAtMs: 1
    });
    await store.save("mc:bbb", {
      accountId: "mc:bbb",
      microsoft: {
        accessToken: "v2",
        refreshToken: "other-refresh",
        tokenType: "Bearer",
        expiresAtMs: 1
      },
      minecraft: { accessToken: "m2", expiresAtMs: 1 },
      profile: { id: "y", name: "B" },
      entitlements: { items: [], ownsMinecraftJava: true },
      updatedAtMs: 1
    });
    assert.equal(await secure.load("mc:aaa"), MS_REFRESH_SECRET);
    const ids = await store.listAccountIds();
    assert.ok(ids.includes("mc:aaa") && ids.includes("mc:bbb"));

    // rotation
    await store.save("mc:aaa", {
      accountId: "mc:aaa",
      microsoft: {
        accessToken: "volatile2",
        refreshToken: FAKE_MS_REFRESH_ROTATED,
        tokenType: "Bearer",
        expiresAtMs: 2
      },
      minecraft: { accessToken: MC_SECRET, expiresAtMs: 2 },
      profile: { id: "x", name: "A" },
      entitlements: { items: [], ownsMinecraftJava: true },
      updatedAtMs: 2
    });
    assert.equal(await secure.load("mc:aaa"), FAKE_MS_REFRESH_ROTATED);

    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    installHappyAuthRoutes(transport);
    transport.set(
      "POST",
      DEFAULT_MS_TOKEN_ENDPOINT,
      JSON.stringify({ error: "invalid_grant" }),
      { status: 400 }
    );
    await assert.rejects(
      () =>
        restoreAuthSession(
          { config, transport, clock, store },
          "mc:aaa"
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_REAUTH_REQUIRED
    );
    assert.equal(await secure.load("mc:aaa"), null);
  });

  it("unavailable secure store refuses plaintext persistence", async () => {
    const secure = new UnavailableSecureRefreshTokenStore();
    const store = new SecureBackedAuthTokenStore(secure, { persistRefresh: true });
    await assert.rejects(
      () =>
        store.save("mc:x", {
          accountId: "mc:x",
          microsoft: {
            accessToken: "a",
            refreshToken: MS_REFRESH_SECRET,
            tokenType: "Bearer",
            expiresAtMs: 1
          },
          minecraft: { accessToken: "m", expiresAtMs: 1 },
          profile: { id: "i", name: "n" },
          entitlements: { items: [], ownsMinecraftJava: true },
          updatedAtMs: 1
        }),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.AUTH_SECURE_STORAGE_UNAVAILABLE
    );
  });

  it("accounts metadata contains no secrets; logout removes credential", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc-auth-"));
    const accounts = new FileAccountRegistry(dir);
    await accounts.upsert({
      accountId: "mc:00112233-4455-6677-8899-aabbccddeeff",
      minecraftUuid: FAKE_PROFILE_ID_HYPHEN,
      minecraftUsername: FAKE_USERNAME,
      lastUsedAtMs: 42,
      metadata: { note: "ok", refresh_token: MS_REFRESH_SECRET }
    });
    const raw = await readFile(accountsRegistryPath(dir), "utf8");
    assert.ok(!raw.includes(MS_REFRESH_SECRET));
    assert.ok(!raw.includes("refresh_token"));
    assert.ok(raw.includes(FAKE_USERNAME));

    const secure = new MemorySecureRefreshTokenStore();
    await secure.save("mc:00112233-4455-6677-8899-aabbccddeeff", MS_REFRESH_SECRET);
    const store = new SecureBackedAuthTokenStore(secure);
    const config = createFixtureOAuthConfig();
    await logoutAccount(
      {
        config,
        transport: new MockAuthHttpTransport(),
        clock: new FakeClock(0),
        store,
        accounts
      },
      "mc:00112233-4455-6677-8899-aabbccddeeff"
    );
    assert.equal(await secure.load("mc:00112233-4455-6677-8899-aabbccddeeff"), null);
    assert.equal(await accounts.get("mc:00112233-4455-6677-8899-aabbccddeeff"), undefined);
  });

  it("disk scan: no plaintext secrets after save/logout (memory secure store)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc-auth-scan-"));
    const secure = new MemorySecureRefreshTokenStore(); // intentional: no disk ciphertext in this scan
    const store = new SecureBackedAuthTokenStore(secure);
    const accounts = new FileAccountRegistry(dir);
    await store.save("mc:scan", {
      accountId: "mc:scan",
      microsoft: {
        accessToken: XBOX_SECRET,
        refreshToken: MS_REFRESH_SECRET,
        tokenType: "Bearer",
        expiresAtMs: 1
      },
      minecraft: { accessToken: MC_SECRET, expiresAtMs: 1 },
      profile: { id: "id", name: "Scan" },
      entitlements: { items: [], ownsMinecraftJava: true },
      updatedAtMs: 1
    });
    await accounts.upsert({
      accountId: "mc:scan",
      minecraftUuid: FAKE_PROFILE_ID_HYPHEN,
      minecraftUsername: "Scan",
      lastUsedAtMs: 1
    });
    await logoutAccount(
      {
        config: createFixtureOAuthConfig(),
        transport: new MockAuthHttpTransport(),
        clock: new FakeClock(0),
        store,
        accounts
      },
      "mc:scan"
    );
    const files = await walkFiles(dir);
    for (const f of files) {
      const body = await readFile(f, "utf8");
      for (const s of [MS_REFRESH_SECRET, XBOX_SECRET, XSTS_SECRET, MC_SECRET]) {
        assert.ok(!body.includes(s), `secret in ${f}`);
      }
    }
  });

  it("refresh rotation persists new refresh before completion", async () => {
    const { accountIdFromMinecraftUuid } = await import("../../src/auth/account.js");
    const accountId = accountIdFromMinecraftUuid(FAKE_PROFILE_ID_HYPHEN);
    const secure = new MemorySecureRefreshTokenStore();
    const store = new SecureBackedAuthTokenStore(secure);
    await secure.save(accountId, FAKE_MS_REFRESH);
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    installHappyAuthRoutes(transport);
    transport.set(
      "POST",
      DEFAULT_MS_TOKEN_ENDPOINT,
      msTokenBody({ refresh: FAKE_MS_REFRESH_ROTATED })
    );
    const session = await refreshAuthSession(
      { config, transport, clock, store, accounts: new InMemoryAccountRegistry() },
      accountId
    );
    assert.equal(session.microsoft.refreshToken, FAKE_MS_REFRESH_ROTATED);
    assert.equal(await secure.load(accountId), FAKE_MS_REFRESH_ROTATED);
  });

  it("MAX_CALLBACK_URL_BYTES is finite", () => {
    assert.ok(MAX_CALLBACK_URL_BYTES >= 2048);
  });
});

async function freePort(): Promise<number> {
  const { createServer } = await import("node:http");
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        s.close();
        reject(new Error("no port"));
        return;
      }
      const { port } = addr;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p);
    }
  }
  await walk(root);
  return out;
}

void createMicrosoftAuthorizationFlow;
void XSTS_SECRET;
