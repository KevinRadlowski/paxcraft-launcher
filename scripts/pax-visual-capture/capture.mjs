/**
 * PACK-PAX-06 — visual reference capture harness (NOT a product entrypoint).
 *
 * Uses already-installed Google Chrome + cached Playwright package via npx.
 * Does not modify product code, network gates, or branding.
 * Blocks all non-loopback browser requests.
 *
 * Usage (from PaxCraft-Launcher):
 *   node scripts/pax-visual-capture/capture.mjs
 *
 * Requires: ng serve already listening on http://127.0.0.1:4202/
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  copyFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const OUT = path.join(REPO, "docs/pax-baseline/visual-before/2026-10-01");
const VIEWPORT = { width: 1280, height: 800 }; // desktop/main/window.ts BrowserWindow
const BASE = process.env.PAX_CAPTURE_BASE ?? "http://127.0.0.1:4202";
const CHROME =
  process.env.PAX_CAPTURE_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const HEAD = "33499137b02a3057f3891b978a8b484f06d44c57";
const WIP_NOTE =
  "WIP PACK-PAX-03..05.1 present (uncommitted). Captures reflect working tree, not HEAD alone.";

/** @typedef {{ id: string; route: string; auth?: string; install?: string; note?: string; action?: string }} Scene */

/** @type {Scene[]} */
const SCENES = [
  {
    id: "01-home-not-installed",
    route: "/home",
    auth: "SIGNED_OUT",
    install: "NOT_INSTALLED",
    note: "Accueil initial sans pack"
  },
  {
    id: "02-home-installed-ready",
    route: "/home",
    auth: "AUTHENTICATED",
    install: "READY",
    note: "Accueil avec pack installé (fixture READY)"
  },
  {
    id: "03-home-install-busy",
    route: "/home",
    auth: "AUTHENTICATED",
    install: "BUSY",
    note: "Progression installation (fixture BUSY / INSTALLING)"
  },
  {
    id: "04-home-update-available",
    route: "/home",
    auth: "AUTHENTICATED",
    install: "UPDATE_AVAILABLE",
    note: "Update disponible (fixture; mid-flight update trop rapide en Dev gateway)"
  },
  {
    id: "05-home-repair-required",
    route: "/home",
    auth: "AUTHENTICATED",
    install: "REPAIR_REQUIRED",
    note: "Repair requis (fixture)"
  },
  {
    id: "06-home-install-error",
    route: "/home",
    auth: "AUTHENTICATED",
    install: "NETWORK_ERROR",
    note: "Erreur d'installation (fixture NETWORK_ERROR)"
  },
  {
    id: "07-account-signed-out",
    route: "/account",
    auth: "SIGNED_OUT",
    install: "NOT_INSTALLED",
    note: "Compte déconnecté"
  },
  {
    id: "08-account-authenticated",
    route: "/account",
    auth: "AUTHENTICATED",
    install: "READY",
    note: "Compte connecté fictif (JoueurDemo)"
  },
  {
    id: "09-settings",
    route: "/settings",
    auth: "AUTHENTICATED",
    install: "READY",
    note: "Paramètres"
  },
  {
    id: "10-home-network-unconfigured",
    route: "/home",
    auth: "SIGNED_OUT",
    install: "NOT_INSTALLED",
    note: "État réseau non configuré (adresse not-configured / pas de ping)"
  },
  {
    id: "11-home-uninstall-modal",
    route: "/home",
    auth: "AUTHENTICATED",
    install: "READY",
    action: "open-uninstall-modal",
    note: "Modal confirmation désinstallation"
  }
];

function sha256File(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function isLoopbackUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      u.protocol === "data:" ||
      u.protocol === "blob:"
    );
  } catch {
    return false;
  }
}

async function loadPlaywright() {
  // Prefer resolving from npx cache / global without installing into the repo.
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    // Fall through — caller may set NODE_PATH
  }
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx")
  ];
  for (const root of candidates) {
    // best-effort: leave to env PLAYWRIGHT_MODULE
  }
  if (process.env.PLAYWRIGHT_MODULE) {
    return import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  }
  throw new Error(
    "playwright module not resolvable without install. Set PLAYWRIGHT_MODULE or run via npx with cache."
  );
}

async function applyFixtures(page, scene) {
  await page.goto(`${BASE}/diagnostics`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="fake-auth-fixture-select"]', { timeout: 60_000 });

  if (scene.auth) {
    await page.selectOption('[data-testid="fake-auth-fixture-select"]', scene.auth);
    await page.locator("section.panel.demo").nth(0).locator("sc-button, button").filter({ hasText: /Appliquer|Apply/i }).first().click();
    await page.waitForTimeout(300);
  }
  if (scene.install) {
    await page.selectOption('[data-testid="fake-install-fixture-select"]', scene.install);
    await page.locator("section.panel.demo").nth(1).locator("sc-button, button").filter({ hasText: /Appliquer|Apply/i }).first().click();
    await page.waitForTimeout(300);
  }
}

async function stabilize(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `
  });
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.addEventListener("load", () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            })
      )
    );
  });
}

async function captureScene(page, scene, blockedExternal) {
  const result = {
    id: scene.id,
    route: scene.route,
    fixture: {
      auth: scene.auth ?? null,
      install: scene.install ?? null,
      action: scene.action ?? null
    },
    note: scene.note ?? "",
    status: "NOT_CAPTURED",
    reason: null,
    file: null,
    sha256: null,
    blockedExternalHits: 0
  };

  const beforeBlocked = blockedExternal.count;
  try {
    await applyFixtures(page, scene);
    await page.goto(`${BASE}${scene.route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="home-page"], [data-testid="settings-page"], .page', {
      timeout: 60_000
    });
    await stabilize(page);

    if (scene.action === "open-uninstall-modal") {
      const btn = page.locator('[data-testid="uninstall-instance"]');
      if ((await btn.count()) === 0 || (await btn.isDisabled())) {
        result.reason = "uninstall control absent or disabled for fixture";
        return result;
      }
      await btn.click();
      await page.waitForTimeout(400);
      const modal = page.locator("sc-modal, [role='dialog'], .modal");
      if ((await modal.count()) === 0) {
        result.reason = "modal did not open";
        return result;
      }
    }

    const file = `${scene.id}.png`;
    const abs = path.join(OUT, file);
    await page.screenshot({ path: abs, fullPage: false });
    const buf = await readFile(abs);
    result.file = file;
    result.sha256 = sha256File(buf);
    result.status = "CAPTURED";
    result.blockedExternalHits = blockedExternal.count - beforeBlocked;

    // Basic image sanity: non-trivial size
    if (buf.byteLength < 8_000) {
      result.status = "NOT_CAPTURED";
      result.reason = `screenshot too small (${buf.byteLength} bytes) — possible blank page`;
    }
  } catch (e) {
    result.reason = e instanceof Error ? e.message : String(e);
  }
  return result;
}

async function writeContactSheet(results) {
  const cards = results
    .filter((r) => r.status === "CAPTURED" && r.file)
    .map(
      (r) => `
      <figure>
        <img src="${r.file}" alt="${r.id}" width="320" />
        <figcaption>${r.id}<br/><small>${r.note ?? ""}</small></figcaption>
      </figure>`
    )
    .join("\n");
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"/><title>PACK-PAX-06 planche-contact</title>
<style>
  body{font-family:Segoe UI,sans-serif;background:#111;color:#eee;margin:1rem}
  h1{font-size:1.1rem}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1rem}
  figure{margin:0;background:#1a1a1a;padding:.5rem;border-radius:6px}
  img{width:100%;height:auto;display:block;background:#000}
  figcaption{font-size:.75rem;margin-top:.4rem}
</style></head><body>
<h1>PACK-PAX-06 — planche-contact (renderer navigateur, fixtures)</h1>
<p>Viewport ${VIEWPORT.width}×${VIEWPORT.height} · gateway Dev · HEAD ${HEAD}</p>
<div class="grid">${cards}</div>
</body></html>`;
  await writeFile(path.join(OUT, "planche-contact.html"), html, "utf8");
}

async function zipOutputs() {
  const zipPath = path.join(OUT, "captures-pax06.zip");
  // PowerShell Compress-Archive via spawn for reliability on Windows
  const files = (await readdir(OUT)).filter(
    (f) => f.endsWith(".png") || f === "manifest.json" || f === "README.md" || f === "planche-contact.html"
  );
  const ps = `
    $dest = ${JSON.stringify(zipPath)}
    if (Test-Path $dest) { Remove-Item $dest -Force }
    $items = @(${files.map((f) => JSON.stringify(path.join(OUT, f))).join(",")})
    Compress-Archive -Path $items -DestinationPath $dest -Force
  `;
  await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", ps], {
      stdio: "inherit"
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`zip exit ${code}`))));
  });
  return zipPath;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // Resolve playwright: try npx-provided path via dynamic import from require.resolve in a child
  let playwright;
  try {
    const req = createRequire(
      path.join(REPO, "package.json")
    );
    // may fail — then use child_process to print module path from npx
    try {
      playwright = req("playwright");
    } catch {
      const modPath = await new Promise((resolve, reject) => {
        const child = spawn(
          "npx",
          ["--yes", "--package=playwright", "node", "-e", "console.log(require.resolve('playwright'))"],
          {
            cwd: REPO,
            env: {
              ...process.env,
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
              npm_config_yes: "true"
            },
            shell: true
          }
        );
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.stderr.on("data", (d) => process.stderr.write(d));
        child.on("exit", (code) => {
          if (code === 0 && out.trim()) resolve(out.trim().split(/\r?\n/).pop());
          else reject(new Error(`npx resolve playwright failed (${code}): ${out}`));
        });
      });
      playwright = createRequire(modPath)("playwright");
    }
  } catch (e) {
    throw e;
  }

  const { chromium } = playwright;
  const blockedExternal = { count: 0, samples: [] };

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--disable-dev-shm-usage", "--hide-scrollbars"]
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "dark",
    reducedMotion: "reduce"
  });

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isLoopbackUrl(url)) {
      await route.continue();
      return;
    }
    blockedExternal.count += 1;
    if (blockedExternal.samples.length < 20) blockedExternal.samples.push(url);
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  // Smoke: base reachable
  const smoke = await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (!smoke || !smoke.ok()) {
    throw new Error(`Renderer not reachable at ${BASE} (start ng serve on 127.0.0.1:4202)`);
  }

  const results = [];
  for (const scene of SCENES) {
    process.stdout.write(`capture ${scene.id}...\n`);
    results.push(await captureScene(page, scene, blockedExternal));
  }

  await browser.close();

  const manifest = {
    lot: "PACK-PAX-06",
    capturedAt: new Date().toISOString(),
    gitHead: HEAD,
    wipNote: WIP_NOTE,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    browser: {
      product: "Google Chrome (system)",
      executablePath: CHROME,
      mode: "playwright-chromium.connect via executablePath",
      headless: true
    },
    gateway: "DevLauncherDesktopGateway (ng serve development, no preload)",
    rendererBase: BASE,
    networkPolicy: {
      allow: ["127.0.0.1", "localhost", "data:", "blob:"],
      blockedExternalCount: blockedExternal.count,
      blockedExternalSamples: blockedExternal.samples
    },
    scenes: results,
    limits: [
      "Captures navigateur du renderer Angular — ne qualifient pas le rendu Electron ni le chrome Windows.",
      "Fixtures Dev gateway uniquement — aucun compte/instance réel.",
      "Mid-flight update/repair progress (phases 20ms) non figé séparément; scènes readiness capturées.",
      "PASS hermétique ≠ trafic Windows réel du launcher packagé."
    ]
  };

  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeContactSheet(results);

  const readme = `# PACK-PAX-06 — Captures de référence (avant rebranding)

**Dossier :** \`docs/pax-baseline/visual-before/2026-10-01/\`
**HEAD Git :** \`${HEAD}\`
**WIP :** ${WIP_NOTE}

## Reproduction

1. Depuis \`PaxCraft-Launcher/ui\` :
   \`\`\`bash
   pnpm exec ng serve --host 127.0.0.1 --port 4202
   \`\`\`
2. Depuis \`PaxCraft-Launcher\` (Playwright en cache npm, Chrome système, **sans** download navigateur) :
   \`\`\`bash
   set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
   node scripts/pax-visual-capture/capture.mjs
   \`\`\`

## Dimensions

- Viewport : **1280×800** (\`desktop/main/window.ts\` BrowserWindow)
- deviceScaleFactor : 1
- Gateway : Dev (renderer navigateur)

## Limites

- Renderer navigateur ≠ shell Electron (frame false, title bar native absente).
- Requêtes hors loopback **abort** côté harness navigateur uniquement.
- Aucune modification visuelle produit dans ce lot.
`;
  await writeFile(path.join(OUT, "README.md"), readme, "utf8");

  let zipPath = null;
  try {
    zipPath = await zipOutputs();
  } catch (e) {
    process.stderr.write(`ZIP failed: ${e}\n`);
  }

  const summary = {
    captured: results.filter((r) => r.status === "CAPTURED").length,
    missing: results.filter((r) => r.status !== "CAPTURED").length,
    blockedExternal: blockedExternal.count,
    out: OUT,
    zipPath
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
