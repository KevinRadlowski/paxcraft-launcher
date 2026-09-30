/**
 * PACK-02 — packaged resource paths + LIVE auth gate (offline).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  resolveDesktopResourcePaths,
  describeDesktopResourcePaths
} from "../../desktop/shared/packaged-paths.js";
import {
  assertLiveAuthEnabled,
  isLiveAuthAllowed,
  PRODUCT_MICROSOFT_CLIENT_ID,
  resolveLauncherAuthConfig,
  ENV_ALLOW_LIVE_AUTH
} from "../../src/auth/index.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { createRendererTrustPolicyForRuntime } from "../../desktop/shared/trust-policy.js";
import { loadTrustedKeyStoreFromFile, PRODUCTION_RELEASE_KEY_ID } from "../../src/core/trust/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("PACK-02 desktop resource paths", () => {
  it("A. unpackaged/dev resolves trusted keys under appPath/config", () => {
    const paths = resolveDesktopResourcePaths({
      isPackaged: false,
      appPath: ROOT,
      resourcesPath: path.join(ROOT, "release", "win-unpacked", "resources")
    });
    assert.equal(paths.trustedKeysSource, "app");
    assert.equal(paths.trustedKeysPath, path.join(ROOT, "config", "trusted-keys.json"));
    assert.equal(paths.distRoot, path.join(ROOT, "dist"));
    assert.ok(paths.rendererIndexHtml.includes("ui"));
    assert.ok(paths.preloadPath.endsWith(path.join("dist-desktop", "preload", "preload.cjs")));
    const desc = describeDesktopResourcePaths(paths);
    assert.equal(desc.trustedKeysBasename, "trusted-keys.json");
    assert.ok(!JSON.stringify(desc).includes("C:\\Users"));
  });

  it("A/B. packaged resolves trusted keys under resourcesPath/config", () => {
    const resources = path.join(os.tmpdir(), "sc-pack02-resources");
    const appAsar = path.join(os.tmpdir(), "sc-pack02-app.asar");
    const paths = resolveDesktopResourcePaths({
      isPackaged: true,
      appPath: appAsar,
      resourcesPath: resources
    });
    assert.equal(paths.trustedKeysSource, "resources");
    assert.equal(paths.trustedKeysPath, path.join(resources, "config", "trusted-keys.json"));
    assert.equal(paths.distRoot, path.join(appAsar, "dist"));
    assert.equal(
      paths.rendererIndexHtml,
      path.join(appAsar, "ui", "dist", "sweetcraft-launcher-ui", "browser", "index.html")
    );
  });

  it("B. repo trusted-keys.json loads public production key (fail-closed store)", () => {
    const store = loadTrustedKeyStoreFromFile(path.join(ROOT, "config", "trusted-keys.json"));
    assert.equal(store.has(PRODUCTION_RELEASE_KEY_ID), true);
    const pem = store.requirePublicKeyPem(PRODUCTION_RELEASE_KEY_ID);
    assert.match(pem, /BEGIN PUBLIC KEY/);
    assert.ok(!pem.includes("PRIVATE KEY"));
  });

  it("B. missing trusted-keys path fails closed on load", () => {
    assert.throws(() =>
      loadTrustedKeyStoreFromFile(path.join(os.tmpdir(), "sc-missing-trusted-keys.json"))
    );
  });
});

describe("PACK-02 LIVE auth gate", () => {
  it("C. packaged production allows LIVE without env", () => {
    assert.equal(isLiveAuthAllowed({ env: {}, packagedProduction: true }), true);
    assertLiveAuthEnabled({ env: {}, packagedProduction: true });
  });

  it("C. unpackaged without gate is denied", () => {
    assert.equal(isLiveAuthAllowed({ env: {}, packagedProduction: false }), false);
    assert.throws(
      () => assertLiveAuthEnabled({ env: {}, liveFlag: false }),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.LIVE_AUTH_NOT_ENABLED
    );
  });

  it("C. unpackaged with SWEETCRAFT_ALLOW_LIVE_AUTH=1 is allowed", () => {
    assertLiveAuthEnabled({
      env: { [ENV_ALLOW_LIVE_AUTH]: "1" },
      packagedProduction: false
    });
  });

  it("product client id resolves without env; no fixture", () => {
    const cfg = resolveLauncherAuthConfig({ env: {} });
    assert.equal(cfg.microsoftClientId, PRODUCT_MICROSOFT_CLIENT_ID);
  });
});

describe("PACK-02 packaged trust policy rejects DEV_SERVER", () => {
  it("D. packaged + DESKTOP_DEV_SERVER → file target", () => {
    const indexHtml = path.join(ROOT, "ui", "dist", "sweetcraft-launcher-ui", "browser", "index.html");
    const policy = createRendererTrustPolicyForRuntime({
      isPackaged: true,
      indexHtmlPath: indexHtml,
      envOverride: "development",
      devServerUrl: "http://127.0.0.1:4201/"
    });
    assert.equal(policy.target.kind, "file");
    assert.equal(policy.mode, "production");
  });
});

describe("PACK-02 critical resource presence helpers", () => {
  it("E. packaged missing keys path is distinguishable", () => {
    const paths = resolveDesktopResourcePaths({
      isPackaged: true,
      appPath: path.join(os.tmpdir(), "missing-app"),
      resourcesPath: path.join(os.tmpdir(), "missing-resources")
    });
    assert.equal(fs.existsSync(paths.trustedKeysPath), false);
  });
});
