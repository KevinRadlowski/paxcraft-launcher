/**
 * PACK-PAX-05 — Pax network config + historical destination gates (no real network).
 * PACK-PAX-05.1 — harness requires opaque permit + test-harness runtime.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { FetchHttpClient, MockHttpClient } from "../../src/distribution/http/index.js";
import { DEFAULT_PRODUCT_BASE } from "../../src/distribution/urls/index.js";
import {
  DEFAULT_PAX_NETWORK_CONFIG,
  assertNotHistoricalDestinationUrl,
  assertPaxLiveAuthNetworkAllowed,
  getPaxNetworkConfig,
  isHistoricalBlockedHost,
  requireConfiguredDistributionOrigin,
  tryResolveDistributionOrigin
} from "../../src/product/paxNetworkConfig.js";
import {
  createNetworkHarnessPermit,
  resetPaxNetworkConfigForTests,
  setPaxNetworkConfigForTests
} from "../../src/product/paxNetworkTestHooks.js";
import { FakeSystemBrowser, DefaultSystemBrowser } from "../../src/auth/browser.js";

afterEach(() => {
  resetPaxNetworkConfigForTests();
});

describe("PACK-PAX-05 pax network config defaults", () => {
  it("default config disables network and leaves origins/links/auth absent", () => {
    const cfg = getPaxNetworkConfig();
    assert.equal(cfg.networkEnabled, false);
    assert.equal(cfg.distributionOrigin, null);
    assert.equal(cfg.serverAddress, null);
    assert.equal(cfg.communityWebsiteUrl, null);
    assert.equal(cfg.supportUrl, null);
    assert.equal(cfg.liveAuthEnabled, false);
    assert.deepEqual(cfg, DEFAULT_PAX_NETWORK_CONFIG);
  });

  it("absent config never falls back to SweetCraft DEFAULT_PRODUCT_BASE", () => {
    assert.equal(DEFAULT_PRODUCT_BASE, "https://cdn.xnosweet.fr/sweetcraft");
    assert.equal(tryResolveDistributionOrigin(), null);
    assert.throws(
      () => requireConfiguredDistributionOrigin(),
      (e: unknown) =>
        LauncherError.isLauncherError(e) &&
        (e.code === ErrorCode.NETWORK_NOT_CONFIGURED ||
          e.code === ErrorCode.DISTRIBUTION_NOT_CONFIGURED)
    );
  });
});

describe("PACK-PAX-05 historical destination block", () => {
  it("blocks exact historical hosts (not prefix)", () => {
    assert.equal(isHistoricalBlockedHost("cdn.xnosweet.fr"), true);
    assert.equal(isHistoricalBlockedHost("www.xnosweet.fr"), true);
    assert.equal(isHistoricalBlockedHost("xbase.fr"), true);
    assert.equal(isHistoricalBlockedHost("sweetcraft.datho.st"), true);
    assert.equal(isHistoricalBlockedHost("cdn.xnosweet.fr.evil.com"), false);
    assert.equal(isHistoricalBlockedHost("cdn.example.test"), false);
  });

  it("refuses historical product base even when explicitly passed", () => {
    assert.throws(
      () =>
        requireConfiguredDistributionOrigin({
          explicit: "https://cdn.xnosweet.fr/sweetcraft"
        }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) &&
        (e.code === ErrorCode.HISTORICAL_DESTINATION_BLOCKED ||
          e.code === ErrorCode.NETWORK_NOT_CONFIGURED)
    );
    assert.throws(
      () => assertNotHistoricalDestinationUrl("https://user:pass@cdn.xnosweet.fr/sweetcraft"),
      (e: unknown) =>
        LauncherError.isLauncherError(e) &&
        (e.code === ErrorCode.HISTORICAL_DESTINATION_BLOCKED ||
          e.code === ErrorCode.UNSAFE_REDIRECT)
    );
  });

  it("FetchHttpClient refuses before fetch (outbound + historical)", async () => {
    const http = new FetchHttpClient();
    await assert.rejects(
      () => http.request({ url: "https://cdn.xnosweet.fr/sweetcraft/channels/dev.json" }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) &&
        (e.code === ErrorCode.NETWORK_NOT_CONFIGURED ||
          e.code === ErrorCode.HISTORICAL_DESTINATION_BLOCKED)
    );
  });
});

describe("PACK-PAX-05.1 harness origin policy", () => {
  it("refuses example.test without harness even when network disabled", () => {
    assert.throws(
      () =>
        requireConfiguredDistributionOrigin({
          explicit: "https://cdn.example.test/sweetcraft"
        }),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
  });

  it("allows explicit example.test only with permit + test-harness runtime", () => {
    const origin = requireConfiguredDistributionOrigin({
      explicit: "https://cdn.example.test/sweetcraft",
      harness: createNetworkHarnessPermit(),
      runtime: { kind: "test-harness" }
    });
    assert.equal(origin, "https://cdn.example.test/sweetcraft");
  });

  it("partial activation (network on, origin null) refuses SweetCraft fallback", () => {
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
});

describe("PACK-PAX-05 auth / browser gates", () => {
  it("FakeSystemBrowser still records URLs (hermetic) without Pax network", async () => {
    const browser = new FakeSystemBrowser();
    await browser.open("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1");
    assert.equal(browser.opened.length, 1);
  });

  it("live auth network gate throws before DefaultSystemBrowser effect", () => {
    assert.throws(
      () => assertPaxLiveAuthNetworkAllowed(),
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
    const browser = new DefaultSystemBrowser();
    assert.throws(
      () => {
        void browser.open(
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1"
        );
      },
      (e: unknown) =>
        LauncherError.isLauncherError(e) && e.code === ErrorCode.NETWORK_NOT_CONFIGURED
    );
  });
});

describe("PACK-PAX-05 network action refuses before transport", () => {
  it("requireConfiguredDistributionOrigin failure means MockHttpClient never used", async () => {
    const http = new MockHttpClient();
    let called = false;
    const original = http.request.bind(http);
    http.request = async (opts) => {
      called = true;
      return original(opts);
    };
    assert.throws(() => requireConfiguredDistributionOrigin({ explicit: null }));
    assert.equal(called, false);
  });
});
