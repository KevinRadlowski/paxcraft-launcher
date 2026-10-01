/**
 * PACK-04 — Windows packaging identity / branding config (offline).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readYamlish(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("PACK-04 Windows packaging identity", () => {
  it("A. electron-builder carries required Pax product identity", () => {
    const yml = readYamlish(path.join(ROOT, "electron-builder.yml"));
    assert.match(yml, /^appId:\s*org\.paxhorizon\.paxcraft\.launcher\s*$/m);
    assert.match(yml, /^productName:\s*PaxCraft Launcher\s*$/m);
    assert.match(yml, /^executableName:\s*PaxCraft Launcher\s*$/m);
    assert.match(yml, /artifactName:\s*\$\{productName\}-\$\{version\}-win-\$\{arch\}-setup\.\$\{ext\}/);
    assert.match(yml, /perMachine:\s*false/);
    assert.match(yml, /createDesktopShortcut:\s*true/);
    assert.match(yml, /createStartMenuShortcut:\s*true/);
    assert.match(yml, /icon:\s*build\/icon\.ico/);
    assert.match(yml, /installerIcon:\s*build\/icon\.ico/);
    assert.match(yml, /uninstallerIcon:\s*build\/icon\.ico/);
    assert.match(yml, /uninstallDisplayName:\s*PaxCraft Launcher/);
    assert.match(yml, /shortcutName:\s*PaxCraft Launcher/);
    assert.match(yml, /deleteAppDataOnUninstall:\s*false/);
    assert.doesNotMatch(yml, /perMachine:\s*true/);
    assert.doesNotMatch(yml, /fr\.xbase\.sweetcraft\.launcher/);
  });

  it("B. Windows icon assets exist with multi-size ICO header", () => {
    const icoPath = path.join(ROOT, "build", "icon.ico");
    const pngPath = path.join(ROOT, "build", "icon.png");
    const srcPath = path.join(ROOT, "build", "icon-source.svg");
    assert.ok(fs.existsSync(srcPath), "icon-source.svg missing");
    assert.ok(fs.existsSync(pngPath), "icon.png missing");
    assert.ok(fs.existsSync(icoPath), "icon.ico missing");

    const ico = fs.readFileSync(icoPath);
    assert.ok(ico.length > 1024, "icon.ico unexpectedly tiny");
    // ICO: reserved=0, type=1 (icon), count>=7 preferred sizes
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.ok(ico.readUInt16LE(4) >= 7, `expected >=7 icon images, got ${ico.readUInt16LE(4)}`);
  });

  it("C. AppUserModelID remains single-sourced in main + product constant", () => {
    const main = fs.readFileSync(path.join(ROOT, "desktop", "main", "main.ts"), "utf8");
    assert.match(main, /DESKTOP_APP_USER_MODEL_ID/);
    assert.doesNotMatch(main, /fr\.xbase\.sweetcraft\.launcher/);
    const product = fs.readFileSync(path.join(ROOT, "desktop", "shared", "product.ts"), "utf8");
    assert.match(
      product,
      /DESKTOP_APP_USER_MODEL_ID\s*=\s*"org\.paxhorizon\.paxcraft\.launcher"/
    );
  });

  it("D. package.json version remains the installer SemVer source (0.6.0-rc.18)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      version: string;
      description: string;
      shortVersion?: string;
      shortVersionWindows?: string;
    };
    assert.equal(pkg.version, "0.6.0-rc.18");
    assert.equal(pkg.shortVersion, "0.6.0.18");
    assert.equal(pkg.shortVersionWindows, "0.6.0.18");
    assert.ok(pkg.description.includes("PaxCraft Launcher"));
  });

  it("D2. PACK-12C PE CompanyName branding remains SweetCraft / XBASE (rights; not Authenticode)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      author?: string | { name?: string; email?: string; url?: string };
    };
    assert.ok(pkg.author && typeof pkg.author === "object", "author object required for PE CompanyName");
    assert.equal(pkg.author.name, "SweetCraft / XBASE");
    assert.equal(pkg.author.email, undefined);
    assert.equal(pkg.author.url, undefined);
    assert.notEqual(pkg.author.name, "GitHub, Inc.");
    const yml = readYamlish(path.join(ROOT, "electron-builder.yml"));
    assert.match(yml, /SweetCraft \/ XBASE/);
    assert.doesNotMatch(yml, /GitHub,\s*Inc/);
    assert.match(yml, /^appId:\s*org\.paxhorizon\.paxcraft\.launcher\s*$/m);
    assert.match(yml, /^productName:\s*PaxCraft Launcher\s*$/m);
    assert.match(yml, /^executableName:\s*PaxCraft Launcher\s*$/m);
  });

  it("E. PACK-05 product default channel is dev (CDN publishes only dev today)", async () => {
    const { PRODUCT_DEFAULT_CHANNEL } = await import("../../desktop/shared/product.js");
    assert.equal(PRODUCT_DEFAULT_CHANNEL, "dev");
    const installSrc = fs.readFileSync(
      path.join(ROOT, "desktop", "main", "install", "real-install-backend.ts"),
      "utf8"
    );
    const playSrc = fs.readFileSync(
      path.join(ROOT, "desktop", "main", "play", "real-play-backend.ts"),
      "utf8"
    );
    assert.match(installSrc, /opts\.channel \?\? PRODUCT_DEFAULT_CHANNEL/);
    assert.match(playSrc, /opts\.channel \?\? PRODUCT_DEFAULT_CHANNEL/);
    assert.doesNotMatch(installSrc, /opts\.channel \?\? "stable"/);
    assert.doesNotMatch(playSrc, /opts\.channel \?\? "stable"/);
  });

  it("F. install backend always binds runtimePath under dataDir (PACK-05 isolation)", () => {
    const installSrc = fs.readFileSync(
      path.join(ROOT, "desktop", "main", "install", "real-install-backend.ts"),
      "utf8"
    );
    const life = fs.readFileSync(
      path.join(ROOT, "desktop", "main", "lifecycle.ts"),
      "utf8"
    );
    assert.match(installSrc, /runtimePath = opts\.runtimePath \?\? path\.join\(opts\.dataDir, "runtime"\)/);
    assert.match(life, /runtimePath:\s*path\.join\(dataDir,\s*"runtime"\)/);
  });
});
