import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import {
  FakeClock,
  createFixtureOAuthConfig,
  createOAuthFlowState,
  generateCodeVerifier,
  exchangeAuthorizationCode,
  parseMicrosoftTokenResponse,
  parseOAuthCallbackUrl,
  createLoopbackCallbackWaiter,
  MockAuthHttpTransport,
  FetchAuthHttpTransport,
  type AuthFetchLike,
  completeAuthFromCallbackUrl,
  createMicrosoftAuthorizationFlow,
  InMemoryAuthTokenStore,
  normalizeOAuthErrorCode,
  sanitizeAuthHttpRequest,
  sanitizeAuthHeaders,
  sanitizeMicrosoftTokenSet,
  sanitizeXboxLiveToken,
  sanitizeXstsToken,
  sanitizeMinecraftAccessToken,
  sanitizeOAuthFlowState,
  safeAuthErrorDetails,
  computeExpiresAtMs,
  AUTH_REDACTED,
  DEFAULT_MS_TOKEN_ENDPOINT
} from "../../src/auth/index.js";
import {
  FAKE_MS_ACCESS,
  FAKE_MS_REFRESH,
  msTokenBody
} from "../../fixtures/auth/fixtures.js";

/** Atypical secrets that do NOT look like JWT / long opaque tokens. */
const WEIRD_MS = "weird secret !";
const WEIRD_REFRESH = "short secret";
const WEIRD_CODE = "abc 123 !";
const WEIRD_XSTS = "token with spaces";
const WEIRD_VERIFIER = generateCodeVerifier();

function textStream(chunks: Array<string | "STALL">, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (chunk === "STALL") {
          await new Promise<never>((_resolve, reject) => {
            const onAbort = () => {
              try {
                controller.error(new DOMException("Aborted", "AbortError"));
              } catch {
                // ignore
              }
              reject(new DOMException("Aborted", "AbortError"));
            };
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
          });
          return;
        }
        controller.enqueue(enc.encode(chunk));
      }
      controller.close();
    }
  });
}

function assertNoSecretLeak(blob: string, secrets: string[]): void {
  for (const s of secrets) {
    assert.ok(!blob.includes(s), `secret leaked: ${JSON.stringify(s)}`);
  }
}

describe("auth 0.4.0-alpha.2 hardening", () => {
  it("external abort before fetch → AUTH_REQUEST_ABORTED (not timeout)", async () => {
    const ac = new AbortController();
    ac.abort();
    let fetchCalled = false;
    const fetchImpl: AuthFetchLike = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };
    const transport = new FetchAuthHttpTransport({ fetchImpl });
    await assert.rejects(
      () =>
        transport.request({
          url: "https://login.example.test/token",
          method: "POST",
          body: "secret=1",
          signal: ac.signal,
          timeoutMs: 5_000
        }),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.AUTH_REQUEST_ABORTED &&
        e.code !== ErrorCode.AUTH_HTTP_TIMEOUT
    );
    assert.equal(fetchCalled, false);
  });

  it("timeout during body stall after 200 + first chunk → AUTH_HTTP_TIMEOUT", async () => {
    let fetchSignal: AbortSignal | undefined;
    const fetchImpl: AuthFetchLike = async (_url, init) => {
      fetchSignal = init?.signal;
      return new Response(textStream(["{", "STALL"], init?.signal), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const transport = new FetchAuthHttpTransport({ fetchImpl });
    const t0 = Date.now();
    await assert.rejects(
      () =>
        transport.request({
          url: "https://login.example.test/token",
          method: "POST",
          body: "code=x",
          timeoutMs: 80
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_HTTP_TIMEOUT
    );
    assert.ok(Date.now() - t0 < 2000);
    assert.ok(fetchSignal?.aborted);
  });

  it("external AbortSignal during body → AUTH_REQUEST_ABORTED (abort != timeout)", async () => {
    const ac = new AbortController();
    const fetchImpl: AuthFetchLike = async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
              if (signal?.aborted) {
                onAbort();
                return;
              }
              signal?.addEventListener("abort", onAbort, { once: true });
              setTimeout(() => ac.abort(), 30);
              void resolve;
            }).catch((e) => {
              try {
                controller.error(e);
              } catch {
                // ignore
              }
            });
          }
        }),
        { status: 200 }
      );
    };
    const transport = new FetchAuthHttpTransport({ fetchImpl });
    await assert.rejects(
      () =>
        transport.request({
          url: "https://login.example.test/token",
          method: "POST",
          body: "code=x",
          signal: ac.signal,
          timeoutMs: 10_000
        }),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.AUTH_REQUEST_ABORTED &&
        e.message.toLowerCase().includes("abort") &&
        !e.message.toLowerCase().includes("timeout")
    );
  });

  it("mock body stall: timeout vs external abort", async () => {
    const slow = new MockAuthHttpTransport();
    slow.set("POST", "https://login.example.test/token", '{"ok":true}', {
      stallAfterBytes: 1,
      stallMs: 60_000
    });
    await assert.rejects(
      () =>
        slow.request({
          url: "https://login.example.test/token",
          method: "POST",
          body: "x",
          timeoutMs: 40
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_HTTP_TIMEOUT
    );

    const aborted = new MockAuthHttpTransport();
    aborted.set("POST", "https://login.example.test/token", '{"ok":true}', {
      stallAfterBytes: 1,
      stallMs: 60_000
    });
    const ac = new AbortController();
    const p = aborted.request({
      url: "https://login.example.test/token",
      method: "POST",
      body: "x",
      signal: ac.signal,
      timeoutMs: 5_000
    });
    setTimeout(() => ac.abort(), 20);
    await assert.rejects(
      () => p,
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_REQUEST_ABORTED
    );
  });

  it("OAuth remote error_description never exposed", () => {
    const hostile = "user@example.com password=leak https://evil.example/x";
    assert.throws(
      () =>
        parseMicrosoftTokenResponse(
          JSON.stringify({
            error: "invalid_grant",
            error_description: hostile,
            error_uri: "https://evil.example/help"
          }),
          new FakeClock(0)
        ),
      (e: unknown) => {
        if (!(e instanceof LauncherError) || e.code !== ErrorCode.OAUTH_ERROR) return false;
        const blob = JSON.stringify({ message: e.message, details: e.details });
        assertNoSecretLeak(blob, [hostile, "evil.example", "password=leak"]);
        assert.equal((e.details as { oauthErrorCode?: string }).oauthErrorCode, "invalid_grant");
        assert.equal((e.details as { error_description?: string }).error_description, undefined);
        return true;
      }
    );
  });

  it("callback error_description never exposed", () => {
    const clock = new FakeClock(0);
    const flow = createOAuthFlowState({ redirectUri: "http://127.0.0.1/callback", clock });
    const hostile = "A totally hostile description with secrets!";
    assert.throws(
      () =>
        parseOAuthCallbackUrl(
          `http://127.0.0.1/callback?error=access_denied&error_description=${encodeURIComponent(hostile)}`,
          flow,
          clock
        ),
      (e: unknown) => {
        if (!(e instanceof LauncherError) || e.code !== ErrorCode.OAUTH_ERROR) return false;
        const blob = JSON.stringify({ message: e.message, details: e.details });
        assertNoSecretLeak(blob, [hostile, "error_description"]);
        assert.equal((e.details as { oauthErrorCode?: string }).oauthErrorCode, "access_denied");
        assert.ok(!blob.includes("callback?"));
        return true;
      }
    );
  });

  it("invalid OAuth error code normalized to unknown", () => {
    assert.equal(normalizeOAuthErrorCode("access_denied"), "access_denied");
    assert.equal(normalizeOAuthErrorCode("a.b-c_1"), "a.b-c_1");
    assert.equal(normalizeOAuthErrorCode("bad code!"), "unknown");
    assert.equal(normalizeOAuthErrorCode("x".repeat(65)), "unknown");
    assert.equal(normalizeOAuthErrorCode(""), "unknown");
    assert.equal(normalizeOAuthErrorCode(null), "unknown");
    assert.equal(normalizeOAuthErrorCode({ evil: true }), "unknown");
  });

  it("AuthHttpRequest safe body + Authorization/Cookie redacted", () => {
    const safe = sanitizeAuthHttpRequest({
      method: "POST",
      url: "https://login.example.test/token",
      headers: {
        Authorization: `Bearer ${WEIRD_MS}`,
        Cookie: `session=${WEIRD_REFRESH}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: `code=${WEIRD_CODE}&code_verifier=${WEIRD_VERIFIER}&refresh_token=${WEIRD_REFRESH}`
    });
    assert.equal(safe.body, AUTH_REDACTED);
    const headers = safe.headers as Record<string, string>;
    assert.equal(headers.Authorization, AUTH_REDACTED);
    assert.equal(headers.Cookie, AUTH_REDACTED);
    assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
    const blob = JSON.stringify(safe);
    assertNoSecretLeak(blob, [WEIRD_MS, WEIRD_REFRESH, WEIRD_CODE, WEIRD_VERIFIER]);

    const h = sanitizeAuthHeaders({
      "Proxy-Authorization": "Basic xxx",
      "Set-Cookie": "a=b",
      accept: "application/json"
    })!;
    assert.equal(h["Proxy-Authorization"], AUTH_REDACTED);
    assert.equal(h["Set-Cookie"], AUTH_REDACTED);
    assert.equal(h.accept, "application/json");
  });

  it("mock calls safe by default; consumeCapturedSensitiveBody is opt-in", async () => {
    const transport = new MockAuthHttpTransport();
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody());
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const flow = createOAuthFlowState({ redirectUri: config.redirectUri, clock });
    await exchangeAuthorizationCode({
      config,
      flow,
      code: WEIRD_CODE,
      state: flow.state,
      transport,
      clock
    });
    const callBlob = JSON.stringify(transport.calls);
    assertNoSecretLeak(callBlob, [WEIRD_CODE, flow.codeVerifier, FAKE_MS_ACCESS, FAKE_MS_REFRESH]);
    assert.equal(transport.calls[0]!.body, AUTH_REDACTED);
    const raw = transport.consumeCapturedSensitiveBody()!;
    assert.ok(raw.includes(encodeURIComponent(WEIRD_CODE).replace(/%20/g, "+")) || raw.includes("abc"));
    assert.ok(raw.includes("code_verifier="));
    assert.ok(!JSON.stringify(transport.calls).includes(WEIRD_CODE));
  });

  it("safe request / sanitizers contain no atypical fixture secrets", () => {
    const secrets = [WEIRD_MS, WEIRD_REFRESH, WEIRD_CODE, WEIRD_XSTS, WEIRD_VERIFIER];
    const blobs = [
      JSON.stringify(
        sanitizeAuthHttpRequest({
          method: "POST",
          url: "https://example.test/",
          headers: { Authorization: `Bearer ${WEIRD_MS}`, Cookie: WEIRD_REFRESH },
          body: `code=${WEIRD_CODE}&code_verifier=${WEIRD_VERIFIER}`
        })
      ),
      JSON.stringify(sanitizeMicrosoftTokenSet()),
      JSON.stringify(sanitizeXboxLiveToken()),
      JSON.stringify(sanitizeXstsToken()),
      JSON.stringify(sanitizeMinecraftAccessToken()),
      JSON.stringify(
        sanitizeOAuthFlowState({
          flowId: "f1",
          createdAtMs: 1,
          redirectUri: "http://127.0.0.1/callback",
          expiresAtMs: 2,
          consumed: false
        })
      ),
      JSON.stringify(
        safeAuthErrorDetails({
          status: 400,
          error: "invalid_grant",
          error_description: WEIRD_MS,
          body: WEIRD_XSTS,
          callbackUrl: `http://127.0.0.1/callback?code=${WEIRD_CODE}`
        })
      )
    ];
    for (const b of blobs) assertNoSecretLeak(b, secrets);
  });

  it("callback POST → 405 with no-store; does not consume waiter", async () => {
    const clock = new FakeClock(0);
    const port = await freePort();
    const waiter = createLoopbackCallbackWaiter({ port, clock });
    const flow = createOAuthFlowState({
      redirectUri: `http://127.0.0.1:${port}/callback`,
      clock
    });
    const waitP = waiter.waitForCallback(flow, { timeoutMs: 8_000 });

    const postRes = await retryFetch(`http://127.0.0.1:${port}/callback`, { method: "POST" });
    assert.equal(postRes.status, 405);
    assert.equal(postRes.headers.get("cache-control"), "no-store");
    assert.equal(postRes.headers.get("pragma"), "no-cache");
    assert.equal(flow.consumed, false);

    const getRes = await fetch(
      `http://127.0.0.1:${port}/callback?code=ok-code&state=${encodeURIComponent(flow.state)}`
    );
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get("cache-control"), "no-store");
    const result = await waitP;
    assert.equal(result.code, "ok-code");
    assert.equal(result.state, flow.state);
  });

  it("flow consumed after failed token exchange; second exchange → ALREADY_CONSUMED", async () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    transport.set(
      "POST",
      DEFAULT_MS_TOKEN_ENDPOINT,
      JSON.stringify({ error: "invalid_grant", error_description: "nope" }),
      { status: 400 }
    );
    const flow = createOAuthFlowState({ redirectUri: config.redirectUri, clock });
    await assert.rejects(
      () =>
        exchangeAuthorizationCode({
          config,
          flow,
          code: "c1",
          state: flow.state,
          transport,
          clock
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_REAUTH_REQUIRED
    );
    assert.equal(flow.consumed, true);
    await assert.rejects(
      () =>
        exchangeAuthorizationCode({
          config,
          flow,
          code: "c1",
          state: flow.state,
          transport,
          clock
        }),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.OAUTH_FLOW_ALREADY_CONSUMED
    );
  });

  it("expiry overflow refused; normal expires_in ok", () => {
    const clock = new FakeClock(1_000);
    assert.equal(computeExpiresAtMs(clock, 100), 1_000 + 100_000);
    assert.throws(
      () => computeExpiresAtMs(clock, Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_TOKEN_EXPIRY
    );
    const near = new FakeClock(Number.MAX_SAFE_INTEGER - 1000);
    assert.throws(
      () => computeExpiresAtMs(near, 10),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_TOKEN_EXPIRY
    );
    assert.throws(
      () =>
        parseMicrosoftTokenResponse(
          JSON.stringify({
            access_token: "x",
            token_type: "Bearer",
            expires_in: Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1
          }),
          clock
        ),
      (e: unknown) =>
        e instanceof LauncherError &&
        (e.code === ErrorCode.INVALID_TOKEN_EXPIRY || e.code === ErrorCode.INVALID_TOKEN_RESPONSE)
    );
  });

  it("AUTH_FAILED contains only stage + errorCode; state → ERROR", async () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    transport.set(
      "POST",
      DEFAULT_MS_TOKEN_ENDPOINT,
      JSON.stringify({ error: "invalid_grant", error_description: "hostile body token=leak" }),
      { status: 400 }
    );
    const store = new InMemoryAuthTokenStore();
    const emitter = new ProgressEmitter();
    const failed: unknown[] = [];
    emitter.on((e) => {
      if (e.type === "AUTH_FAILED") failed.push(e.data);
    });
    const { flow } = createMicrosoftAuthorizationFlow({ config, clock });
    await assert.rejects(
      () =>
        completeAuthFromCallbackUrl(
          { config, transport, clock, store, emitter },
          flow,
          `http://127.0.0.1:13245/callback?code=c&state=${encodeURIComponent(flow.state)}`
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_REAUTH_REQUIRED
    );
    assert.equal(failed.length, 1);
    const data = failed[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(data).sort(), ["errorCode", "stage"]);
    assert.equal(data.errorCode, ErrorCode.AUTH_REAUTH_REQUIRED);
    assert.equal(data.stage, "AUTHORIZING_MICROSOFT");
    const blob = JSON.stringify(data);
    assertNoSecretLeak(blob, ["hostile", "token=leak", "invalid_grant"]);
  });

  it("short/weird secrets redacted structurally (not format heuristics)", () => {
    const req = sanitizeAuthHttpRequest({
      method: "POST",
      url: "https://x.test/",
      headers: { Authorization: `Bearer ${WEIRD_MS}` },
      body: WEIRD_XSTS
    });
    assert.equal(req.body, AUTH_REDACTED);
    assert.equal((req.headers as Record<string, string>).Authorization, AUTH_REDACTED);
    assert.notEqual(req.body, WEIRD_XSTS);
  });
});

async function freePort(): Promise<number> {
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
