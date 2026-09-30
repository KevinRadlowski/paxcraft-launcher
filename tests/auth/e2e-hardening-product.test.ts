/**
 * E2E hardening — product Microsoft client id + trust store defaults (no live network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ENV_MICROSOFT_CLIENT_ID,
  PRODUCT_MICROSOFT_CLIENT_ID,
  FIXTURE_MS_CLIENT_ID,
  createOAuthConfigFromLauncherAuth,
  resolveLauncherAuthConfig,
  refreshAuthSession,
  FakeClock,
  MockAuthHttpTransport,
  MemorySecureRefreshTokenStore,
  SecureBackedAuthTokenStore,
  InMemoryAccountRegistry,
  accountIdFromMinecraftUuid
} from "../../src/auth/index.js";
import { DEFAULT_MS_TOKEN_ENDPOINT } from "../../src/auth/config.js";
import {
  installHappyAuthRoutes,
  FAKE_MS_REFRESH,
  FAKE_PROFILE_ID_HYPHEN,
  msTokenBody
} from "../../fixtures/auth/fixtures.js";
import {
  loadTrustedKeyStoreFromFile,
  PRODUCTION_RELEASE_KEY_ID
} from "../../src/core/trust/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("E2E hardening — Microsoft client id product default", () => {
  it("A. without env → embedded product client id", () => {
    const cfg = resolveLauncherAuthConfig({ env: {} });
    assert.equal(cfg.microsoftClientId, PRODUCT_MICROSOFT_CLIENT_ID);
    assert.equal(cfg.microsoftClientId, "1cd11e2e-955a-46ba-819c-853a754646a4");
  });

  it("A. env override wins over product default", () => {
    const override = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const cfg = resolveLauncherAuthConfig({
      env: { [ENV_MICROSOFT_CLIENT_ID]: override }
    });
    assert.equal(cfg.microsoftClientId, override);
  });

  it("A. CLI/opt override wins over env and product default", () => {
    const cfg = resolveLauncherAuthConfig({
      clientId: FIXTURE_MS_CLIENT_ID,
      env: { [ENV_MICROSOFT_CLIENT_ID]: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }
    });
    assert.equal(cfg.microsoftClientId, FIXTURE_MS_CLIENT_ID);
  });

  it("A. resolution never invents secrets / never embeds client_secret shape", () => {
    const cfg = resolveLauncherAuthConfig({ env: {} });
    const dumped = JSON.stringify(cfg);
    assert.ok(!/secret|password|bearer|refresh_token|access_token/i.test(dumped));
    assert.equal(cfg.microsoftClientId.length, 36);
  });

  it("B. play-path refresh posts product client_id when env absent (mocked OAuth)", async () => {
    const launcherAuth = resolveLauncherAuthConfig({ env: {} });
    const config = createOAuthConfigFromLauncherAuth(
      launcherAuth,
      "http://localhost/play-unused/"
    );
    assert.equal(config.clientId, PRODUCT_MICROSOFT_CLIENT_ID);

    const accountId = accountIdFromMinecraftUuid(FAKE_PROFILE_ID_HYPHEN);
    const secure = new MemorySecureRefreshTokenStore();
    await secure.save(accountId, FAKE_MS_REFRESH);
    const store = new SecureBackedAuthTokenStore(secure);
    const transport = new MockAuthHttpTransport();
    installHappyAuthRoutes(transport);
    transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody());

    await refreshAuthSession(
      {
        config,
        transport,
        clock: new FakeClock(0),
        store,
        accounts: new InMemoryAccountRegistry()
      },
      accountId
    );

    assert.ok(transport.calls.some((c) => c.url === DEFAULT_MS_TOKEN_ENDPOINT));
    const bodies: string[] = [];
    // Mock pushes undefined for body-less GETs — do not stop on first undefined.
    for (let i = 0; i < transport.calls.length; i++) {
      const b = transport.consumeCapturedSensitiveBody();
      if (typeof b === "string" && b.length > 0) bodies.push(b);
    }
    assert.ok(bodies.length > 0, `expected captured bodies, got ${bodies.length}; calls=${transport.calls.length}`);
    const refreshBody = bodies.find((b) => b.includes("grant_type=refresh_token"));
    assert.ok(refreshBody, `expected refresh grant in bodies: ${bodies.map((b) => b.slice(0, 80)).join(" | ")}`);
    const params = new URLSearchParams(refreshBody);
    assert.equal(params.get("client_id"), PRODUCT_MICROSOFT_CLIENT_ID);
    assert.ok(!refreshBody.includes("client_secret"));
  });
});

describe("E2E hardening — CLI help trusted-keys", () => {
  it("C. play help documents --trusted-keys", () => {
    const mainSrc = readFileSync(path.join(ROOT, "src/cli/main.ts"), "utf8");
    const playHelpStart = mainSrc.indexOf("SweetCraft Launcher — play");
    assert.ok(playHelpStart > 0);
    const playHelpSlice = mainSrc.slice(playHelpStart, playHelpStart + 900);
    assert.match(playHelpSlice, /--trusted-keys <path>/);
    assert.match(playHelpSlice, /trusted public key store/);
    assert.ok(!/private key/i.test(playHelpSlice));
  });

  it("C. orchestrator helps document --trusted-keys", () => {
    const mainSrc = readFileSync(path.join(ROOT, "src/cli/main.ts"), "utf8");
    const orch = mainSrc.indexOf("function printOrchestratorHelp");
    assert.ok(orch > 0);
    const slice = mainSrc.slice(orch, orch + 700);
    assert.match(slice, /--trusted-keys <path>/);
    assert.match(slice, /trusted public key store override/);
  });
});

describe("E2E hardening — product trust default", () => {
  it("D. config/trusted-keys.json loads production public key", () => {
    const filePath = path.join(ROOT, "config", "trusted-keys.json");
    const store = loadTrustedKeyStoreFromFile(filePath);
    assert.equal(store.has(PRODUCTION_RELEASE_KEY_ID), true);
    const pem = store.requirePublicKeyPem(PRODUCTION_RELEASE_KEY_ID);
    assert.match(pem, /BEGIN PUBLIC KEY/);
    assert.ok(!pem.includes("PRIVATE KEY"));
  });

  it("E. product materials contain no secrets", () => {
    const keysRaw = readFileSync(path.join(ROOT, "config", "trusted-keys.json"), "utf8");
    const cfgSrc = readFileSync(path.join(ROOT, "src/auth/launcherConfig.ts"), "utf8");
    assert.ok(!keysRaw.includes("PRIVATE KEY"));
    assert.ok(!keysRaw.includes("BEGIN OPENSSH"));
    assert.ok(!/"client_secret"\s*:/i.test(keysRaw));
    assert.ok(!keysRaw.includes("BEGIN PRIVATE"));
    assert.match(cfgSrc, /PRODUCT_MICROSOFT_CLIENT_ID = "1cd11e2e-955a-46ba-819c-853a754646a4"/);
    assert.ok(!/SWEETCRAFT_MICROSOFT_CLIENT_SECRET|clientSecret\s*=\s*["'][^"']+["']/.test(cfgSrc));
  });
});
