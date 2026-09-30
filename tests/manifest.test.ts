import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseClientManifestJson,
  assertManifestBytesHash
} from "../src/core/manifest/index.js";
import { ErrorCode, LauncherError } from "../src/core/errors/index.js";
import {
  buildLegacyV5Manifest,
  buildMinimalClientManifest,
  sha256Hex
} from "../fixtures/builders.js";

describe("manifest", () => {
  it("accepts valid manifest v6", () => {
    const m = parseClientManifestJson(buildMinimalClientManifest());
    assert.equal(m.schemaVersion, 6);
    assert.equal(m.resourcePacks.length, 1);
    assert.equal(m.resourcePacks[0]!.id, "sweetcraft-fr");
  });

  it("accepts valid manifest v5 legacy (implicit empty resourcePacks)", () => {
    const raw = buildLegacyV5Manifest() as unknown as Record<string, unknown>;
    delete raw.resourcePacks;
    const m = parseClientManifestJson(raw);
    assert.equal(m.schemaVersion, 5);
    assert.deepEqual(m.resourcePacks, []);
  });

  it("rejects incorrect manifest hash", () => {
    const bytes = Buffer.from(JSON.stringify(buildMinimalClientManifest()), "utf8");
    assert.throws(
      () => assertManifestBytesHash(bytes, "0".repeat(64)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.MANIFEST_HASH_MISMATCH
    );
    assert.equal(assertManifestBytesHash(bytes, sha256Hex(bytes)), sha256Hex(bytes));
  });

  it("rejects unknown config apply policy", () => {
    const raw = buildMinimalClientManifest();
    (raw.configs[0] as { apply: string }).apply = "something_weird";
    assert.throws(
      () => parseClientManifestJson(raw),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_CONFIG_POLICY
    );
  });

  it("rejects forbidden client config policy", () => {
    const raw = buildMinimalClientManifest();
    raw.configs[0]!.policy = "NEVER_CLIENT_SECRET_REVIEW";
    raw.configs[0]!.apply = "force";
    assert.throws(
      () => parseClientManifestJson(raw),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_CONFIG_POLICY
    );
  });

  it("rejects duplicate resourcePack id", () => {
    const raw = buildMinimalClientManifest();
    const rp = raw.resourcePacks[0]!;
    raw.resourcePacks = [rp, { ...rp }];
    assert.throws(
      () => parseClientManifestJson(raw),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MANIFEST
    );
  });

  it("rejects resourcePack path traversal", () => {
    const raw = buildMinimalClientManifest();
    raw.resourcePacks[0]!.targetPath = "resourcepacks/../mods/evil.zip";
    assert.throws(
      () => parseClientManifestJson(raw),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
    );
  });

  it("rejects resourcePack sourcePath", () => {
    const raw = buildMinimalClientManifest() as unknown as Record<string, unknown>;
    const rps = raw.resourcePacks as Record<string, unknown>[];
    rps[0] = { ...rps[0], sourcePath: "C:/secret/pack.zip" };
    assert.throws(
      () => parseClientManifestJson(raw),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MANIFEST
    );
  });
});
