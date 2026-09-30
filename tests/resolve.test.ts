import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockHttpClient } from "../src/distribution/http/index.js";
import { resolveLatestRelease } from "../src/core/resolve/index.js";
import { createEmptyAntiRollbackState, withAcceptedRelease } from "../src/instance/state/index.js";
import { ErrorCode, LauncherError } from "../src/core/errors/index.js";
import { buildSignedBundle } from "../fixtures/builders.js";

const BASE = "https://cdn.example.test/sweetcraft";

function mountBundle(http: MockHttpClient, bundle: ReturnType<typeof buildSignedBundle>): void {
  http.set(`${BASE}/channels/dev.json`, bundle.channelBytes);
  http.set(`${BASE}/releases/${bundle.packVersion}/release.json`, bundle.releaseBytes);
  http.set(`${BASE}/releases/${bundle.packVersion}/client-manifest.json`, bundle.manifestBytes);
}

describe("resolve pipeline", () => {
  it("resolves a full trusted release over mock HTTP", async () => {
    const bundle = buildSignedBundle();
    const http = new MockHttpClient();
    mountBundle(http, bundle);
    const resolved = await resolveLatestRelease({
      channel: "dev",
      productBase: BASE,
      http,
      trust: bundle.trust,
      antiRollbackState: createEmptyAntiRollbackState()
    });
    assert.equal(resolved.trusted, true);
    assert.equal(resolved.release.release.packVersion, "0.1.2");
    assert.equal(resolved.clientManifest.mods.length, 1);
    assert.equal(resolved.clientManifest.resourcePacks.length, 1);
  });

  it("fails closed on HTTP 404 for channel", async () => {
    const bundle = buildSignedBundle();
    const http = new MockHttpClient();
    await assert.rejects(
      () =>
        resolveLatestRelease({
          channel: "dev",
          productBase: BASE,
          http,
          trust: bundle.trust,
          antiRollbackState: createEmptyAntiRollbackState()
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_ERROR
    );
  });

  it("detects rollback before trusting release", async () => {
    const bundle = buildSignedBundle({ releaseSequence: 2 });
    const http = new MockHttpClient();
    mountBundle(http, bundle);
    const state = withAcceptedRelease(createEmptyAntiRollbackState(), {
      channel: "dev",
      releaseSequence: 5,
      packVersion: "0.2.0",
      releasePath: "releases/0.2.0/release.json",
      releaseSha256: "d".repeat(64)
    });
    await assert.rejects(
      () =>
        resolveLatestRelease({
          channel: "dev",
          productBase: BASE,
          http,
          trust: bundle.trust,
          antiRollbackState: state
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ROLLBACK_DETECTED
    );
  });

  it("rejects release hash mismatch from channel pointer", async () => {
    const bundle = buildSignedBundle();
    const http = new MockHttpClient();
    http.set(`${BASE}/channels/dev.json`, bundle.channelBytes);
    http.set(`${BASE}/releases/${bundle.packVersion}/release.json`, Buffer.from('{"tampered":true}\n'));
    await assert.rejects(
      () =>
        resolveLatestRelease({
          channel: "dev",
          productBase: BASE,
          http,
          trust: bundle.trust,
          antiRollbackState: createEmptyAntiRollbackState()
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.RELEASE_HASH_MISMATCH
    );
  });
});
