/**
 * PACK-PAX-06 — visual capture via Chrome DevTools Protocol (no npm deps).
 * Excluded from product entrypoints. Blocks non-loopback navigations via Fetch.enable.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  mkdtemp
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const OUT = path.join(REPO, "docs/pax-baseline/visual-after/PACK-PAX-10");
const VIEWPORT = { width: 1280, height: 800 };
const VIEWPORT_NARROW = { width: 1100, height: 700 };
const BASE = process.env.PAX_CAPTURE_BASE ?? "http://127.0.0.1:4202";
function sceneUrl(route) {
  const pathPart = route.startsWith("/") ? route : `/${route}`;
  return `${BASE}/#${pathPart}`;
}
/** Full document reload URL — isolates gateway/store between scenes. */
function freshAppUrl(route) {
  const pathPart = route.startsWith("/") ? route : `/${route}`;
  return `${BASE}/?capture=${Date.now()}-${Math.random().toString(36).slice(2)}#${pathPart}`;
}
const CHROME =
  process.env.PAX_CAPTURE_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HEAD = "33499137b02a3057f3891b978a8b484f06d44c57";
const WIP_NOTE =
  "WIP PACK-PAX-03..10 present (uncommitted). Captures reflect PACK-PAX-10 diagnostics narrow + chooseLocation PaxCraft.";

const SCENES = [
  {
    id: "01-diagnostics-narrow",
    route: "/diagnostics",
    auth: "AUTHENTICATED",
    install: "READY",
    action: "open-technical",
    viewport: "narrow",
    note: "Diagnostics 1100×700 — cartes d’état densifiées"
  },
  {
    id: "02-settings-choose-location",
    route: "/settings",
    auth: "AUTHENTICATED",
    install: "READY",
    action: "settings-choose-location",
    note: "Paramètres après chooseLocation Dev → D:\\\\Games\\\\PaxCraft"
  },
  {
    id: "03-settings-default-path",
    route: "/settings",
    auth: "AUTHENTICATED",
    install: "READY",
    note: "Paramètres chemin Dev par défaut C:\\\\Dev\\\\PaxCraft"
  }
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.blockedExternal = { count: 0, samples: [] };
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (e) => reject(e));
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
      if (msg.method === "Fetch.requestPaused") {
        void this.onRequestPaused(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async onRequestPaused(params) {
    const url = params.request.url;
    let allow = false;
    try {
      const u = new URL(url);
      allow =
        u.hostname === "127.0.0.1" ||
        u.hostname === "localhost" ||
        u.protocol === "data:" ||
        u.protocol === "blob:";
    } catch {
      allow = false;
    }
    try {
      if (allow) {
        await this.send("Fetch.continueRequest", { requestId: params.requestId });
      } else {
        this.blockedExternal.count += 1;
        if (this.blockedExternal.samples.length < 25) this.blockedExternal.samples.push(url);
        await this.send("Fetch.failRequest", {
          requestId: params.requestId,
          errorReason: "BlockedByClient"
        });
      }
    } catch {
      /* request may already be closed */
    }
  }

  close() {
    this.ws.close();
  }
}

async function waitForSelector(cdp, selector, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `!!document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: true
    });
    if (result.value === true) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${selector}`);
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.text || "evaluate failed");
  }
  return result?.value;
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  const fresh = url.includes("?capture=");
  await sleep(fresh ? 2200 : 1200);
  await waitForSelector(cdp, "app-root, body", 30000);
}

async function applyFixtures(cdp, scene) {
  // Fresh SPA bootstrap so prior operationError / toasts / modals cannot leak.
  await navigate(cdp, freshAppUrl("/diagnostics"));
  await waitForSelector(cdp, "sc-diagnostics-page", 45000);
  await waitForSelector(cdp, '[data-testid="fake-install-fixture-select"]', 30000);

  const script = `
    (async () => {
      const auth = ${JSON.stringify(scene.auth ?? null)};
      const install = ${JSON.stringify(scene.install ?? null)};
      if (typeof ng === 'undefined' || typeof ng.getComponent !== 'function') {
        throw new Error('Angular ng.getComponent unavailable');
      }
      const el = document.querySelector('sc-diagnostics-page');
      const comp = ng.getComponent(el);
      if (!comp) throw new Error('diagnostics component missing');
      if (comp.store?.applyDemoFixture) comp.store.applyDemoFixture(null);
      if (comp.store?.setStatusError) comp.store.setStatusError(null);
      if (comp.store?.clearOperationError) comp.store.clearOperationError();
      if (comp.store?.setOperationError) comp.store.setOperationError(null);
      const modal = document.querySelector('sc-modal-host');
      // dismiss any residual UI
      document.querySelectorAll('sc-toast-container button.close').forEach((b) => b.click());
      const gw = comp.gateway;
      if (!gw || gw.kind !== 'dev') throw new Error('dev gateway unavailable');

      if (auth) {
        if (typeof gw.setAuthFixture === 'function') gw.setAuthFixture(auth);
        else if (gw.dev?.setAuthFixture) await gw.dev.setAuthFixture(auth);
        else throw new Error('setAuthFixture missing');
        const dto = await gw.auth.getState();
        const accounts = await gw.accounts.list();
        comp.store.applyAuthStateDto(dto, accounts);
      }

      if (install) {
        if (typeof gw.setInstallFixture === 'function') gw.setInstallFixture(install);
        else if (gw.dev?.setInstallFixture) await gw.dev.setInstallFixture(install);
        else throw new Error('setInstallFixture missing');
      }

      // Re-clear presentation errors after fixture apply (install fixture must not invent op errors).
      if (comp.store?.setStatusError) comp.store.setStatusError(null);
      if (comp.store?.clearOperationError) comp.store.clearOperationError();

      const authState = (await gw.auth.getState()).state;
      const readiness = (await gw.launcher.getStatus()).readiness;
      const opErr = comp.store.operationError?.() ?? null;
      const statusErr = comp.store.statusError?.() ?? null;
      return { authState, readiness, accounts: (await gw.accounts.list()).length, opErr, statusErr };
    })()
  `;
  const applied = await evaluate(cdp, script);
  if (scene.auth && applied && applied.authState !== scene.auth) {
    throw new Error(`auth fixture mismatch: want ${scene.auth} got ${JSON.stringify(applied)}`);
  }
  if (scene.action !== "trigger-install-error" && (applied?.opErr || applied?.statusErr)) {
    throw new Error(`scene contaminated before navigate: ${JSON.stringify(applied)}`);
  }
  await sleep(400);
}

async function stabilize(cdp, opts = {}) {
  const hideToasts = opts.hideToasts !== false;
  await evaluate(
    cdp,
    `(function(){
      const s=document.createElement('style');
      s.textContent='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;caret-color:transparent!important}';
      document.head.appendChild(s);
      const hideToasts=${hideToasts ? "true" : "false"};
      if(hideToasts){
        document.querySelectorAll('sc-toast-container button.close').forEach((b)=>b.click());
        const host=document.querySelector('sc-toast-container');
        if(host) host.style.visibility='hidden';
      }
      return true;
    })()`
  );
  await sleep(400);
  await evaluate(
    cdp,
    `(async()=>{
      const wait = (img) => img.complete ? 1 : new Promise((r) => {
        const done = () => r(1);
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 1500);
      });
      await Promise.race([
        Promise.all([...document.images].map(wait)),
        new Promise((r) => setTimeout(r, 2500))
      ]);
      if (document.fonts?.ready) {
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
      }
      return true;
    })()`
  );
  await sleep(200);
}

async function screenshotPng(cdp) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  return Buffer.from(data, "base64");
}

async function dismissOverlays(cdp) {
  await evaluate(
    cdp,
    `(function(){
      // Close any open modal via Annuler / close controls.
      const roots=[...document.querySelectorAll('[role="dialog"], sc-modal, .modal')];
      for (const root of roots) {
        const cancel=[...root.querySelectorAll('button, sc-button')].find(b=>/Annuler|Cancel|Fermer|Close/i.test(b.textContent||''));
        if (cancel) {
          const t=cancel.tagName==='SC-BUTTON'?(cancel.querySelector('button')||cancel):cancel;
          t.click();
        }
      }
      document.querySelectorAll('sc-toast-container button.close').forEach((b)=>b.click());
      return true;
    })()`
  );
  await sleep(250);
}

async function captureScene(cdp, scene) {
  const result = {
    id: scene.id,
    route: scene.route,
    fixture: { auth: scene.auth ?? null, install: scene.install ?? null, action: scene.action ?? null },
    note: scene.note ?? "",
    status: "NOT_CAPTURED",
    reason: null,
    file: null,
    sha256: null,
    viewport: scene.viewport === "narrow" ? VIEWPORT_NARROW : VIEWPORT
  };
  const before = cdp.blockedExternal.count;
  try {
    const vp = result.viewport;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await dismissOverlays(cdp);
    await applyFixtures(cdp, scene);
    await dismissOverlays(cdp);
    // Soft hash navigate on the same ?capture= document — keeps Dev gateway fixtures.
    const hashRoute = scene.route.startsWith("/") ? scene.route : `/${scene.route}`;
    await evaluate(cdp, `(function(){ location.hash = ${JSON.stringify(hashRoute)}; return location.hash; })()`);
    await sleep(900);
    await waitForSelector(cdp, "[data-testid='home-page'], [data-testid='settings-page'], [data-testid='account-page'], [data-testid='diagnostics-page'], .page");
    const keepErrorToast = scene.action === "trigger-install-error";
    await stabilize(cdp, { hideToasts: !keepErrorToast });

    if (scene.action === "location-unavailable") {
      result.reason =
        "Dev gateway settings always expose instanceLocationAvailable=true — aucune fixture d’emplacement indisponible sans changement métier";
      return result;
    }

    if (scene.action === "settings-choose-location") {
      const picked = await evaluate(
        cdp,
        `(async function(){
          const card = document.querySelector('[data-testid="settings-location-card"]');
          if (!card) return { ok: false, reason: 'location-card-missing' };
          const buttons = [...card.querySelectorAll('button, sc-button')];
          const modify = buttons.find((b) => /Modifier|Modify/i.test((b.textContent || '').trim()));
          if (!modify) return { ok: false, reason: 'modify-missing' };
          const target = modify.tagName === 'SC-BUTTON' ? (modify.querySelector('button') || modify) : modify;
          if (target.disabled) return { ok: false, reason: 'modify-disabled' };
          target.click();
          await new Promise((r) => setTimeout(r, 600));
          const pathEl = document.querySelector('[data-testid="settings-instance-path"]');
          const pathText = (pathEl?.textContent || '').trim();
          return { ok: true, pathText };
        })()`
      );
      if (!picked?.ok) {
        result.reason = `chooseLocation UI failed (${picked?.reason || 'unknown'})`;
        return result;
      }
      if (!/PaxCraft/i.test(picked.pathText || '')) {
        result.reason = `path after chooseLocation unexpected: ${picked.pathText}`;
        // still capture for diagnosis
      }
      await sleep(200);
    }

    if (scene.action === "open-technical" || scene.action === "open-devtools" || scene.action === "open-devtools-scroll-bottom") {
      await evaluate(
        cdp,
        `(function(){
          const tech=document.querySelector('[data-testid="diagnostics-technical"]');
          const dev=document.querySelector('[data-testid="diagnostics-dev-tools"]');
          if (tech) tech.open = true;
          if (dev) {
            const wantDev = ${JSON.stringify(scene.action !== "open-technical")};
            dev.open = wantDev;
            if (wantDev) {
              // force expand for capture even if UA ignored .open assignment
              if (!dev.open) {
                const sum = dev.querySelector('summary');
                if (sum) sum.click();
              }
              dev.open = true;
            }
          }
          return { tech: !!tech?.open, dev: !!dev?.open };
        })()`
      );
      await sleep(400);
    }

    if (scene.action === "open-uninstall-modal") {
      const opened = await evaluate(
        cdp,
        `(function(){
          const btn=document.querySelector('[data-testid="uninstall-instance"]');
          if(!btn || btn.disabled || btn.getAttribute('aria-disabled')==='true') return false;
          btn.click();
          return true;
        })()`
      );
      if (!opened) {
        result.reason = "uninstall control absent or disabled";
        return result;
      }
      await sleep(400);
      const hasModal = await evaluate(
        cdp,
        `!!(document.querySelector('[role="dialog"], sc-modal, .modal, .modal-backdrop'))`
      );
      if (!hasModal) {
        result.reason = "modal did not open";
        return result;
      }
    }

    if (scene.action === "memory-dirty") {
      const dirty = await evaluate(
        cdp,
        `(function(){
          const input=document.querySelector('[data-testid="settings-memory-slider"], #memory-slider');
          if(!input) return false;
          const max=Number(input.max)||8192;
          const min=Number(input.min)||1024;
          const step=Number(input.step)||512;
          const next=Math.min(max, Math.max(min, Number(input.value||min)+step*2));
          const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
          if(setter) setter.call(input,String(next));
          else input.value=String(next);
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        })()`
      );
      if (!dirty) {
        result.reason = "memory slider absent";
        return result;
      }
      await sleep(300);
    }

    if (scene.action === "scroll-bottom" || scene.action === "open-devtools-scroll-bottom") {
      await evaluate(
        cdp,
        `(function(){
          const roots=[
            document.querySelector('.content'),
            document.querySelector('main'),
            document.querySelector('[data-testid="settings-page"]')?.closest('.content'),
            document.querySelector('[data-testid="diagnostics-page"]')?.closest('.content'),
            document.scrollingElement
          ].filter(Boolean);
          for (const el of roots) {
            try { el.scrollTop = el.scrollHeight; } catch {}
          }
          window.scrollTo(0, document.body.scrollHeight);
          return true;
        })()`
      );
      await sleep(350);
    }

    if (scene.action === "trigger-install-error") {
      // Primary CTA (sc-cta) starts first install; location modal then confirm.
      const step1 = await evaluate(
        cdp,
        `(function(){
          const cta = document.querySelector('sc-cta button, .install-cta button, .install-cta sc-button button');
          if (cta && !cta.disabled) { cta.click(); return 'cta'; }
          const candidates=[...document.querySelectorAll('button, sc-button')];
          const btn=candidates.find(b=>/Installer|Install/i.test((b.textContent||'').trim()));
          if(!btn) return false;
          const target=btn.tagName==='SC-BUTTON'?(btn.querySelector('button')||btn):btn;
          if(target.disabled) return false;
          target.click();
          return 'btn';
        })()`
      );
      if (!step1) {
        result.reason = "install button absent or disabled";
        return result;
      }
      await sleep(500);
      const step2 = await evaluate(
        cdp,
        `(function(){
          const dialog=document.querySelector('[role="dialog"], sc-modal, .modal');
          if(!dialog) return 'no-modal';
          const btn=[...dialog.querySelectorAll('button, sc-button')].find(b=>/Installer|Install/i.test((b.textContent||'').trim()));
          if(!btn) return 'no-confirm';
          const target=btn.tagName==='SC-BUTTON'?(btn.querySelector('button')||btn):btn;
          target.click();
          return 'confirmed';
        })()`
      );
      if (step2 !== "confirmed") {
        result.reason = `install confirm failed (${step2})`;
        return result;
      }
      await sleep(1200);
      const hasError = await evaluate(
        cdp,
        `!!(document.querySelector('sc-toast-container .toast.danger, sc-toast-container [role="alert"], .toast.danger, .alert'))`
      );
      if (!hasError) {
        result.reason = "error toast not observed (captured post-mutation UI anyway)";
      }
      await evaluate(
        cdp,
        `(function(){
          const host=document.querySelector('sc-toast-container');
          if(host) host.style.visibility='visible';
          return true;
        })()`
      );
      await sleep(200);
    }

    const buf = await screenshotPng(cdp);
    const file = `${scene.id}.png`;
    await writeFile(path.join(OUT, file), buf);
    result.file = file;
    result.sha256 = createHash("sha256").update(buf).digest("hex");
    result.blockedExternalHits = cdp.blockedExternal.count - before;
    if (buf.byteLength < 8000) {
      result.reason = `screenshot too small (${buf.byteLength} B)`;
      return result;
    }
    result.status = "CAPTURED";
  } catch (e) {
    result.reason = e instanceof Error ? e.message : String(e);
  }
  return result;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const profile = await mkdtemp(path.join(os.tmpdir(), "pax06-chrome-"));
  const port = 9222 + Math.floor(Math.random() * 200);
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "about:blank"
  ];
  const chrome = spawn(CHROME, chromeArgs, { stdio: "ignore" });
  let version;
  for (let i = 0; i < 50; i++) {
    try {
      version = await httpGetJson(`http://127.0.0.1:${port}/json/version`);
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version?.webSocketDebuggerUrl) {
    chrome.kill();
    throw new Error("Chrome CDP not ready");
  }

  // Prefer a page target
  let pageWs = version.webSocketDebuggerUrl;
  try {
    const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((t) => t.type === "page") || targets[0];
    if (page?.webSocketDebuggerUrl) pageWs = page.webSocketDebuggerUrl;
  } catch {
    /* use version ws */
  }

  const cdp = new Cdp(pageWs);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

  // smoke
  await navigate(cdp, sceneUrl("/home"));
  await waitForSelector(cdp, "[data-testid='home-page'], body");

  // Prove external Fetch blocking (no product network change).
  const beforeProbe = cdp.blockedExternal.count;
  await evaluate(
    cdp,
    `(async()=>{ try { await fetch('https://example.com/', { mode: 'no-cors', cache: 'no-store' }); } catch(e) {} return true; })()`
  );
  await sleep(400);
  if (cdp.blockedExternal.count <= beforeProbe) {
    console.warn("external fetch probe did not increment blockedExternal counter");
  } else {
    console.log(`external fetch probe blocked (+${cdp.blockedExternal.count - beforeProbe})`);
  }

  const results = [];
  for (const scene of SCENES) {
    process.stdout.write(`capture ${scene.id}...\n`);
    results.push(await captureScene(cdp, scene));
  }

  cdp.close();
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});

  const manifest = {
    lot: "PACK-PAX-10",
    capturedAt: new Date().toISOString(),
    gitHead: HEAD,
    wipNote: WIP_NOTE,
    viewport: VIEWPORT,
    viewportNarrow: VIEWPORT_NARROW,
    deviceScaleFactor: 1,
    browser: {
      product: "Google Chrome (system, CDP headless)",
      executablePath: CHROME,
      headless: true
    },
    gateway: "DevLauncherDesktopGateway (ng serve development, no preload)",
    rendererBase: BASE,
    fictionalValues: [
      "Chemin instance Dev gateway = C:\\\\Dev\\\\PaxCraft (fictif)",
      "chooseLocation Dev = D:\\\\Games\\\\PaxCraft (fictif)",
      "États AUTHENTICATED / READY = fixtures Dev"
    ],
    networkPolicy: {
      allow: ["127.0.0.1", "localhost", "data:", "blob:"],
      blockedExternalCount: cdp.blockedExternal.count,
      blockedExternalSamples: cdp.blockedExternal.samples,
      mechanism: "CDP Fetch.failRequest for non-loopback"
    },
    scenes: results,
    limits: [
      "Captures navigateur du renderer Angular — ne qualifient pas Electron ni chrome Windows.",
      "Fixtures Dev gateway uniquement.",
      "Préserver visual-after/PACK-PAX-07, 07.1, 08 et 09.",
      "Aucun package npm ajouté; Chrome système + CDP natif Node."
    ]
  };
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const cards = results
    .filter((r) => r.status === "CAPTURED")
    .map(
      (r) => `<figure><img src="${r.file}" alt="${r.id}"/><figcaption>${r.id}<br/><small>${r.note}</small></figcaption></figure>`
    )
    .join("\n");
  await writeFile(
    path.join(OUT, "planche-contact.html"),
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>PACK-PAX-10</title>
<style>body{font-family:Segoe UI,sans-serif;background:#10171f;color:#eef1f5;margin:1rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1rem}figure{margin:0;background:#131c2b;padding:.5rem;border:1px solid #2b3749}img{width:100%;display:block}figcaption{font-size:.75rem;margin-top:.4rem;color:#aab8ca}</style>
</head><body><h1>PACK-PAX-10 planche-contact</h1>
<p>Viewport ${VIEWPORT.width}×${VIEWPORT.height} / narrow ${VIEWPORT_NARROW.width}×${VIEWPORT_NARROW.height} · Dev gateway · HEAD ${HEAD}</p>
<div class="grid">${cards}</div></body></html>`,
    "utf8"
  );

  await writeFile(
    path.join(OUT, "README.md"),
    `# PACK-PAX-10 — Captures finitions

**HEAD :** \`${HEAD}\`
**WIP :** ${WIP_NOTE}

Isolation : rechargement SPA (\`?capture=\`) avant chaque scène. Préserver \`PACK-PAX-07/\`, \`07.1/\`, \`08/\`, \`09/\`.

## Reproduction

1. \`cd ui && pnpm exec ng serve --host 127.0.0.1 --port 4202\`
2. \`node scripts/pax-visual-capture/capture-cdp.mjs\`
`,
    "utf8"
  );

  // ZIP
  const zipPath = path.join(OUT, "captures-pax10.zip");
  const files = (await readdir(OUT)).filter(
    (f) => f.endsWith(".png") || f === "manifest.json" || f === "README.md" || f === "planche-contact.html"
  );
  await new Promise((resolve, reject) => {
    const ps = `if(Test-Path ${JSON.stringify(zipPath)}){Remove-Item ${JSON.stringify(zipPath)} -Force}; Compress-Archive -Path @(${files
      .map((f) => JSON.stringify(path.join(OUT, f)))
      .join(",")}) -DestinationPath ${JSON.stringify(zipPath)} -Force`;
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
    child.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("zip " + c))));
  });

  console.log(
    JSON.stringify(
      {
        captured: results.filter((r) => r.status === "CAPTURED").length,
        missing: results.filter((r) => r.status !== "CAPTURED"),
        blockedExternal: cdp.blockedExternal.count,
        out: OUT,
        zipPath
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
