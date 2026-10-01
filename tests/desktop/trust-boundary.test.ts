import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertIpcResultRoundTrip,
  createFileRendererTarget,
  createRendererTrustPolicy,
  createRendererTrustPolicyForRuntime,
  evaluateIpcSenderTrust,
  ipcErr,
  ipcOk,
  isAllowedExternalUrl,
  isAllowedNavigation,
  isTrustedIpcSenderUrl,
  isTrustedRendererUrl,
  parseDevServerUrl,
  resolveDesktopRuntimeModeForTest,
  unwrapIpcResult,
  usesDevelopmentCsp,
  productionCsp,
  cspForPolicy
} from "./trust-helpers.js";

describe("0.6.0-alpha.3 trust policy â€” top-level navigation", () => {
  const indexPath = path.join("C:", "SweetCraft", "ui", "dist", "browser", "index.html");
  const policy = createRendererTrustPolicy({
    mode: "production",
    indexHtmlPath: indexPath
  });
  const entry = (policy.target as { entryFileUrl: string }).entryFileUrl;
  const dir = (policy.target as { trustedDirUrl: string }).trustedDirUrl;

  it("production index / hash / query allowed as navigation", () => {
    assert.equal(isAllowedNavigation(policy, entry), true);
    assert.equal(isAllowedNavigation(policy, entry + "#/home"), true);
    assert.equal(isAllowedNavigation(policy, entry + "?x=1#/home"), true);
    assert.equal(isTrustedRendererUrl(policy, entry), true);
  });

  it("production assets allowed as renderer scope but denied as top-level nav", () => {
    const chunk = new URL("chunk-ABC.js", dir).href;
    const css = new URL("styles.css", dir).href;
    const asset = new URL("assets/logo.svg", dir).href;
    const otherHtml = new URL("other.html", dir).href;
    assert.equal(isTrustedRendererUrl(policy, chunk), true);
    assert.equal(isAllowedNavigation(policy, chunk), false);
    assert.equal(isAllowedNavigation(policy, css), false);
    assert.equal(isAllowedNavigation(policy, asset), false);
    assert.equal(isAllowedNavigation(policy, otherHtml), false);
  });

  it("production arbitrary file URL denied", () => {
    assert.equal(isAllowedNavigation(policy, "file:///C:/Users/secret/evil.html"), false);
    assert.equal(isAllowedNavigation(policy, "file:///tmp/evil.html"), false);
    assert.equal(isAllowedNavigation(policy, "file://server/share/x.html"), false);
  });

  it("remote https navigation denied in renderer", () => {
    assert.equal(isAllowedNavigation(policy, "https://evil.example/"), false);
  });

  it("approved external https allowlist is empty until Pax links are qualified", () => {
    assert.equal(isAllowedExternalUrl("https://sweetcraft.datho.st/"), false);
    assert.equal(isAllowedExternalUrl("https://xbase.fr/foo"), false);
    assert.equal(isAllowedExternalUrl("https://www.xnosweet.fr/sweetcraft"), false);
    assert.equal(isAllowedExternalUrl("https://evil.example/"), false);
    assert.equal(isAllowedNavigation(policy, "https://sweetcraft.datho.st/"), false);
  });

  it("external allowlist rejects lookalikes and credentials", () => {
    assert.equal(isAllowedExternalUrl("https://sweetcraft.datho.st.evil.com/"), false);
    assert.equal(isAllowedExternalUrl("https://user:pass@sweetcraft.datho.st/"), false);
    assert.equal(isAllowedExternalUrl("http://sweetcraft.datho.st/"), false);
    assert.equal(isAllowedExternalUrl("https://sweetcraft.datho.st:8443/"), false);
  });
});

describe("0.6F.3 V3 product CDN vs community website", () => {
  it("DEFAULT_PRODUCT_BASE is historical-only; openExternal allowlist empty", async () => {
    const { DEFAULT_PRODUCT_BASE } = await import("../../src/distribution/urls/index.js");
    assert.equal(DEFAULT_PRODUCT_BASE, "https://cdn.xnosweet.fr/sweetcraft");
    assert.equal(isAllowedExternalUrl("https://www.xnosweet.fr/sweetcraft"), false);
    assert.equal(isAllowedExternalUrl("https://evil.example/"), false);
  });
});

describe("0.6.0-alpha.3 trust policy â€” dev origin", () => {
  it("parses exact loopback URLs", () => {
    const a = parseDevServerUrl("http://127.0.0.1:4200/");
    assert.ok(a);
    assert.equal(a!.origin, "http://127.0.0.1:4200");
    const b = parseDevServerUrl("http://localhost:4200");
    assert.ok(b);
    assert.equal(b!.origin, "http://localhost:4200");
  });

  it("rejects lookalike and credentialed hosts", () => {
    assert.equal(parseDevServerUrl("http://localhost.evil.com:4200/"), null);
    assert.equal(parseDevServerUrl("http://127.0.0.1.evil.com/"), null);
    assert.equal(parseDevServerUrl("http://user:pass@127.0.0.1:4200/"), null);
    assert.equal(parseDevServerUrl("ftp://127.0.0.1:4200/"), null);
  });

  it("dev exact configured origin allowed; other ports denied", () => {
    const policy = createRendererTrustPolicy({
      mode: "development",
      indexHtmlPath: path.join("C:", "x", "index.html"),
      devServerUrl: "http://127.0.0.1:4200/"
    });
    assert.equal(policy.target.kind, "dev-server");
    assert.equal(isAllowedNavigation(policy, "http://127.0.0.1:4200/home"), true);
    assert.equal(isAllowedNavigation(policy, "http://127.0.0.1:9999/"), false);
    assert.equal(isAllowedNavigation(policy, "http://localhost:4200/"), false);
    assert.equal(isTrustedIpcSenderUrl(policy, "http://127.0.0.1:4200/"), true);
    assert.equal(isTrustedIpcSenderUrl(policy, "http://127.0.0.1:9999/"), false);
  });
});

describe("0.6.0-alpha.3 IPC sender URL policy", () => {
  it("file entry with hash allowed for IPC; other files denied", () => {
    const target = createFileRendererTarget(path.join("C:", "app", "index.html"));
    const policy = { mode: "production" as const, target };
    assert.equal(isTrustedIpcSenderUrl(policy, target.entryFileUrl), true);
    assert.equal(isTrustedIpcSenderUrl(policy, target.entryFileUrl + "#/home"), true);
    assert.equal(
      isTrustedIpcSenderUrl(policy, pathToFileURL(path.join("C:", "tmp", "x.html")).href),
      false
    );
  });

  it("PACK-10.1: packaged baseHref ./ directory document URL is trusted IPC sender", () => {
    // Electron+Angular production baseHref "./" can drop index.html from the
    // top-level frame URL (â€¦/browser/#/home). IPC must still accept that SPA document.
    const indexPath = path.join(
      "C:",
      "Users",
      "kevin",
      "AppData",
      "Local",
      "Programs",
      "PaxCraft Launcher",
      "resources",
      "app.asar",
      "ui",
      "dist",
      "sweetcraft-launcher-ui",
      "browser",
      "index.html"
    );
    const policy = createRendererTrustPolicy({ mode: "production", indexHtmlPath: indexPath });
    const target = policy.target as { entryFileUrl: string; trustedDirUrl: string };
    const dirDoc = target.trustedDirUrl.replace(/\/?$/, "/") + "#/home";
    assert.equal(isTrustedIpcSenderUrl(policy, dirDoc), true);
    assert.equal(isAllowedNavigation(policy, dirDoc), true);
    // Sibling HTML / assets remain denied as IPC/navigation top-level
    assert.equal(isTrustedIpcSenderUrl(policy, new URL("other.html", target.trustedDirUrl).href), false);
    assert.equal(isAllowedNavigation(policy, new URL("chunk.js", target.trustedDirUrl).href), false);
  });

  it("trusted main frame accepted; subframe / wrong wc / wrong url rejected", () => {
    const policy = createRendererTrustPolicy({
      mode: "production",
      indexHtmlPath: path.join("C:", "app", "index.html")
    });
    const entry = (policy.target as { entryFileUrl: string }).entryFileUrl;
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: true,
        isTopFrame: true,
        frameUrl: entry
      }),
      true
    );
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: true,
        isTopFrame: false,
        frameUrl: entry
      }),
      false
    );
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: false,
        isTopFrame: true,
        frameUrl: entry
      }),
      false
    );
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: true,
        isTopFrame: true,
        frameUrl: "file:///C:/tmp/evil.html"
      }),
      false
    );
  });

  it("dev exact origin accepted; other localhost origin rejected", () => {
    const policy = createRendererTrustPolicy({
      mode: "development",
      indexHtmlPath: path.join("C:", "x", "index.html"),
      devServerUrl: "http://127.0.0.1:4200/"
    });
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: true,
        isTopFrame: true,
        frameUrl: "http://127.0.0.1:4200/"
      }),
      true
    );
    assert.equal(
      evaluateIpcSenderTrust({
        policy,
        senderIsMainWindow: true,
        isTopFrame: true,
        frameUrl: "http://127.0.0.1:9999/"
      }),
      false
    );
  });
});

describe("0.6.0-alpha.3 IPC result envelope", () => {
  it("round-trips ok and error envelopes through JSON", () => {
    const ok = assertIpcResultRoundTrip(ipcOk({ version: "0.6.0-alpha.3" }));
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.version, "0.6.0-alpha.3");

    const err = assertIpcResultRoundTrip(
      ipcErr({ code: "IPC_UNTRUSTED_SENDER", messageKey: "errors.ipc.untrusted_sender" })
    );
    assert.equal(err.ok, false);
    assert.throws(() => unwrapIpcResult(err));
    assert.equal(unwrapIpcResult(ok).version, "0.6.0-alpha.3");
  });
});

describe("0.6.0-alpha.3 packaged env attack", () => {
  const indexPath = path.join("C:", "SweetCraft", "ui", "dist", "browser", "index.html");

  it("packaged + development override â†’ production", () => {
    assert.equal(
      resolveDesktopRuntimeModeForTest({ isPackaged: true, envOverride: "development" }),
      "production"
    );
  });

  it("packaged + DESKTOP_DEV_SERVER â†’ file target + production CSP", () => {
    const policy = createRendererTrustPolicyForRuntime({
      isPackaged: true,
      indexHtmlPath: indexPath,
      envOverride: "development",
      devServerUrl: "http://127.0.0.1:4200/"
    });
    assert.equal(policy.mode, "production");
    assert.equal(policy.target.kind, "file");
    assert.equal(usesDevelopmentCsp(policy), false);
    const csp = cspForPolicy(policy);
    assert.equal(csp, productionCsp());
    assert.ok(!csp.includes("unsafe-eval"));
    assert.ok(!csp.includes("127.0.0.1"));
    assert.ok(csp.includes("script-src 'self'"));
  });

  it("unpackaged defaults to development; explicit production works", () => {
    assert.equal(resolveDesktopRuntimeModeForTest({ isPackaged: false }), "development");
    assert.equal(
      resolveDesktopRuntimeModeForTest({ isPackaged: false, envOverride: "production" }),
      "production"
    );
  });

  it("unpackaged + dev server â†’ exact origin + development CSP", () => {
    const policy = createRendererTrustPolicyForRuntime({
      isPackaged: false,
      indexHtmlPath: indexPath,
      envOverride: "development",
      devServerUrl: "http://127.0.0.1:4200/"
    });
    assert.equal(policy.mode, "development");
    assert.equal(policy.target.kind, "dev-server");
    assert.equal(usesDevelopmentCsp(policy), true);
    const csp = cspForPolicy(policy);
    assert.ok(csp.includes("unsafe-eval"));
    assert.ok(csp.includes("http://127.0.0.1:4200"));
    assert.notEqual(csp, productionCsp());
  });
});
