import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import {
  FakeClock,
  createFixtureOAuthConfig,
  generateCodeVerifier,
  computeCodeChallengeS256,
  createOAuthFlowState,
  assertFlowUsable,
  consumeFlow,
  createMicrosoftAuthorizationFlow,
  authorizationUrlContainsCodeVerifier,
  exchangeAuthorizationCode,
  refreshMicrosoftToken,
  parseMicrosoftTokenResponse,
  parseOAuthCallbackUrl,
  MockAuthHttpTransport,
  authenticateXboxLive,
  authorizeXsts,
  parseXboxTokenResponse,
  loginWithXbox,
  parseEntitlements,
  ownsMinecraftJava,
  assertOwnsMinecraftJava,
  parseMinecraftProfile,
  normalizeMinecraftUuid,
  createLaunchIdentityFromMinecraftSession,
  InMemoryAuthTokenStore,
  InMemoryAccountRegistry,
  completeAuthFromCallbackUrl,
  logoutAccount,
  AuthStateMachine,
  redactAuthValue,
  AUTH_REDACTED,
  DEFAULT_MS_TOKEN_ENDPOINT,
  XBOX_USER_AUTH_URL,
  XSTS_AUTH_URL,
  FIXTURE_MS_CLIENT_ID
} from "../../src/auth/index.js";
import {
  FAKE_MS_ACCESS,
  FAKE_MS_REFRESH,
  FAKE_MS_REFRESH_ROTATED,
  FAKE_MC_ACCESS,
  FAKE_PROFILE_ID_RAW,
  FAKE_PROFILE_ID_HYPHEN,
  FAKE_USERNAME,
  FAKE_UHS,
  installHappyAuthRoutes,
  msTokenBody,
  xboxBody,
  xstsBody,
  entitlementsOwnedBody,
  entitlementsEmptyBody,
  profileBody,
  mcLoginBody,
  sha256Base64Url
} from "../../fixtures/auth/fixtures.js";

describe("auth 0.4A", () => {
  it("PKCE verifier format and S256 challenge", () => {
    const v = generateCodeVerifier();
    assert.ok(v.length >= 43 && v.length <= 128);
    assert.match(v, /^[A-Za-z0-9\-._~]+$/);
    const challenge = computeCodeChallengeS256(v);
    assert.equal(challenge, sha256Base64Url(v));
    assert.ok(!challenge.includes("+"));
    assert.ok(!challenge.includes("/"));
  });

  it("state random; flow expiry / one-shot / mismatch", () => {
    const clock = new FakeClock(1_000_000);
    const flow = createOAuthFlowState({
      redirectUri: "http://127.0.0.1:13245/callback",
      clock,
      ttlMs: 1000
    });
    assert.notEqual(flow.state, flow.codeVerifier);
    assertFlowUsable(flow, clock, flow.state);
    assert.throws(
      () => assertFlowUsable(flow, clock, "wrong"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.OAUTH_STATE_MISMATCH
    );
    clock.advance(2000);
    assert.throws(
      () => assertFlowUsable(flow, clock),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.OAUTH_FLOW_EXPIRED
    );
    const flow2 = createOAuthFlowState({
      redirectUri: "http://127.0.0.1:13245/callback",
      clock: new FakeClock(0),
      ttlMs: 10_000
    });
    consumeFlow(flow2);
    assert.throws(
      () => assertFlowUsable(flow2, new FakeClock(0)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.OAUTH_FLOW_ALREADY_CONSUMED
    );
  });

  it("authorization URL has PKCE S256 and no codeVerifier", () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const { flow, authorizationUrl } = createMicrosoftAuthorizationFlow({ config, clock });
    const u = new URL(authorizationUrl);
    assert.equal(u.searchParams.get("client_id"), FIXTURE_MS_CLIENT_ID);
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("state"), flow.state);
    assert.equal(u.searchParams.get("code_challenge"), computeCodeChallengeS256(flow.codeVerifier));
    assert.equal(authorizationUrlContainsCodeVerifier(authorizationUrl, flow.codeVerifier), false);
  });

  it("token exchange request has no client_secret; validates expiresAt", async () => {
    const clock = new FakeClock(5_000);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody({ expires_in: 100 }));
    const flow = createOAuthFlowState({ redirectUri: config.redirectUri, clock, ttlMs: 60_000 });
    const tokens = await exchangeAuthorizationCode({
      config,
      flow,
      code: "auth-code-fake",
      state: flow.state,
      transport,
      clock
    });
    assert.equal(tokens.accessToken, FAKE_MS_ACCESS);
    assert.equal(tokens.expiresAtMs, 5_000 + 100_000);
    assert.equal(tokens.refreshToken, FAKE_MS_REFRESH);
    const call = transport.calls[0]!;
    assert.equal(call.body, AUTH_REDACTED);
    assert.equal(call.hadBody, true);
    const rawBody = transport.consumeCapturedSensitiveBody()!;
    assert.ok(!rawBody.includes("client_secret"));
    assert.ok(rawBody.includes("code_verifier="));
    assert.equal(call.idempotent, false);
    assert.throws(
      () => parseMicrosoftTokenResponse(JSON.stringify({ access_token: "x", token_type: "Bearer", expires_in: -1 }), clock),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_TOKEN_RESPONSE
    );
  });

  it("refresh rotates refresh_token when provided", async () => {
    const clock = new FakeClock(0);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    transport.set(
      "POST",
      DEFAULT_MS_TOKEN_ENDPOINT,
      msTokenBody({ refresh: FAKE_MS_REFRESH_ROTATED })
    );
    const tokens = await refreshMicrosoftToken({
      config,
      refreshToken: FAKE_MS_REFRESH,
      transport,
      clock
    });
    assert.equal(tokens.refreshToken, FAKE_MS_REFRESH_ROTATED);
    const raw = transport.consumeCapturedSensitiveBody()!;
    assert.ok(!raw.includes("client_secret"));
    assert.equal(transport.calls[0]!.body, AUTH_REDACTED);
  });

  it("OAuth error sanitized without tokens", () => {
    assert.throws(
      () =>
        parseMicrosoftTokenResponse(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "bad",
            access_token: FAKE_MS_ACCESS
          }),
          new FakeClock(0)
        ),
      (e: unknown) => {
        if (!(e instanceof LauncherError) || e.code !== ErrorCode.OAUTH_ERROR) return false;
        return !JSON.stringify(e.details).includes(FAKE_MS_ACCESS);
      }
    );
  });

  it("Xbox / XSTS / missing userHash / XSTS error mapping", async () => {
    const clock = new FakeClock(0);
    const transport = new MockAuthHttpTransport();
    transport.set("POST", XBOX_USER_AUTH_URL, xboxBody());
    const xbox = await authenticateXboxLive({
      microsoftAccessToken: FAKE_MS_ACCESS,
      transport,
      clock
    });
    assert.equal(xbox.userHash, FAKE_UHS);

    assert.throws(
      () => parseXboxTokenResponse(JSON.stringify({ Token: "x" }), clock),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_XBOX_RESPONSE
    );

    transport.set("POST", XSTS_AUTH_URL, xstsBody());
    const xsts = await authorizeXsts({ xbox, transport, clock });
    assert.equal(xsts.userHash, FAKE_UHS);

    transport.set(
      "POST",
      XSTS_AUTH_URL,
      JSON.stringify({ XErr: 2148916233, Message: "no xbox" }),
      { status: 401 }
    );
    await assert.rejects(
      () => authorizeXsts({ xbox, transport, clock }),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.XSTS_AUTHORIZATION_FAILED &&
        (e.details as { eligibility?: string }).eligibility === "no_xbox_account"
    );
  });

  it("Minecraft login, entitlements owned/not owned, profile, UUID normalize", async () => {
    const clock = new FakeClock(10);
    assert.equal(normalizeMinecraftUuid(FAKE_PROFILE_ID_RAW), FAKE_PROFILE_ID_HYPHEN);
    assert.equal(normalizeMinecraftUuid(FAKE_PROFILE_ID_HYPHEN), FAKE_PROFILE_ID_HYPHEN);
    assert.throws(
      () => normalizeMinecraftUuid("zz"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_UUID
    );
    assert.throws(
      () => normalizeMinecraftUuid("00112233445566778899aabbccddee"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_UUID
    );

    const transport = new MockAuthHttpTransport();
    transport.set("POST", "https://api.minecraftservices.com/authentication/login_with_xbox", mcLoginBody());
    const mc = await loginWithXbox({
      xsts: { token: "t", userHash: FAKE_UHS },
      transport,
      clock
    });
    assert.equal(mc.accessToken, FAKE_MC_ACCESS);

    const owned = parseEntitlements(entitlementsOwnedBody());
    assert.equal(ownsMinecraftJava(owned.items), true);
    assertOwnsMinecraftJava(owned);
    const empty = parseEntitlements(entitlementsEmptyBody());
    assert.throws(
      () => assertOwnsMinecraftJava(empty),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.MINECRAFT_NOT_OWNED
    );

    const profile = parseMinecraftProfile(profileBody());
    assert.equal(profile.name, FAKE_USERNAME);
  });

  it("LaunchIdentity bridge uses Minecraft token not Microsoft token", () => {
    const identity = createLaunchIdentityFromMinecraftSession({
      minecraftAccessToken: { accessToken: FAKE_MC_ACCESS, expiresAtMs: 999 },
      profile: { id: FAKE_PROFILE_ID_RAW, name: FAKE_USERNAME }
    });
    assert.equal(identity.accessToken, FAKE_MC_ACCESS);
    assert.notEqual(identity.accessToken, FAKE_MS_ACCESS);
    assert.equal(identity.uuid, FAKE_PROFILE_ID_HYPHEN);
    assert.equal(identity.userType, "msa");
  });

  it("full pipeline + store + logout + events without secrets", async () => {
    const clock = new FakeClock(1_000);
    const config = createFixtureOAuthConfig();
    const transport = new MockAuthHttpTransport();
    installHappyAuthRoutes(transport);
    const store = new InMemoryAuthTokenStore();
    const accounts = new InMemoryAccountRegistry();
    const emitter = new ProgressEmitter();
    const blobs: string[] = [];
    emitter.on((e) => blobs.push(JSON.stringify({ type: e.type, data: e.data })));

    const { flow } = createMicrosoftAuthorizationFlow({ config, clock, emitter });
    const callbackUrl = `http://127.0.0.1:13245/callback?code=fake-code&state=${encodeURIComponent(flow.state)}`;
    const session = await completeAuthFromCallbackUrl(
      { config, transport, clock, store, accounts, emitter },
      flow,
      callbackUrl
    );
    assert.equal(session.state, "SIGNED_IN");
    assert.equal(session.profile.name, FAKE_USERNAME);
    assert.equal(session.launchIdentity.accessToken, FAKE_MC_ACCESS);
    assert.ok(await store.load(session.accountId));

    const secrets = [
      FAKE_MS_ACCESS,
      FAKE_MS_REFRESH,
      FAKE_MC_ACCESS,
      flow.codeVerifier,
      "fake-code"
    ];
    for (const b of blobs) {
      for (const s of secrets) {
        assert.ok(!b.includes(s), `secret leaked in event: ${s}`);
      }
    }

    await logoutAccount({ config, transport, clock, store, accounts, emitter }, session.accountId);
    assert.equal(await store.load(session.accountId), null);
    assert.equal(accounts.get(session.accountId), undefined);
  });

  it("auth redaction + state machine + HTTP timeout/size/status", async () => {
    const sm = new AuthStateMachine();
    assert.equal(sm.current, "SIGNED_OUT");
    sm.transition("AUTHORIZING_MICROSOFT");
    assert.equal(sm.current, "AUTHORIZING_MICROSOFT");

    const redacted = redactAuthValue({
      access_token: FAKE_MS_ACCESS,
      nested: { refresh_token: FAKE_MS_REFRESH, ok: 1 }
    }) as Record<string, unknown>;
    assert.equal(redacted.access_token, AUTH_REDACTED);
    assert.equal((redacted.nested as Record<string, unknown>).refresh_token, AUTH_REDACTED);

    const transport = new MockAuthHttpTransport();
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, "x".repeat(10), { status: 500 });
    await assert.rejects(
      async () => {
        const clock = new FakeClock(0);
        const config = createFixtureOAuthConfig();
        const flow = createOAuthFlowState({ redirectUri: config.redirectUri, clock });
        await exchangeAuthorizationCode({
          config,
          flow,
          code: "c",
          state: flow.state,
          transport,
          clock
        });
      },
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.OAUTH_ERROR
    );

    const slow = new MockAuthHttpTransport();
    slow.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody(), { delayMs: 50_000 });
    await assert.rejects(
      async () => {
        const clock = new FakeClock(0);
        const config = createFixtureOAuthConfig();
        const flow = createOAuthFlowState({ redirectUri: config.redirectUri, clock });
        await exchangeAuthorizationCode({
          config,
          flow,
          code: "c",
          state: flow.state,
          transport: slow,
          clock
        });
      },
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_HTTP_TIMEOUT
    );

    // oversized
    const big = new MockAuthHttpTransport();
    big.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, "Z".repeat(600_000));
    await assert.rejects(
      async () => {
        const clock = new FakeClock(0);
        const config = createFixtureOAuthConfig();
        const flow = createOAuthFlowState({ redirectUri: config.redirectUri, clock });
        await exchangeAuthorizationCode({
          config,
          flow,
          code: "c",
          state: flow.state,
          transport: big,
          clock
        });
      },
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.AUTH_RESPONSE_TOO_LARGE
    );

    assert.throws(
      () => parseOAuthCallbackUrl("http://127.0.0.1/callback?error=access_denied", createOAuthFlowState({
        redirectUri: "http://127.0.0.1/callback",
        clock: new FakeClock(0)
      }), new FakeClock(0)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.OAUTH_ERROR
    );
  });

  it("invalid JSON and profile validation", () => {
    assert.throws(
      () => parseMicrosoftTokenResponse("{", new FakeClock(0)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_TOKEN_RESPONSE
    );
    assert.throws(
      () => parseMinecraftProfile("{}"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_PROFILE
    );
  });
});
