/**
 * 0.6F.4 V2 Settings page source contracts (desktop suite — may use node:fs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(
  path.join(root, "ui/src/app/features/settings/settings.page.ts"),
  "utf8"
);
const memorySource = readFileSync(
  path.join(root, "ui/src/app/features/settings/settings-memory.ts"),
  "utf8"
);
const frJson = JSON.parse(
  readFileSync(path.join(root, "ui/src/assets/i18n/fr.json"), "utf8")
) as Record<string, string>;
const productLinks = readFileSync(
  path.join(root, "ui/src/app/core/product-links.ts"),
  "utf8"
);
const homeSource = readFileSync(
  path.join(root, "ui/src/app/features/home/home.page.ts"),
  "utf8"
);
const accountSource = readFileSync(
  path.join(root, "ui/src/app/features/account/account.page.ts"),
  "utf8"
);
const productTs = readFileSync(path.join(root, "desktop/shared/product.ts"), "utf8");
const versionTs = readFileSync(path.join(root, "src/version.ts"), "utf8");
const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  version: string;
};
const uiPkg = JSON.parse(readFileSync(path.join(root, "ui/package.json"), "utf8")) as {
  version: string;
};

const FAKE_TOGGLE_PATTERNS = [
  /jvmArgs|extraJvmArgs|JVM args/i,
  /auto.?optim|optimisations? auto/i,
  /theme|th[eè]me/i,
  /minimize.?tray|réduire.?dans.?la.?barre/i,
  /auto-?launch|lancement.?auto/i,
  /auto-?connect|connexion.?auto/i,
  /notifications?\s*toggle|activer.?les.?notifications/i,
  /nettoyage|cleanup|backups?|sauvegardes?/i,
  /mentions.?l[eé]gales/i,
  /DirectX|GPU\b/i,
  /test.?arbitrary.?host|hôte.?arbitraire/i
];

describe("PACK-PAX-08 Settings page source contracts", () => {
  it("compact header + functional cards (no castle hero / banner)", () => {
    assert.doesNotMatch(pageSource, /sc-hero|settings-banner|SETTINGS_ASSETS/);
    assert.match(pageSource, /page-head/);
    assert.match(pageSource, /settings-memory-card/);
    assert.match(pageSource, /settings-interface-card/);
    assert.match(pageSource, /settings-system-card/);
    assert.match(pageSource, /settings-network-card/);
    assert.match(pageSource, /settings-data-card/);
    assert.match(pageSource, /settings-about-card/);
    assert.match(pageSource, /settings-location-card/);
  });

  it("writable settings only: memoryMiB + reducedMotion + reset 2048", () => {
    assert.match(pageSource, /memoryMiB:\s*this\.draftMemory\(\)/);
    assert.match(pageSource, /reducedMotion:\s*value === true/);
    assert.match(pageSource, /MEMORY_DEFAULT/);
    assert.match(pageSource, /resetMemory\(\)/);
    assert.match(pageSource, /memoryMiB:\s*MEMORY_DEFAULT/);
  });

  it("language is Français read-only — not editable", () => {
    assert.match(pageSource, /settings\.language\.value/);
    assert.equal(frJson["settings.language.value"], "Français");
    assert.doesNotMatch(pageSource, /ngModel\]="language"|languageDraft|select.*language/i);
  });

  it("no fake toggles / omitted features in page source", () => {
    for (const re of FAKE_TOGGLE_PATTERNS) {
      assert.doesNotMatch(pageSource, re, String(re));
    }
    assert.doesNotMatch(pageSource, /settings\.section\.unavailable/);
    assert.doesNotMatch(pageSource, /absolutePath|userDataPath|C:\\\\|\/Users\//);
  });

  it("system + storage + server gateway wiring present", () => {
    assert.match(pageSource, /gateway\.system\.getInfo/);
    assert.match(pageSource, /gateway\.system\.getFixedDisks/);
    assert.match(pageSource, /gateway\.storage\.getSummary/);
    assert.match(pageSource, /gateway\.storage\.openInstance/);
    assert.match(pageSource, /gateway\.storage\.openLogs/);
    assert.match(pageSource, /HomeServerStatusService/);
    assert.match(pageSource, /serverSvc\.refresh/);
    assert.doesNotMatch(pageSource, /sweetcraft\.datho\.st/);
    assert.doesNotMatch(pageSource, /gateway\.server\.getStatus/);
  });

  it("website CTA references SWEETCRAFT_WEBSITE_URL (unset / no historical CDN)", () => {
    assert.match(productLinks, /SWEETCRAFT_WEBSITE_URL:\s*string\s*\|\s*null\s*=\s*null|SWEETCRAFT_WEBSITE_URL\s*=\s*null/);
    assert.match(pageSource, /SWEETCRAFT_WEBSITE_URL/);
    assert.doesNotMatch(productLinks, /https:\/\/www\.xnosweet\.fr\/sweetcraft/);
    assert.doesNotMatch(pageSource, /cdn\.xnosweet\.fr/);
  });

  it("About uses publisher + Pax brand + store versions + authoritative buildId", () => {
    assert.equal(frJson["settings.about.publisher_value"], "Maidenhead");
    assert.match(frJson["settings.about.brand_value"] ?? "", /PaxCraft/);
    assert.equal(frJson["settings.about.build_id"], "Build");
    assert.match(pageSource, /aboutBuildId/);
    assert.match(pageSource, /store\.info\(\)\?\.buildId/);
    assert.match(pageSource, /settings-about-build-id/);
    assert.match(pageSource, /status\(\)\?\.minecraftVersion/);
    assert.match(pageSource, /status\(\)\?\.fabricVersion/);
    assert.match(pageSource, /installedVersion \|\| status\(\)\?\.packVersion/);
  });

  it("responsive + reduced-motion breakpoints present", () => {
    assert.match(pageSource, /@media \(max-width: 1279px\)/);
    assert.match(pageSource, /@media \(max-width: 900px\)/);
    assert.match(pageSource, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(pageSource, /repeat\(3, minmax\(0, 1fr\)\)/);
  });

  it("Home / Account pages not polluted by Settings markers", () => {
    assert.doesNotMatch(homeSource, /sweetcraft-settings-hero|settings-memory-card/);
    assert.doesNotMatch(accountSource, /sweetcraft-settings-hero|settings-memory-card/);
  });

  it("V3: multi-disk markers; no path; no fake CPU; live poll + 60s disks", () => {
    assert.match(pageSource, /settings-storage-list/);
    assert.match(pageSource, /settings-sweetcraft-drive-ring/);
    assert.match(pageSource, /settings\.system\.storage/);
    assert.match(pageSource, /settings\.system\.sweetcraft_drive/);
    assert.match(pageSource, /formatDiskFreeSurTotal/);
    assert.match(pageSource, /SettingsSystemPoller/);
    assert.match(pageSource, /SYSTEM_POLL_INTERVAL_MS/);
    assert.match(pageSource, /DISK_POLL_INTERVAL_MS/);
    assert.match(pageSource, /stroke-dasharray 400ms/);
    assert.doesNotMatch(pageSource, /absolutePath|userDataPath|C:\\\\Users|\/Users\//);
    assert.doesNotMatch(pageSource, /cpuUsedPercent|cpuPercent|CPU\s*\d+\s*%/i);
    assert.doesNotMatch(pageSource, /DirectX|GPU\b/);
    assert.equal(frJson["settings.system.storage"], "STOCKAGE");
    assert.equal(frJson["settings.system.ram_used"], "RAM utilisée");
    assert.equal(frJson["settings.system.sweetcraft_drive"], "Disque PaxCraft");
    assert.equal(frJson["error.network.pack_check"], "Vérification du pack impossible.");
    assert.equal(frJson["error.network.auth"], "Erreur réseau d’authentification.");
    assert.equal(frJson["error.install.status_network"], "Impossible de vérifier la version du pack.");
    assert.equal(frJson["error.install.network"], "Erreur réseau pendant l'installation.");
  });

  it("V4: grid height fix + bounded disk-list (5 drives)", () => {
    assert.match(pageSource, /align-items:\s*start/);
    assert.match(pageSource, /\.disk-list\s*\{[\s\S]*?max-height:\s*12\.5rem/);
    assert.match(pageSource, /overflow-x:\s*hidden/);
    assert.match(pageSource, /flex:\s*0\s+1\s+auto/);
    assert.match(pageSource, /margin-top:\s*var\(--sc-space-2\)/);
    assert.doesNotMatch(pageSource, /\.card-foot\s*\{[^}]*margin-top:\s*auto/);
    assert.doesNotMatch(pageSource, /overflow-x:\s*(?:scroll|auto)/);
    assert.match(memorySource, /export function formatDiskFreeSurTotal/);
    assert.match(memorySource, /export function formatDiskCapacityGiB/);
  });

  it("V2: diskUsedPercent helper still present; rings use product disk", () => {
    assert.match(memorySource, /export function diskUsedPercent/);
    assert.match(pageSource, /stroke-dasharray/);
    assert.match(pageSource, /metric-rings/);
    assert.doesNotMatch(pageSource, /cpuUsedPercent|cpuPercent|CPU\s*\d+\s*%/i);
    assert.doesNotMatch(pageSource, /DirectX|GPU\b/);
  });

  it("V2: storage disabled reason keys present", () => {
    assert.equal(frJson["settings.data.unavailable_install"], "Disponible après installation.");
    assert.equal(frJson["settings.data.available"], "Disponible");
    assert.equal(frJson["settings.data.unavailable"], "Indisponible");
    assert.match(pageSource, /settings\.data\.unavailable_install/);
    assert.match(pageSource, /!storageSummary\(\)\?\.instanceAvailable/);
  });

  it("V2: clickable matrix contracts still hold", () => {
    assert.match(pageSource, /saveMemory\(\)/);
    assert.match(pageSource, /resetMemory\(\)/);
    assert.match(pageSource, /onReducedMotion/);
    assert.match(pageSource, /refreshSystem\(\)/);
    assert.match(pageSource, /refreshServer\(\)/);
    assert.match(pageSource, /openInstance\(\)/);
    assert.match(pageSource, /openLogs\(\)/);
    assert.match(pageSource, /settings\.about\.site/);
    assert.match(pageSource, /settings\.network\.site/);
    assert.doesNotMatch(pageSource, /href="#"/);
    assert.doesNotMatch(pageSource, /console\.log\(/);
  });

  it("V4 version surfaces converge on root package SemVer (PACK-09)", () => {
    assert.equal(rootPkg.version, "0.6.0-rc.18");
    assert.equal(uiPkg.version, "0.6.0-rc.18");
    assert.match(productTs, /version\.generated/);
    assert.doesNotMatch(productTs, /DESKTOP_PRODUCT_VERSION\s*=\s*["']/);
    assert.match(versionTs, /version\.generated/);
    assert.doesNotMatch(versionTs, /LAUNCHER_VERSION\s*=\s*["']/);
    const generated = readFileSync(path.join(root, "src/version.generated.ts"), "utf8");
    assert.match(generated, /LAUNCHER_VERSION = "0\.6\.0\.rc\.18"|LAUNCHER_VERSION = "0\.6\.0-rc\.18"/);
    assert.match(generated, /WINDOWS_FILE_VERSION = "0\.6\.0\.18"/);
  });
});
