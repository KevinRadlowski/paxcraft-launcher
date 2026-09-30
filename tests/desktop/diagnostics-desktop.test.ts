/**
 * Safe diagnostics builder + clipboard format (0.6E).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIAGNOSTICS_FORBIDDEN_KEYS,
  assertNoSensitiveLeak,
  buildSafeDiagnostics,
  createEphemeralSupportId,
  formatDiagnosticsClipboardText
} from "../../desktop/main/diagnostics/index.js";

describe("0.6E safe diagnostics", () => {
  const base = () =>
    buildSafeDiagnostics({
      info: {
        name: "SweetCraft Launcher",
        version: "0.6.0-rc.4",
        platform: "win32",
        environment: "development",
        buildId: "0.6.0-rc.4@abcdef123456",
        buildCommit: "abcdef1234567890abcdef1234567890abcdef12",
        features: { fakeAuthHarness: true, fakeInstallHarness: false, fakePlayHarness: true }
      },
      status: {
        readiness: "READY",
        serverAddress: "sweetcraft.datho.st",
        installedVersion: "0.1.2",
        latestVersion: "0.1.3",
        packVersion: "0.1.2",
        minecraftVersion: "1.21.1",
        fabricVersion: "0.16.9",
        channel: "stable",
        activeOperation: "IDLE"
      },
      auth: {
        state: "AUTHENTICATED",
        account: { accountId: "acc-1", minecraftUsername: "PlayerOne" }
      },
      play: { state: "READY" },
      settings: {
        language: "fr",
        reducedMotion: false,
        memoryMiB: 4096,
        instanceLocationConfigured: false
      },
      supportId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      platform: "win32",
      architecture: "x64"
    });

  it("includes version", () => {
    assert.equal(base().launcherVersion, "0.6.0-rc.4");
  });

  it("includes authoritative buildId and buildCommit from AppInfo", () => {
    assert.equal(base().buildId, "0.6.0-rc.4@abcdef123456");
    assert.equal(base().buildCommit, "abcdef1234567890abcdef1234567890abcdef12");
  });

  it("omits build provenance when AppInfo lacks it", () => {
    const dto = buildSafeDiagnostics({
      info: {
        name: "SweetCraft Launcher",
        version: "0.6.0-rc.4",
        platform: "win32",
        environment: "development"
      },
      status: null,
      auth: null,
      play: null,
      settings: null,
      supportId: createEphemeralSupportId()
    });
    assert.equal(dto.buildId, undefined);
    assert.equal(dto.buildCommit, undefined);
    const text = formatDiagnosticsClipboardText(dto);
    assert.match(text, /Build ID: unavailable/);
    assert.match(text, /Build commit: unavailable/);
  });

  it("rejects path-like buildId / non-hex buildCommit", () => {
    const dto = buildSafeDiagnostics({
      info: {
        name: "SweetCraft Launcher",
        version: "0.6.0-rc.4",
        platform: "win32",
        environment: "development",
        buildId: "C:\\Users\\secret\\build",
        buildCommit: "not-a-sha"
      },
      status: null,
      auth: null,
      play: null,
      settings: null,
      supportId: createEphemeralSupportId()
    });
    assert.equal(dto.buildId, undefined);
    assert.equal(dto.buildCommit, undefined);
  });

  it("includes install state", () => {
    assert.equal(base().installReadiness, "READY");
  });

  it("includes auth state", () => {
    assert.equal(base().authState, "AUTHENTICATED");
  });

  it("includes play state", () => {
    assert.equal(base().playState, "READY");
  });

  it("includes safe memory value", () => {
    assert.equal(base().memoryMiB, 4096);
  });

  it("clipboard text has build identity and no tokens / paths / cmdline", () => {
    const text = formatDiagnosticsClipboardText(base());
    assert.match(text, /SweetCraft Launcher 0\.6\.0-rc\.4/);
    assert.match(text, /Build ID: 0\.6\.0-rc\.4@abcdef123456/);
    assert.match(text, /Build commit: abcdef1234567890abcdef1234567890abcdef12/);
    assert.match(text, /Instance location: default/);
    assert.match(text, /Memory: 4096 MiB/);
    assert.match(text, /Fake auth harness: active/);
    for (const k of [
      "accessToken",
      "refreshToken",
      "authorizationCode",
      "codeVerifier",
      "clientSecret",
      "xsts",
      "xboxToken"
    ]) {
      assert.ok(!text.includes(k), k);
    }
    assert.ok(!text.includes("C:\\Users"));
    assert.ok(!text.includes("/Users/"));
    assert.ok(!text.includes("argfile"));
    assert.ok(!text.includes("commandLine"));
    assertNoSensitiveLeak(text);
  });

  it("DTO has no forbidden keys", () => {
    const json = JSON.stringify(base());
    for (const k of DIAGNOSTICS_FORBIDDEN_KEYS) {
      assert.ok(!json.includes(`"${k}"`), k);
    }
    assert.ok(!json.includes('"accessToken"'));
    assert.ok(!json.includes('"refreshToken"'));
  });

  it("strips path-looking versions", () => {
    const dto = buildSafeDiagnostics({
      info: null,
      status: {
        readiness: "ERROR",
        serverAddress: "sweetcraft.datho.st",
        installedVersion: "C:\\Users\\secret\\pack"
      },
      auth: null,
      play: null,
      settings: null,
      supportId: createEphemeralSupportId()
    });
    assert.equal(dto.installedPackVersion, null);
  });

  it("marks fake harness development-only in clipboard", () => {
    const prod = buildSafeDiagnostics({
      info: {
        name: "SweetCraft Launcher",
        version: "0.6.0-rc.4",
        platform: "win32",
        environment: "production"
      },
      status: null,
      auth: null,
      play: null,
      settings: { language: "fr", reducedMotion: false, memoryMiB: 2048 },
      supportId: createEphemeralSupportId()
    });
    const text = formatDiagnosticsClipboardText(prod);
    assert.ok(!text.includes("Fake auth harness"));
  });

  it("support id is ephemeral random-looking", () => {
    const a = createEphemeralSupportId();
    const b = createEphemeralSupportId();
    assert.match(a, /^[0-9a-f-]{36}$/i);
    assert.notEqual(a, b);
  });
});
