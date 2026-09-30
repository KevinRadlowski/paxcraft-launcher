import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertChannelReleaseConsistency,
  assertReleaseBytesHash,
  parseReleaseBytes,
  parseReleaseJson,
  verifyReleaseSignature
} from "../src/core/release/index.js";
import { parseChannelBytes, verifyChannelSignature } from "../src/core/channel/index.js";
import { ErrorCode, LauncherError } from "../src/core/errors/index.js";
import { buildSignedBundle, sha256Hex, signChannel, signReleaseDoc } from "../fixtures/builders.js";
import { MockHttpClient } from "../src/distribution/http/index.js";
import { resolveLatestRelease } from "../src/core/resolve/index.js";
import { createEmptyAntiRollbackState } from "../src/instance/state/index.js";

const BASE = "https://cdn.example.test/sweetcraft";

describe("release", () => {
  it("accepts a valid signed release", () => {
    const bundle = buildSignedBundle();
    assertReleaseBytesHash(bundle.releaseBytes, bundle.releaseSha256);
    const release = parseReleaseBytes(bundle.releaseBytes);
    const { publicKeyId } = verifyReleaseSignature(release, bundle.trust);
    assert.equal(publicKeyId, bundle.keyId);
    assert.equal(release.antiRollback.releaseSequence, 3);
    assert.equal(release.schemaVersion, 2);
  });

  it("rejects release schema 1 with UNSUPPORTED_SCHEMA", () => {
    const bundle = buildSignedBundle();
    const raw = JSON.parse(bundle.releaseBytes.toString("utf8")) as Record<string, unknown>;
    raw.schemaVersion = 1;
    assert.throws(
      () => parseReleaseJson(raw),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.code === ErrorCode.UNSUPPORTED_SCHEMA &&
        e.details.schemaVersion === 1
    );
  });

  it("rejects incorrect release hash", () => {
    const bundle = buildSignedBundle();
    assert.throws(
      () => assertReleaseBytesHash(bundle.releaseBytes, "0".repeat(64)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.RELEASE_HASH_MISMATCH
    );
  });

  it("rejects incorrect release signature", () => {
    const bundle = buildSignedBundle();
    const release = parseReleaseBytes(bundle.releaseBytes);
    release.signature.value = Buffer.alloc(64, 7).toString("base64");
    assert.throws(
      () => verifyReleaseSignature(release, bundle.trust),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_RELEASE_SIGNATURE
    );
  });

  it("rejects unsigned-dev release (no trusted result)", () => {
    const bundle = buildSignedBundle();
    const release = parseReleaseBytes(bundle.releaseBytes);
    release.signature.status = "unsigned-dev";
    release.signature.value = null;
    release.signature.publicKeyId = null;
    assert.throws(
      () => verifyReleaseSignature(release, bundle.trust),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSIGNED_REFUSED
    );
  });

  it("rejects unsigned-dev via resolveLatestRelease (no TrustedResolvedRelease)", async () => {
    const bundle = buildSignedBundle();
    const unsignedRelease = JSON.parse(bundle.releaseBytes.toString("utf8")) as Record<string, unknown>;
    unsignedRelease.signature = {
      status: "unsigned-dev",
      algorithm: "ed25519",
      publicKeyId: null,
      payload: "SWEETCRAFT-RELEASE-SIGNATURE-V1",
      value: null
    };
    const unsignedBytes = Buffer.from(JSON.stringify(unsignedRelease, null, 2) + "\n", "utf8");
    const { bytes: channelBytes } = signChannel(bundle.privateKeyPem, bundle.keyId, {
      channel: "dev",
      packVersion: bundle.packVersion,
      releaseSequence: bundle.releaseSequence,
      releasePath: `releases/${bundle.packVersion}/release.json`,
      releaseSha256: sha256Hex(unsignedBytes)
    });
    const http = new MockHttpClient();
    http.set(`${BASE}/channels/dev.json`, channelBytes);
    http.set(`${BASE}/releases/${bundle.packVersion}/release.json`, unsignedBytes);
    http.set(`${BASE}/releases/${bundle.packVersion}/client-manifest.json`, bundle.manifestBytes);

    let trustedProduced = false;
    await assert.rejects(
      async () => {
        const resolved = await resolveLatestRelease({
          channel: "dev",
          productBase: BASE,
          http,
          trust: bundle.trust,
          antiRollbackState: createEmptyAntiRollbackState()
        });
        trustedProduced = resolved.trusted === true;
        return resolved;
      },
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSIGNED_REFUSED
    );
    assert.equal(trustedProduced, false);
  });

  it("rejects packVersion mismatch channel/release", () => {
    const bundle = buildSignedBundle();
    const channel = verifyChannelSignature(parseChannelBytes(bundle.channelBytes), bundle.trust);
    const { bytes } = signReleaseDoc(bundle.privateKeyPem, bundle.keyId, {
      schemaVersion: 2,
      product: "SweetCraft",
      packVersion: "9.9.9",
      minecraft: bundle.release.minecraft,
      fabricLoader: bundle.release.fabricLoader,
      server: bundle.release.server,
      packManagerVersion: bundle.release.packManagerVersion,
      catalogSchemaVersion: 2,
      manifestSchemaVersion: 6,
      configBase: "files/",
      antiRollback: { releaseSequence: bundle.releaseSequence },
      artefacts: bundle.release.artefacts
    });
    const release = parseReleaseBytes(bytes);
    assert.throws(
      () => assertChannelReleaseConsistency(channel, release, sha256Hex(bytes)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.CHANNEL_RELEASE_MISMATCH
    );
  });

  it("rejects releaseSequence mismatch channel/release", () => {
    const bundle = buildSignedBundle();
    const channel = verifyChannelSignature(parseChannelBytes(bundle.channelBytes), bundle.trust);
    const { bytes } = signReleaseDoc(bundle.privateKeyPem, bundle.keyId, {
      schemaVersion: 2,
      product: "SweetCraft",
      packVersion: bundle.packVersion,
      minecraft: bundle.release.minecraft,
      fabricLoader: bundle.release.fabricLoader,
      server: bundle.release.server,
      packManagerVersion: bundle.release.packManagerVersion,
      catalogSchemaVersion: 2,
      manifestSchemaVersion: 6,
      configBase: "files/",
      antiRollback: { releaseSequence: 99 },
      artefacts: bundle.release.artefacts
    });
    const release = parseReleaseBytes(bytes);
    assert.throws(
      () => assertChannelReleaseConsistency(channel, release, sha256Hex(bytes)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.CHANNEL_RELEASE_MISMATCH
    );
  });
});
