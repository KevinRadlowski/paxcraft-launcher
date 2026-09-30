import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseChannelBytes,
  verifyChannelSignature
} from "../src/core/channel/index.js";
import { MapTrustedKeyStore } from "../src/core/trust/index.js";
import { ErrorCode, LauncherError } from "../src/core/errors/index.js";
import { buildSignedBundle, createTestKeyMaterial, signChannel, sha256Hex } from "../fixtures/builders.js";
import { assertSafeReleasePath } from "../src/core/paths/index.js";

describe("channel", () => {
  it("accepts a valid signed channel", () => {
    const bundle = buildSignedBundle();
    const desc = parseChannelBytes(bundle.channelBytes);
    const verified = verifyChannelSignature(desc, bundle.trust);
    assert.equal(verified.trusted, true);
    assert.equal(verified.descriptor.releaseSequence, 3);
    assert.equal(verified.publicKeyId, bundle.keyId);
  });

  it("rejects invalid channel signature", () => {
    const bundle = buildSignedBundle();
    const desc = parseChannelBytes(bundle.channelBytes);
    desc.signature.value = Buffer.alloc(64, 1).toString("base64");
    assert.throws(
      () => verifyChannelSignature(desc, bundle.trust),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_CHANNEL_SIGNATURE
    );
  });

  it("rejects unknown signing key", () => {
    const bundle = buildSignedBundle();
    const emptyTrust = new MapTrustedKeyStore({});
    const desc = parseChannelBytes(bundle.channelBytes);
    assert.throws(
      () => verifyChannelSignature(desc, emptyTrust),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNKNOWN_SIGNING_KEY
    );
  });

  it("rejects channel modified after signature", () => {
    const bundle = buildSignedBundle({ tamperChannelAfterSign: true });
    const desc = parseChannelBytes(bundle.channelBytes);
    assert.throws(
      () => verifyChannelSignature(desc, bundle.trust),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_CHANNEL_SIGNATURE
    );
  });

  it("rejects path traversal in releasePath", () => {
    assert.throws(
      () => assertSafeReleasePath("releases/../etc/passwd/release.json"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
    assert.throws(
      () => assertSafeReleasePath("releases/0.1.2/../../secret/release.json"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
  });

  it("rejects malformed releasePath via parse", () => {
    const keys = createTestKeyMaterial();
    const { bytes } = signChannel(keys.privateKeyPem, keys.keyId, {
      channel: "dev",
      packVersion: "0.1.2",
      releaseSequence: 1,
      releasePath: "releases/0.1.2/release.json",
      releaseSha256: "a".repeat(64)
    });
    const obj = JSON.parse(bytes.toString("utf8"));
    obj.releasePath = "releases/../../../etc/release.json";
    obj.signature.value = "AA==";
    assert.throws(
      () => parseChannelBytes(JSON.stringify(obj)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
  });
});
