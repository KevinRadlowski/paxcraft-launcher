/**
 * PACK-07A â€” packaged renderer bootstrap smoke (CDP).
 *
 * Success requires real Angular bootstrap, not merely index.html presence.
 *
 * Usage:
 *   PACK07_EXE="<path to PaxCraft Launcher.exe>" pnpm exec tsx scripts/pack07-renderer-smoke.mts
 *
 * Defaults to release/win-unpacked executable when PACK07_EXE unset.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EXE = path.join(
  ROOT,
  "release",
  "win-unpacked",
  "PaxCraft Launcher.exe"
);

const exe = process.env.PACK07_EXE?.trim() || DEFAULT_EXE;
const port = Number(process.env.PACK07_CDP_PORT ?? "9350");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sc-pack07-smoke-"));

type Fail = { url: string; errorText: string; type?: string };

function fail(msg: string): never {
  console.error(`PACK07_SMOKE_FAIL: ${msg}`);
  process.exit(1);
}

async function waitCdp(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = (await res.json()) as unknown[];
        if (Array.isArray(list) && list.length > 0) return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`CDP not ready on port ${port}`);
}

async function cdpSession(): Promise<{
  locationHref: string;
  baseHref: string | null;
  scriptSrcs: string[];
  failed: Fail[];
  logs: string[];
  pageErrors: string[];
  hasAppRoot: boolean;
  rootChildCount: number;
  ngVersion: string | null;
  visibleTextLen: number;
  hasSidebarOrNav: boolean;
  resourceNames: string[];
}> {
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) fail("no page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (ev) => reject(ev));
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const logs: string[] = [];
  const pageErrors: string[] = [];

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      params?: Record<string, unknown>;
    };
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "Log.entryAdded") {
      const entry = (msg.params as { entry: { level: string; text: string } }).entry;
      if (entry.level === "error") logs.push(entry.text);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const details = msg.params as {
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      pageErrors.push(
        details.exceptionDetails?.exception?.description ??
          details.exceptionDetails?.text ??
          "unknown"
      );
    }
  });

  function cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Log.enable");
  // Do NOT Page.reload file:// asar â€” Chromium may land on chrome-error://.
  await new Promise((r) => setTimeout(r, 1500));

  const evaluated = (await cdp("Runtime.evaluate", {
    expression: `(() => {
      const root = document.querySelector('app-root');
      const ngHost = document.querySelector('[ng-version]');
      const text = (document.body?.innerText || '').trim();
      const nav = !!(
        document.querySelector('nav') ||
        document.querySelector('[class*="sidebar"]') ||
        document.querySelector('[class*="side-nav"]') ||
        document.querySelector('sc-shell') ||
        document.querySelector('a[routerlink]') ||
        text.length > 40
      );
      const resourceNames = performance.getEntriesByType('resource').map((r) => r.name);
      const failedHints = resourceNames.filter((n) => /^file:\\/\\/\\/[A-Za-z]:\\/[^/]+\\.(js|css)$/i.test(n));
      return {
        locationHref: location.href,
        baseHref: document.querySelector('base')?.getAttribute('href') ?? null,
        scriptSrcs: [...document.querySelectorAll('script[src]')].map((s) => s.src),
        hasAppRoot: !!root,
        rootChildCount: root?.childElementCount ?? 0,
        ngVersion: ngHost?.getAttribute('ng-version') ?? null,
        visibleTextLen: text.length,
        hasSidebarOrNav: nav,
        sampleText: text.slice(0, 160),
        resourceNames,
        failedHints
      };
    })()`,
    returnByValue: true
  })) as { result: { value: Record<string, unknown> } };

  ws.close();
  const v = evaluated.result.value;
  const failedHints = (v.failedHints as string[] | undefined) ?? [];
  const failed: Fail[] = failedHints.map((url) => ({
    url,
    errorText: "net::ERR_FILE_NOT_FOUND",
    type: "Script"
  }));
  // Also treat drive-root script src as failures even if performance missed them
  for (const s of v.scriptSrcs as string[]) {
    if (/^file:\/\/\/[A-Za-z]:\/[^/]+\.(js|css)$/i.test(s)) {
      failed.push({ url: s, errorText: "net::ERR_FILE_NOT_FOUND", type: "Script" });
    }
  }
  return {
    locationHref: String(v.locationHref),
    baseHref: (v.baseHref as string | null) ?? null,
    scriptSrcs: v.scriptSrcs as string[],
    failed,
    logs,
    pageErrors,
    hasAppRoot: Boolean(v.hasAppRoot),
    rootChildCount: Number(v.rootChildCount),
    ngVersion: (v.ngVersion as string | null) ?? null,
    visibleTextLen: Number(v.visibleTextLen),
    hasSidebarOrNav: Boolean(v.hasSidebarOrNav),
    resourceNames: (v.resourceNames as string[]) ?? []
  };
}

if (!fs.existsSync(exe)) {
  fail(`executable missing: ${exe}`);
}

console.log(`PACK07_EXE=${exe}`);
console.log(`PACK07_USER_DATA=${userData}`);

const child = spawn(
  exe,
  [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`],
  {
    stdio: "ignore",
    windowsHide: true
  }
);

let exitCode = 1;
try {
  await waitCdp(20000);
  // Allow first paint / Angular bootstrap
  await new Promise((r) => setTimeout(r, 2000));
  const result = await cdpSession();

  const assetFails = result.failed.filter(
    (f) =>
      /ERR_FILE_NOT_FOUND/i.test(f.errorText) &&
      /\.(js|css)(?:$|\?)/i.test(f.url)
  );
  const driveRootScripts = result.scriptSrcs.filter((s) =>
    /^file:\/\/\/[A-Za-z]:\/[^/]+$/i.test(s) || /^file:\/\/\/[A-Za-z]:\/[^/]+\.(js|css)$/i.test(s)
  );

  console.log(JSON.stringify({
    locationHref: result.locationHref,
    baseHref: result.baseHref,
    scriptSrcs: result.scriptSrcs,
    failedCount: result.failed.length,
    assetFailCount: assetFails.length,
    assetFails,
    pageErrorCount: result.pageErrors.length,
    consoleErrorCount: result.logs.length,
    consoleErrors: result.logs,
    hasAppRoot: result.hasAppRoot,
    rootChildCount: result.rootChildCount,
    ngVersion: result.ngVersion,
    visibleTextLen: result.visibleTextLen,
    hasSidebarOrNav: result.hasSidebarOrNav
  }, null, 2));

  const urlOk =
    /app\.asar.*sweetcraft-launcher-ui\/browser/i.test(result.locationHref) ||
    /index\.html/i.test(result.locationHref);
  if (!urlOk || /chrome-error:/i.test(result.locationHref)) {
    fail(`unexpected renderer URL: ${result.locationHref}`);
  }
  if (result.baseHref !== "./") {
    fail(`base href must be ./ (got ${JSON.stringify(result.baseHref)})`);
  }
  if (driveRootScripts.length > 0) {
    fail(`scripts resolved to drive root: ${driveRootScripts.join(", ")}`);
  }
  if (assetFails.length > 0) {
    fail(`renderer asset ERR_FILE_NOT_FOUND: ${assetFails.map((f) => f.url).join(", ")}`);
  }
  const fileNotFoundLogs = result.logs.filter((t) => /ERR_FILE_NOT_FOUND/i.test(t));
  if (fileNotFoundLogs.length > 0) {
    fail(`console ERR_FILE_NOT_FOUND: ${fileNotFoundLogs.join(" | ")}`);
  }
  if (!result.hasAppRoot) fail("missing <app-root>");
  if (result.rootChildCount < 1) fail("<app-root> is empty â€” Angular did not bootstrap");
  if (!result.ngVersion) {
    if (!result.hasSidebarOrNav || result.visibleTextLen < 20) {
      fail("Angular bootstrap marker missing (no ng-version / no visible UI)");
    }
  }
  if (result.pageErrors.length > 0) {
    fail(`page errors: ${result.pageErrors.join(" | ")}`);
  }

  console.log("PACK07_SMOKE_PASS");
  exitCode = 0;
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  try {
    child.kill();
  } catch {
    // ignore
  }
  // Best-effort cleanup of spawned Electron tree on Windows
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  process.exit(exitCode);
}
