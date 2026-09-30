import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import {
  FakeClock,
  createFixtureOAuthConfig,
  WindowsSystemBrowser,
  WINDOWS_URL_OPEN_EXECUTABLE,
  windowsUrlOpenArgs,
  assertHttpsAuthUrl,
  MemorySecureRefreshTokenStore,
  UnavailableSecureRefreshTokenStore,
  SecureBackedAuthTokenStore,
  FileAccountRegistry,
  accountsRegistryPath,
  refreshAuthSession,
  restoreAuthSession,
  MockAuthHttpTransport,
  InMemoryAccountRegistry,
  sanitizeOAuthErrorResponse,
  formatSafeAuthDiagnostic,
  type ExecFileLike,
  type SecureRefreshTokenStore
} from "../../src/auth/index.js";
import { DEFAULT_MS_TOKEN_ENDPOINT } from "../../src/auth/config.js";
import { FAKE_MS_REFRESH, FAKE_PROFILE_ID_HYPHEN, msTokenBody } from "../../fixtures/auth/fixtures.js";
import { accountIdFromMinecraftUuid } from "../../src/auth/account.js";

class FailingSecureStore implements SecureRefreshTokenStore {
  readonly available = true;
  readonly kind = "failing";
  async save(): Promise<void> {
    throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "simulated DPAPI failure", {});
  }
  async load(): Promise<string | null> {
    return null;
  }
  async delete(): Promise<void> {}
  async listAccountIds(): Promise<string[]> {
    return [];
  }
}

describe("auth 0.4.0-beta.2 readiness", () => {
  it("browser opener is rundll32 not cmd.exe; shell:false; argv keeps &", async () => {
    const calls: Array<{ file: string; args: readonly string[]; shell: boolean }> = [];
    const execFile: ExecFileLike = async (file, args, options) => {
      calls.push({ file, args, shell: options.shell });
      return { stdout: "", stderr: "" };
    };
    const browser = new WindowsSystemBrowser({ execFile, expectMicrosoftHost: true });
    const url =
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=x&scope=a%20b&redirect_uri=http%3A%2F%2Flocalhost%3A1%2F";
    await browser.open(url);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.file, WINDOWS_URL_OPEN_EXECUTABLE);
    assert.equal(calls[0]!.file.toLowerCase().includes("cmd"), false);
    assert.deepEqual(calls[0]!.args, windowsUrlOpenArgs(url));
    assert.equal(calls[0]!.shell, false);
    assert.ok(calls[0]!.args[1]!.includes("&"));
    assert.equal(calls[0]!.args[1], url);
  });

  it("assertHttpsAuthUrl rejects userinfo and fragments; allows hermetic without MS host", () => {
    assert.throws(
      () => assertHttpsAuthUrl("https://user:pass@login.microsoftonline.com/x"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.BROWSER_OPEN_FAILED
    );
    assert.throws(
      () => assertHttpsAuthUrl("https://login.microsoftonline.com/x#frag"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.BROWSER_OPEN_FAILED
    );
    assert.throws(
      () =>
        assertHttpsAuthUrl("https://evil.example/authorize", { expectMicrosoftHost: true }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.BROWSER_OPEN_FAILED
    );
    assertHttpsAuthUrl("https://login.example.test/token"); // hermetic host OK without flag
  });

  it("invalid_grant → AUTH_REAUTH_REQUIRED and deletes credential", async () => {
    const secure = new MemorySecureRefreshTokenStore();
    const store = new SecureBackedAuthTokenStore(secure);
    await secure.save("mc:reauth", FAKE_MS_REFRESH);
    const transport = new MockAuthHttpTransport();
    transport.set(
      "POST",
      DEFAULT_MS_TOKEN_ENDPOINT,
      JSON.stringify({ error: "invalid_grant" }),
      { status: 400 }
    );
    await assert.rejects(
      () =>
        refreshAuthSession(
          {
            config: createFixtureOAuthConfig(),
            transport,
            clock: new FakeClock(0),
            store
          },
          "mc:reauth"
        ),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.AUTH_REAUTH_REQUIRED &&
        (e.details as { oauthErrorCode?: string }).oauthErrorCode === "invalid_grant"
    );
    assert.equal(await secure.load("mc:reauth"), null);
  });

  it("transient refresh failures keep credential", async () => {
    const cases: Array<{ body: string; status: number } | { throwCode: string }> = [
      { body: JSON.stringify({ error: "server_error" }), status: 500 },
      { body: JSON.stringify({ error: "temporarily_unavailable" }), status: 503 },
      { body: JSON.stringify({ error: "slow_down" }), status: 429 },
      { body: "{", status: 502 }
    ];
    for (const c of cases) {
      if (!("status" in c)) continue;
      const secure = new MemorySecureRefreshTokenStore();
      await secure.save("mc:keep", FAKE_MS_REFRESH);
      const store = new SecureBackedAuthTokenStore(secure);
      const transport = new MockAuthHttpTransport();
      transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, c.body, { status: c.status });
      await assert.rejects(
        () =>
          refreshAuthSession(
            {
              config: createFixtureOAuthConfig(),
              transport,
              clock: new FakeClock(0),
              store
            },
            "mc:keep"
          ),
        (e: unknown) => e instanceof LauncherError && e.code !== ErrorCode.AUTH_REAUTH_REQUIRED
      );
      assert.equal(await secure.load("mc:keep"), FAKE_MS_REFRESH, `status ${c.status}`);
    }

    // network / timeout / abort via custom transport
    for (const code of [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.AUTH_HTTP_TIMEOUT,
      ErrorCode.AUTH_REQUEST_ABORTED
    ]) {
      const secure = new MemorySecureRefreshTokenStore();
      await secure.save("mc:net", FAKE_MS_REFRESH);
      const store = new SecureBackedAuthTokenStore(secure);
      const transport = {
        async request() {
          throw new LauncherError(code, "transient", code === ErrorCode.NETWORK_ERROR ? { phase: "fetch" } : {});
        }
      };
      await assert.rejects(
        () =>
          refreshAuthSession(
            {
              config: createFixtureOAuthConfig(),
              transport,
              clock: new FakeClock(0),
              store
            },
            "mc:net"
          ),
        (e: unknown) => e instanceof LauncherError && e.code === code
      );
      assert.equal(await secure.load("mc:net"), FAKE_MS_REFRESH);
    }
  });

  it("invalid 2xx token response keeps credential", async () => {
    const secure = new MemorySecureRefreshTokenStore();
    await secure.save("mc:bad2xx", FAKE_MS_REFRESH);
    const store = new SecureBackedAuthTokenStore(secure);
    const transport = new MockAuthHttpTransport();
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, '{"token_type":"Bearer"}', { status: 200 });
    await assert.rejects(
      () =>
        refreshAuthSession(
          {
            config: createFixtureOAuthConfig(),
            transport,
            clock: new FakeClock(0),
            store
          },
          "mc:bad2xx"
        ),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.INVALID_TOKEN_RESPONSE
    );
    assert.equal(await secure.load("mc:bad2xx"), FAKE_MS_REFRESH);
  });

  it("restore transient failure keeps account metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc-b2-"));
    const accounts = new FileAccountRegistry(dir);
    await accounts.upsert({
      accountId: "mc:acc",
      minecraftUuid: "00112233-4455-6677-8899-aabbccddeeff",
      minecraftUsername: "KeepMe",
      lastUsedAtMs: 1
    });
    const secure = new MemorySecureRefreshTokenStore();
    await secure.save("mc:acc", FAKE_MS_REFRESH);
    const store = new SecureBackedAuthTokenStore(secure);
    const transport = new MockAuthHttpTransport();
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, "x", { status: 503 });
    await assert.rejects(
      () =>
        restoreAuthSession(
          {
            config: createFixtureOAuthConfig(),
            transport,
            clock: new FakeClock(0),
            store,
            accounts
          },
          "mc:acc"
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.OAUTH_ERROR
    );
    assert.equal(await secure.load("mc:acc"), FAKE_MS_REFRESH);
    assert.equal((await accounts.get("mc:acc"))?.minecraftUsername, "KeepMe");
  });

  it("secure save failure does not persist account metadata; no plaintext", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc-b2-fail-"));
    const accounts = new FileAccountRegistry(dir);
    const secure = new FailingSecureStore();
    const store = new SecureBackedAuthTokenStore(secure, { persistRefresh: true });
    await assert.rejects(
      () =>
        store.save("mc:x", {
          accountId: "mc:x",
          microsoft: {
            accessToken: "a",
            refreshToken: "MS_REFRESH_SECRET_123",
            tokenType: "Bearer",
            expiresAtMs: 1
          },
          minecraft: { accessToken: "m", expiresAtMs: 1 },
          profile: { id: "i", name: "n" },
          entitlements: { items: [], ownsMinecraftJava: true },
          updatedAtMs: 1
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_STORE_ERROR
    );
    // Pipeline-like: do not upsert on save failure
    assert.equal(await accounts.get("mc:x"), undefined);
    try {
      const raw = await readFile(accountsRegistryPath(dir), "utf8");
      assert.ok(!raw.includes("MS_REFRESH_SECRET_123"));
    } catch (e) {
      assert.equal((e as NodeJS.ErrnoException).code, "ENOENT");
    }
    // unavailable store still no plaintext
    const unavailable = new SecureBackedAuthTokenStore(new UnavailableSecureRefreshTokenStore(), {
      persistRefresh: true
    });
    await assert.rejects(
      () =>
        unavailable.save("mc:y", {
          accountId: "mc:y",
          microsoft: {
            accessToken: "a",
            refreshToken: "MS_REFRESH_SECRET_123",
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

  it("sanitizeOAuthErrorResponse sets reauthRequired correctly", () => {
    const reauth = sanitizeOAuthErrorResponse(JSON.stringify({ error: "invalid_grant" }), 400);
    assert.equal(reauth.code, ErrorCode.AUTH_REAUTH_REQUIRED);
    assert.equal((reauth.details as { reauthRequired?: boolean }).reauthRequired, true);

    const transient = sanitizeOAuthErrorResponse(
      JSON.stringify({ error: "temporarily_unavailable" }),
      503
    );
    assert.equal(transient.code, ErrorCode.OAUTH_ERROR);
    assert.equal((transient.details as { reauthRequired?: boolean }).reauthRequired, false);
  });

  it("safe diagnostic strips query from redirect URI", () => {
    const d = formatSafeAuthDiagnostic({
      errorCode: ErrorCode.OAUTH_ERROR,
      stage: "AUTHORIZING_MICROSOFT",
      status: 400,
      oauthErrorCode: "access_denied",
      redirectUri: "http://localhost:1234/?code=SECRET&state=S"
    });
    assert.equal(d.redirectUriBase, "http://localhost:1234/");
    assert.ok(!JSON.stringify(d).includes("SECRET"));
    assert.ok(!JSON.stringify(d).includes("code="));
  });

  it("happy refresh still works", async () => {
    const accountId = accountIdFromMinecraftUuid(FAKE_PROFILE_ID_HYPHEN);
    const secure = new MemorySecureRefreshTokenStore();
    await secure.save(accountId, FAKE_MS_REFRESH);
    const store = new SecureBackedAuthTokenStore(secure);
    const transport = new MockAuthHttpTransport();
    const { installHappyAuthRoutes } = await import("../../fixtures/auth/fixtures.js");
    installHappyAuthRoutes(transport);
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody());
    const session = await refreshAuthSession(
      {
        config: createFixtureOAuthConfig(),
        transport,
        clock: new FakeClock(0),
        store,
        accounts: new InMemoryAccountRegistry()
      },
      accountId
    );
    assert.ok(session.microsoft.accessToken);
    assert.ok(await secure.load(accountId));
  });
});
