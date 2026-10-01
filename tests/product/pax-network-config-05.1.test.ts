/**
 * PACK-PAX-05.1 — harness exceptions closed; partial activation / live auth fail-closed.
 * Hermetic only — no real network I/O.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { FetchHttpClient, MockHttpClient } from "../../src/distribution/http/index.js";
import { FetchAuthHttpTransport } from "../../src/auth/http/transport.js";
import { DefaultSystemBrowser, FakeSystemBrowser } from "../../src/auth/browser.js";
import {
  DEFAULT_PAX_NETWORK_CONFIG,
  assertNotHistoricalDestinationUrl,
  assertPaxLiveAuthNetworkAllowed,
  assertRealOutboundTransportAllowed,
  getPaxNetworkConfig,
  isHistoricalBlockedHost,
  isNetworkHarnessPermit,
  listHistoricalBlockedHosts,
  parseProductServerAddress,
  redactUrlForError,
  requireConfiguredDistributionOrigin,
  resolveConfiguredExternalLink,
  resolveConfiguredServerAddress,
  tryResolveDistributionOrigin
} from "../../src/product/paxNetworkConfig.js";
import {
  createNetworkHarnessPermit,
  resetPaxNetworkConfigForTests,
  setPaxNetworkConfigForTests
} from "../../src/product/paxNetworkTestHooks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(() => {
  resetPaxNetworkConfigForTests();
});

describe("PACK-PAX-05.1 confirmed defects closed", () => {
  it("network off + explicit loopback/example.test without harness → refused", () => {
    assert.throws(
      () =>
        requireConfiguredDistributionOrigin({
          explicit: "https://cdn.example.test/sweetcraft"
        }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
    assert.throws(
      () =>
        requireConfiguredDistributionOrigin({
          explicit: "https://127.0.0.1/sweetcraft"
        }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
    assert.equal(tryResolveDistributionOrigin({ explicit: "https://cdn.example.test/x" }), null);
  });

  it("omitted runtime is treated as packaged-production (no harness soft-enable)", () => {
    const permit = createNetworkHarnessPermit();
    // Permit alone without runtime.test-harness must not authorize.
    assert.throws(
      () =>
        requireConfiguredDistributionOrigin({
          explicit: "https://cdn.example.test/sweetcraft",
          harness: permit
        }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
  });

  it("forged harness object is rejected", () => {
    assert.equal(isNetworkHarnessPermit({ __brand: "PaxNetworkHarnessPermit" }), false);
    assert.throws(
      () =>
        requireConfiguredDistributionOrigin({
          explicit: "https://cdn.example.test/sweetcraft",
          harness: { __brand: "PaxNetworkHarnessPermit" } as never,
          runtime: { kind: "test-harness" }
        }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
  });

  it("injected harness + test-harness runtime allows hermetic origin (Mock only)", () => {
    const origin = requireConfiguredDistributionOrigin({
      explicit: "https://cdn.example.test/sweetcraft",
      harness: createNetworkHarnessPermit(),
      runtime: { kind: "test-harness" }
    });
    assert.equal(origin, "https://cdn.example.test/sweetcraft");
  });

  it("harness does not authorize real FetchHttpClient even to example.test", async () => {
    void createNetworkHarnessPermit();
    const http = new FetchHttpClient();
    let fetchCalled = false;
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch must not run");
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => http.request({ url: "https://cdn.example.test/sweetcraft/channels/dev.json" }),
        (e: unknown) =>
          LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
      );
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("networkEnabled=true without liveAuthEnabled refuses live auth/browser", () => {
    setPaxNetworkConfigForTests({
      ...DEFAULT_PAX_NETWORK_CONFIG,
      networkEnabled: true,
      distributionOrigin: "https://cdn.example.test/sweetcraft",
      liveAuthEnabled: false
    });
    assert.throws(
      () => assertPaxLiveAuthNetworkAllowed(),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
    const browser = new DefaultSystemBrowser();
    assert.throws(
      () => {
        void browser.open("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1");
      },
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
  });

  it("networkEnabled=true without serverAddress → no ping target; without links → null", () => {
    setPaxNetworkConfigForTests({
      ...DEFAULT_PAX_NETWORK_CONFIG,
      networkEnabled: true,
      distributionOrigin: "https://cdn.example.test/sweetcraft",
      serverAddress: null,
      communityWebsiteUrl: null,
      supportUrl: null,
      liveAuthEnabled: false
    });
    assert.equal(resolveConfiguredServerAddress(), null);
    assert.equal(resolveConfiguredExternalLink("community"), null);
    assert.equal(resolveConfiguredExternalLink("support"), null);
  });

  it("partial activation networkEnabled without distributionOrigin refuses resolve", () => {
    setPaxNetworkConfigForTests({
      ...DEFAULT_PAX_NETWORK_CONFIG,
      networkEnabled: true,
      distributionOrigin: null
    });
    assert.throws(
      () => requireConfiguredDistributionOrigin(),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.DISTRIBUTION_NOT_CONFIGURED
    );
  });

  it("historical list is not a mutable exported Set", () => {
    const listed = listHistoricalBlockedHosts();
    assert.ok(listed.includes("cdn.xnosweet.fr"));
    assert.throws(() => {
      (listed as string[]).push("evil.example");
    });
    // Mutating a snapshot must not affect the checker.
    try {
      (listed as string[]).push("evil.example");
    } catch {
      /* frozen */
    }
    assert.equal(isHistoricalBlockedHost("evil.example"), false);
    assert.equal(isHistoricalBlockedHost("cdn.xnosweet.fr"), true);
  });

  it("credentialed URLs never appear in error messages/details", () => {
    try {
      assertNotHistoricalDestinationUrl("https://user:secret@cdn.xnosweet.fr/sweetcraft");
      assert.fail("expected throw");
    } catch (e) {
      assert.ok(LauncherError.isLauncherError(e));
      const dump = JSON.stringify({ message: e.message, details: e.details });
      assert.equal(dump.includes("secret"), false);
      assert.equal(dump.includes("user:"), false);
    }
    assert.equal(redactUrlForError("https://user:pass@cdn.example.test/x").includes("pass"), false);
  });

  it("serverAddress parser rejects ambiguous / IPv6; accepts host:port", () => {
    assert.throws(() => parseProductServerAddress("[::1]:25565"));
    assert.throws(() => parseProductServerAddress("a:b:c"));
    assert.throws(() => parseProductServerAddress("sweetcraft.datho.st"));
    const ok = parseProductServerAddress("play.example.test:25565");
    assert.equal(ok.host, "play.example.test");
    assert.equal(ok.port, 25565);
  });

  it("real outbound helpers always refuse (harness does not transfer)", () => {
    assert.throws(
      () => assertRealOutboundTransportAllowed(),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
  });

  it("FetchAuthHttpTransport with default fetch is blocked; injected fetch allowed", async () => {
    await assert.rejects(
      () => new FetchAuthHttpTransport().request({ url: "https://login.microsoftonline.com/x", method: "GET" }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
    const transport = new FetchAuthHttpTransport({
      fetchImpl: async () =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    });
    const res = await transport.request({
      url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      method: "GET"
    });
    assert.equal(res.status, 200);
  });

  it("FakeSystemBrowser remains hermetic without liveAuthEnabled", async () => {
    const browser = new FakeSystemBrowser();
    await browser.open("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1");
    assert.equal(browser.opened.length, 1);
  });

  it("product entrypoints do not import paxNetworkTestHooks", () => {
    const files = [
      "src/cli/main.ts",
      "desktop/main/lifecycle.ts",
      "desktop/main/main.ts",
      "desktop/main/auth/real-auth-backend.ts",
      "desktop/main/install/real-install-backend.ts",
      "desktop/main/play/play-deps-builder.ts",
      "src/application/orchestrator/execute.ts",
      "src/application/play/orchestrator.ts"
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      assert.equal(src.includes("paxNetworkTestHooks"), false, rel);
    }
  });

  it("test config mutation does not leak across reset", () => {
    setPaxNetworkConfigForTests({
      ...DEFAULT_PAX_NETWORK_CONFIG,
      networkEnabled: true,
      liveAuthEnabled: true,
      distributionOrigin: "https://cdn.example.test/sweetcraft"
    });
    assert.equal(getPaxNetworkConfig().liveAuthEnabled, true);
    resetPaxNetworkConfigForTests();
    assert.deepEqual(getPaxNetworkConfig(), DEFAULT_PAX_NETWORK_CONFIG);
  });

  it("MockHttpClient hermetic path unused when origin gate fails", async () => {
    const http = new MockHttpClient();
    let called = false;
    const original = http.request.bind(http);
    http.request = async (opts) => {
      called = true;
      return original(opts);
    };
    assert.throws(() =>
      requireConfiguredDistributionOrigin({ explicit: "https://cdn.example.test/sweetcraft" })
    );
    assert.equal(called, false);
  });

  it("historical destinations still blocked under harness", () => {
    assert.throws(
      () =>
        requireConfiguredDistributionOrigin({
          explicit: "https://cdn.xnosweet.fr/sweetcraft",
          harness: createNetworkHarnessPermit(),
          runtime: { kind: "test-harness" }
        }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.HISTORICAL_DESTINATION_BLOCKED
    );
  });
});
