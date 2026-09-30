import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import {
  FakeClock,
  createFixtureOAuthConfig,
  createMicrosoftAuthorizationFlow,
  completeAuthFromCallbackUrl,
  FetchAuthHttpTransport,
  type AuthFetchLike,
  type AuthHttpTransport,
  parseMicrosoftTokenResponse,
  parseJsonAuthBody,
  InMemoryAuthTokenStore,
  safeAuthErrorDetails
} from "../../src/auth/index.js";

const HOSTILE_MSG = "refresh_token=short secret; code=abc 123 !";
const LEAK_A = "short secret";
const LEAK_B = "abc 123 !";

function assertNoExternalSecret(blob: string): void {
  assert.ok(!blob.includes(LEAK_A), `leaked ${JSON.stringify(LEAK_A)} in ${blob}`);
  assert.ok(!blob.includes(LEAK_B), `leaked ${JSON.stringify(LEAK_B)} in ${blob}`);
  assert.ok(!blob.includes(HOSTILE_MSG), `leaked hostile message in ${blob}`);
}

function assertErrorBoundary(err: unknown): asserts err is LauncherError {
  assert.ok(err instanceof LauncherError);
  assertNoExternalSecret(err.message);
  assertNoExternalSecret(JSON.stringify(err));
  assertNoExternalSecret(JSON.stringify(err.details));
  assert.equal((err.details as { cause?: unknown }).cause, undefined);
}

describe("auth 0.4.0-alpha.3 exception-boundary", () => {
  it("fetch exception → NETWORK_ERROR { phase: fetch } without external message", async () => {
    const fetchImpl: AuthFetchLike = async () => {
      throw new Error(HOSTILE_MSG);
    };
    const transport = new FetchAuthHttpTransport({ fetchImpl });
    await assert.rejects(
      () =>
        transport.request({
          url: "https://login.example.test/token",
          method: "POST",
          body: "code=x"
        }),
      (e: unknown) => {
        assertErrorBoundary(e);
        assert.equal(e.code, ErrorCode.NETWORK_ERROR);
        assert.equal((e.details as { phase?: string }).phase, "fetch");
        return true;
      }
    );
  });

  it("body stream exception → NETWORK_ERROR { phase: body } without external message", async () => {
    const fetchImpl: AuthFetchLike = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            controller.error(new Error(HOSTILE_MSG));
          }
        }),
        { status: 200 }
      );
    const transport = new FetchAuthHttpTransport({ fetchImpl });
    await assert.rejects(
      () =>
        transport.request({
          url: "https://login.example.test/token",
          method: "POST",
          body: "code=x",
          timeoutMs: 5_000
        }),
      (e: unknown) => {
        assertErrorBoundary(e);
        assert.equal(e.code, ErrorCode.NETWORK_ERROR);
        assert.equal((e.details as { phase?: string }).phase, "body");
        return true;
      }
    );
  });

  it("JSON parse failure never copies SyntaxError.message", () => {
    const hostileBody = `{"refresh_token":"${LEAK_A}","code":"${LEAK_B}"`;
    assert.throws(
      () => parseJsonAuthBody(hostileBody, "token response"),
      (e: unknown) => {
        assertErrorBoundary(e);
        assert.equal(e.code, ErrorCode.INVALID_TOKEN_RESPONSE);
        assert.equal((e.details as { context?: string }).context, "token response");
        return true;
      }
    );
    assert.throws(
      () => parseMicrosoftTokenResponse(hostileBody, new FakeClock(0)),
      (e: unknown) => {
        assertErrorBoundary(e);
        assert.equal(e.code, ErrorCode.INVALID_TOKEN_RESPONSE);
        return true;
      }
    );
  });

  it("pipeline unknown exception → AUTH_SESSION_ERROR { stage }; AUTH_FAILED safe", async () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport: AuthHttpTransport = {
      async request() {
        throw new Error(HOSTILE_MSG);
      }
    };
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
      (e: unknown) => {
        assertErrorBoundary(e);
        assert.equal(e.code, ErrorCode.AUTH_SESSION_ERROR);
        assert.equal((e.details as { stage?: string }).stage, "AUTHORIZING_MICROSOFT");
        assert.equal((e.details as { cause?: unknown }).cause, undefined);
        return true;
      }
    );
    assert.equal(failed.length, 1);
    const payload = failed[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["errorCode", "stage"]);
    assert.equal(payload.errorCode, ErrorCode.AUTH_SESSION_ERROR);
    assertNoExternalSecret(JSON.stringify(payload));
  });

  it("safeAuthErrorDetails strips cause/message/stack and does not claim string safety", () => {
    const cleaned = safeAuthErrorDetails({
      status: 400,
      cause: HOSTILE_MSG,
      message: HOSTILE_MSG,
      stack: `Error: ${HOSTILE_MSG}`,
      oauthErrorCode: "invalid_grant"
    });
    assert.equal(cleaned.cause, undefined);
    assert.equal(cleaned.message, undefined);
    assert.equal(cleaned.stack, undefined);
    assert.equal(cleaned.oauthErrorCode, "invalid_grant");
    assertNoExternalSecret(JSON.stringify(cleaned));
  });
});
