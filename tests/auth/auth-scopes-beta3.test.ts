import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FakeClock,
  createFixtureOAuthConfig,
  createMicrosoftAuthorizationFlow,
  exchangeAuthorizationCode,
  refreshMicrosoftToken,
  MockAuthHttpTransport,
  DEFAULT_MS_AUTHORITY,
  DEFAULT_MS_AUTHORIZATION_ENDPOINT,
  DEFAULT_MS_TOKEN_ENDPOINT,
  DEFAULT_MS_OAUTH_SCOPES,
  createOAuthFlowState
} from "../../src/auth/index.js";
import { msTokenBody, FAKE_MS_REFRESH } from "../../fixtures/auth/fixtures.js";

describe("auth 0.4.0-beta.3 Xbox OAuth scopes", () => {
  it("default scopes are exactly XboxLive.signin + offline_access", () => {
    assert.deepEqual([...DEFAULT_MS_OAUTH_SCOPES], ["XboxLive.signin", "offline_access"]);
    assert.ok(!DEFAULT_MS_OAUTH_SCOPES.includes("openid" as never));
    assert.ok(!DEFAULT_MS_OAUTH_SCOPES.includes("profile" as never));
    assert.ok(!(DEFAULT_MS_OAUTH_SCOPES as readonly string[]).includes("User.Read"));
    assert.ok(!(DEFAULT_MS_OAUTH_SCOPES as readonly string[]).includes("email"));
  });

  it("authority authorize and token use /consumers/", () => {
    assert.equal(DEFAULT_MS_AUTHORITY, "https://login.microsoftonline.com/consumers");
    assert.equal(
      DEFAULT_MS_AUTHORIZATION_ENDPOINT,
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
    );
    assert.equal(
      DEFAULT_MS_TOKEN_ENDPOINT,
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
    );
    const config = createFixtureOAuthConfig();
    assert.equal(config.authorizationEndpoint, DEFAULT_MS_AUTHORIZATION_ENDPOINT);
    assert.equal(config.tokenEndpoint, DEFAULT_MS_TOKEN_ENDPOINT);
  });

  it("authorization URL scopes and consumers authority", () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const { authorizationUrl } = createMicrosoftAuthorizationFlow({ config, clock });
    const u = new URL(authorizationUrl);
    assert.equal(u.origin + u.pathname, "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
    const scope = u.searchParams.get("scope") ?? "";
    const parts = scope.split(" ").filter(Boolean);
    assert.ok(parts.includes("XboxLive.signin"));
    assert.ok(parts.includes("offline_access"));
    assert.ok(!parts.includes("openid"));
    assert.ok(!parts.includes("profile"));
    assert.ok(!parts.includes("User.Read"));
    assert.ok(!parts.includes("email"));
    assert.equal(parts.sort().join(" "), ["XboxLive.signin", "offline_access"].sort().join(" "));
  });

  it("code exchange uses consumers token endpoint and does not send scope", async () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody());
    const flow = createOAuthFlowState({ redirectUri: config.redirectUri, clock });
    await exchangeAuthorizationCode({
      config,
      flow,
      code: "auth-code",
      state: flow.state,
      transport,
      clock
    });
    assert.equal(transport.calls[0]!.url, DEFAULT_MS_TOKEN_ENDPOINT);
    const raw = transport.consumeCapturedSensitiveBody()!;
    assert.ok(raw.includes("grant_type=authorization_code"));
    assert.ok(raw.includes("code_verifier="));
    assert.ok(!/(^|&)scope=/.test(raw));
  });

  it("refresh uses same Xbox scopes only — no openid/profile", async () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody());
    await refreshMicrosoftToken({
      config,
      refreshToken: FAKE_MS_REFRESH,
      transport,
      clock
    });
    assert.equal(transport.calls[0]!.url, DEFAULT_MS_TOKEN_ENDPOINT);
    const raw = transport.consumeCapturedSensitiveBody()!;
    assert.ok(raw.includes("grant_type=refresh_token"));
    const scopeMatch = raw.match(/(?:^|&)scope=([^&]*)/);
    assert.ok(scopeMatch);
    const scope = decodeURIComponent(scopeMatch![1]!.replace(/\+/g, " "));
    const parts = scope.split(" ").filter(Boolean);
    assert.deepEqual(parts.sort(), ["XboxLive.signin", "offline_access"].sort());
    assert.ok(!parts.includes("openid"));
    assert.ok(!parts.includes("profile"));
    assert.ok(!parts.includes("User.Read"));
  });
});
