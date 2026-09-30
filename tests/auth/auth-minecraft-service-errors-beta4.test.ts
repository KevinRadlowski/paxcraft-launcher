import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import {
  FakeClock,
  MockAuthHttpTransport,
  loginWithXbox,
  classifyMinecraftServiceError,
  minecraftLoginHttpError,
  MC_LOGIN_WITH_XBOX_URL
} from "../../src/auth/index.js";

const FAKE_LEAK_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.FAKESECRET.leak";

function assertNoRawLeak(err: LauncherError, ...needles: string[]): void {
  const blob = JSON.stringify({
    code: err.code,
    message: err.message,
    details: err.details
  });
  for (const n of needles) {
    assert.ok(!blob.includes(n), `leaked sensitive fragment: ${n}`);
  }
}

describe("auth 0.4.0-beta.4 Minecraft Services safe diagnostics", () => {
  it("403 Invalid app registration → MINECRAFT_APP_NOT_AUTHORIZED", async () => {
    const body = JSON.stringify({
      path: "/authentication/login_with_xbox",
      error: "Forbidden",
      errorType: "FORBIDDEN",
      errorMessage: "Invalid app registration, see https://aka.ms/...",
      details: { reason: "SOMETHING_ELSE" }
    });
    const c = classifyMinecraftServiceError(body);
    assert.equal(c.minecraftReason, "INVALID_APP_REGISTRATION");
    assert.equal(c.errorCode, ErrorCode.MINECRAFT_APP_NOT_AUTHORIZED);

    const transport = new MockAuthHttpTransport();
    transport.set("POST", MC_LOGIN_WITH_XBOX_URL, body, { status: 403 });
    await assert.rejects(
      () =>
        loginWithXbox({
          xsts: { token: "xsts-token", userHash: "uhs" },
          transport,
          clock: new FakeClock(1)
        }),
      (e: unknown) => {
        assert.ok(e instanceof LauncherError);
        assert.equal(e.code, ErrorCode.MINECRAFT_APP_NOT_AUTHORIZED);
        assert.equal(e.details.status, 403);
        assert.equal(e.details.minecraftReason, "INVALID_APP_REGISTRATION");
        assertNoRawLeak(
          e,
          "Invalid app registration",
          "/authentication/login_with_xbox",
          "aka.ms",
          body
        );
        return true;
      }
    );
  });

  it("403 ACCOUNT_SUSPENDED → MINECRAFT_ACCOUNT_SUSPENDED", async () => {
    const body = JSON.stringify({
      path: "/authentication/login_with_xbox",
      errorMessage: "Account suspended for policy reasons",
      details: { reason: "ACCOUNT_SUSPENDED" }
    });
    const c = classifyMinecraftServiceError(body);
    assert.equal(c.minecraftReason, "ACCOUNT_SUSPENDED");
    assert.equal(c.errorCode, ErrorCode.MINECRAFT_ACCOUNT_SUSPENDED);

    const err = minecraftLoginHttpError(403, body);
    assert.equal(err.code, ErrorCode.MINECRAFT_ACCOUNT_SUSPENDED);
    assert.equal(err.details.minecraftReason, "ACCOUNT_SUSPENDED");
    assert.equal(err.details.status, 403);
    assertNoRawLeak(err, "Account suspended for policy reasons", body, "policy reasons");
  });

  it("403 unknown JSON → INVALID_MINECRAFT_AUTH / UNKNOWN", () => {
    const body = JSON.stringify({
      path: "/authentication/login_with_xbox",
      errorMessage: "Totally novel failure shape",
      details: { reason: "WEIRD_NEW_CODE" }
    });
    const err = minecraftLoginHttpError(403, body);
    assert.equal(err.code, ErrorCode.INVALID_MINECRAFT_AUTH);
    assert.equal(err.details.minecraftReason, "UNKNOWN");
    assertNoRawLeak(err, "Totally novel failure shape", "WEIRD_NEW_CODE", body);
  });

  it("403 HTML / non-JSON → UNKNOWN", () => {
    const body = "<html><body>Forbidden gateway</body></html>";
    const err = minecraftLoginHttpError(403, body);
    assert.equal(err.code, ErrorCode.INVALID_MINECRAFT_AUTH);
    assert.equal(err.details.minecraftReason, "UNKNOWN");
    assertNoRawLeak(err, "<html>", "Forbidden gateway", body);
  });

  it("fake token in errorMessage never appears in safe diagnostic", () => {
    const body = JSON.stringify({
      errorMessage: `Invalid app registration token=${FAKE_LEAK_TOKEN}`,
      details: { reason: "OTHER", xsts: FAKE_LEAK_TOKEN }
    });
    const err = minecraftLoginHttpError(403, body);
    assert.equal(err.code, ErrorCode.MINECRAFT_APP_NOT_AUTHORIZED);
    assert.equal(err.details.minecraftReason, "INVALID_APP_REGISTRATION");
    assertNoRawLeak(err, FAKE_LEAK_TOKEN, "token=", "xsts");
    const diag = JSON.stringify({
      error: err.code,
      status: err.details.status,
      minecraftReason: err.details.minecraftReason
    });
    assert.ok(!diag.includes(FAKE_LEAK_TOKEN));
    assert.equal(
      diag,
      JSON.stringify({
        error: "MINECRAFT_APP_NOT_AUTHORIZED",
        status: 403,
        minecraftReason: "INVALID_APP_REGISTRATION"
      })
    );
  });

  it("login_with_xbox request body does not include ensureLegacyEnabled", async () => {
    const transport = new MockAuthHttpTransport();
    transport.set(
      "POST",
      MC_LOGIN_WITH_XBOX_URL,
      JSON.stringify({ access_token: "mc", expires_in: 86000 })
    );
    await loginWithXbox({
      xsts: { token: "xsts-token", userHash: "uhs" },
      transport,
      clock: new FakeClock(1)
    });
    const capturedBody = transport.consumeCapturedSensitiveBody() ?? "";
    assert.ok(capturedBody.includes("identityToken"));
    assert.ok(!capturedBody.includes("ensureLegacyEnabled"));
  });
});
