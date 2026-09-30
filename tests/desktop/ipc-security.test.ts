import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertEmptyInvokePayload,
  isAllowedExternalUrl,
  normalizeAccountList,
  normalizeAppInfo,
  normalizeLauncherStatus,
  normalizeSettings,
  normalizeUiError,
  EXTERNAL_URL_RULES,
  IpcChannels,
  normalizeEventPayload
} from "../../desktop/shared/index.js";
import { assertSecureWebPreferences } from "../../desktop/shared/security.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("0.6A desktop IPC validation", () => {
  it("rejects malformed invoke payloads", () => {
    assert.throws(() => assertEmptyInvokePayload({ evil: true }));
    assert.throws(() => assertEmptyInvokePayload("x"));
    assert.doesNotThrow(() => assertEmptyInvokePayload(undefined));
    assert.doesNotThrow(() => assertEmptyInvokePayload({}));
  });

  it("normalizes app info and rejects garbage", () => {
    const ok = normalizeAppInfo({
      name: "SweetCraft Launcher",
      version: "0.6.0-beta.1",
      platform: "win32",
      environment: "development"
    });
    assert.equal(ok.version, "0.6.0-beta.1");
    assert.throws(() => normalizeAppInfo({ name: "x" }));
    assert.throws(() => normalizeAppInfo(null));
  });

  it("normalizes launcher status enums", () => {
    const ok = normalizeLauncherStatus({
      readiness: "READY",
      serverAddress: "sweetcraft.datho.st",
      packVersion: "0.1.2"
    });
    assert.equal(ok.readiness, "READY");
    assert.throws(() =>
      normalizeLauncherStatus({ readiness: "HACKED", serverAddress: "x" })
    );
  });

  it("normalizes accounts without accepting tokens", () => {
    const list = normalizeAccountList([
      { accountId: "a1", minecraftUsername: "Steve" }
    ]);
    assert.equal(list.length, 1);
    assert.throws(() =>
      normalizeAccountList([{ accountId: "a", minecraftUsername: "" }])
    );
  });

  it("normalizes settings bounds", () => {
    const s = normalizeSettings({ language: "fr", reducedMotion: true, memoryMiB: 2048 });
    assert.equal(s.memoryMiB, 2048);
    assert.throws(() => normalizeSettings({ language: "en", reducedMotion: false }));
    assert.throws(() =>
      normalizeSettings({ language: "fr", reducedMotion: false, memoryMiB: 10 })
    );
  });

  it("safe error serialization drops arbitrary Error text", () => {
    const err = normalizeUiError(new Error("C:\\Users\\secret\\token=abc"));
    assert.equal(err.code, "INTERNAL_ERROR");
    assert.equal(err.messageKey, "errors.internal");
    assert.ok(!JSON.stringify(err).includes("secret"));
    assert.ok(!JSON.stringify(err).includes("token"));
  });

  it("event payloads are normalized per channel (no generic bus)", () => {
    const status = normalizeEventPayload("launcherStatusChanged", {
      readiness: "UNKNOWN",
      serverAddress: "sweetcraft.datho.st"
    });
    assert.equal((status as { readiness: string }).readiness, "UNKNOWN");
    const note = normalizeEventPayload("notification", {
      level: "INFO",
      messageKey: "status.ok"
    });
    assert.equal((note as { level: string }).level, "INFO");
    assert.throws(() =>
      normalizeEventPayload("notification", { level: "HACK", messageKey: "x" })
    );
  });

  it("external URL allowlist is HTTPS-only and structurally matched", () => {
    assert.equal(isAllowedExternalUrl("https://sweetcraft.datho.st/"), true);
    assert.equal(isAllowedExternalUrl("https://www.xnosweet.fr/sweetcraft"), true);
    assert.equal(isAllowedExternalUrl("https://www.xnosweet.fr/sweetcraft/"), true);
    assert.equal(isAllowedExternalUrl("https://evil.example/"), false);
    assert.equal(isAllowedExternalUrl("http://sweetcraft.datho.st/"), false);
    assert.equal(isAllowedExternalUrl("https://user:pass@sweetcraft.datho.st/"), false);
    assert.ok(EXTERNAL_URL_RULES.length >= 3);
  });

  it("BrowserWindow security preferences are enforced", () => {
    assert.doesNotThrow(() =>
      assertSecureWebPreferences({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false
      })
    );
    assert.throws(() =>
      assertSecureWebPreferences({
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: true
      })
    );
    assert.throws(() =>
      assertSecureWebPreferences({
        contextIsolation: true,
        nodeIntegration: true,
        sandbox: true
      })
    );
  });

  it("IPC channels are explicit (no generic invoke bus)", () => {
    const values = Object.values(IpcChannels);
    assert.ok(values.every((c) => c.startsWith("sc:")));
    assert.ok(values.includes("sc:app:getInfo"));
    assert.ok(values.includes("sc:install:getStatus"));
    assert.ok(values.includes("sc:install:install"));
    assert.ok(values.includes("sc:install:update"));
    assert.ok(values.includes("sc:install:repair"));
    assert.ok(values.includes("sc:settings:get"));
    assert.ok(values.includes("sc:settings:update"));
    assert.ok(values.includes("sc:diagnostics:get"));
    assert.ok(values.includes("sc:diagnostics:copy"));
    assert.ok(values.includes("sc:server:getStatus"));
    assert.ok(values.includes("sc:system:getInfo"));
    assert.ok(values.includes("sc:system:getFixedDisks"));
    assert.ok(values.includes("sc:storage:getSummary"));
    assert.ok(values.includes("sc:storage:openInstance"));
    assert.ok(values.includes("sc:storage:openLogs"));
    assert.ok(!values.includes("invoke"));
    assert.ok(!values.includes("sc:settings:set"));
    assert.ok(!values.some((v) => v.includes("setSetting")));
    assert.ok(!values.some((v) => v.includes("tcpProxy") || v.includes("rawSocket")));
  });

  it("preload exposes only sweetcraft bridge surface", () => {
    const preload = readFileSync(path.join(root, "desktop/preload/preload.cjs"), "utf8");
    assert.ok(preload.includes('exposeInMainWorld("sweetcraft"'));
    assert.ok(!preload.includes("exposeInMainWorld(\"electron\""));
    assert.ok(!preload.includes("exposeInMainWorld(\"require\""));
    assert.ok(preload.includes("Object.freeze(api)"));
  });

  it("event unsubscribe pattern exists in preload", () => {
    const preload = readFileSync(path.join(root, "desktop/preload/preload.cjs"), "utf8");
    assert.ok(preload.includes("removeListener"));
    assert.ok(preload.includes("return () =>"));
  });
});

describe("0.6A renderer security static checks", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (
        (p.endsWith(".ts") || p.endsWith(".html")) &&
        !p.endsWith(".test.ts")
      ) {
        out.push(p);
      }
    }
    return out;
  }

  it("ui/src does not import node:fs, child_process, or electron ipcRenderer", () => {
    const files = walk(path.join(root, "ui/src"));
    const forbidden = [
      /from\s+['"]node:fs['"]/,
      /from\s+['"]fs['"]/,
      /from\s+['"]node:child_process['"]/,
      /from\s+['"]child_process['"]/,
      /from\s+['"]electron['"]/,
      /ipcRenderer/
    ];
    for (const file of files) {
      // preload is not under ui/src
      const text = readFileSync(file, "utf8");
      for (const re of forbidden) {
        assert.ok(!re.test(text), `forbidden pattern ${re} in ${path.relative(root, file)}`);
      }
    }
  });
});
