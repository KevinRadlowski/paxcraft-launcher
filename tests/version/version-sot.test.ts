/**
 * PACK-09 — Launcher SemVer → Windows PE version mapping.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  parseLauncherVersion,
  readRootPackageVersion,
  WINDOWS_PRERELEASE_MAPPING_POLICY,
  VersionError,
  readGitBuildInfo,
  writeBuildGeneratedFiles,
  readGeneratedBuildId
} from "../../scripts/version/lib.mts";
import { LAUNCHER_VERSION, WINDOWS_FILE_VERSION } from "../../src/version.js";
import { DESKTOP_PRODUCT_VERSION } from "../../desktop/shared/product.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("PACK-09 version SoT and Windows mapping", () => {
  it("A. root package.json is canonical SemVer source", () => {
    const v = readRootPackageVersion(ROOT);
    assert.equal(v, "0.6.0-rc.18");
    assert.equal(LAUNCHER_VERSION, v);
    assert.equal(DESKTOP_PRODUCT_VERSION, v);
    assert.equal(WINDOWS_FILE_VERSION, "0.6.0.18");
  });

  it("B. stable and recognized prerelease mappings", () => {
    assert.equal(parseLauncherVersion("0.6.0").windowsVersion, "0.6.0.0");
    assert.equal(parseLauncherVersion("0.6.0-rc.18").windowsVersion, "0.6.0.18");
    assert.equal(parseLauncherVersion("0.6.0-beta.3").windowsVersion, "0.6.0.3");
    assert.equal(parseLauncherVersion("0.6.0-alpha.1").windowsVersion, "0.6.0.1");
  });

  it("C. rejects unsupported / ambiguous prerelease for Windows mapping", () => {
    assert.throws(() => parseLauncherVersion("0.6.0-rc"), VersionError);
    assert.throws(() => parseLauncherVersion("0.6.0-preview.1"), VersionError);
    assert.throws(() => parseLauncherVersion("0.6.0-rc.17.1"), VersionError);
    assert.throws(() => parseLauncherVersion("not-a-version"), VersionError);
  });

  it("D. rejects out-of-bounds PE components without truncation", () => {
    assert.throws(() => parseLauncherVersion("0.6.0-rc.65536"), VersionError);
    assert.throws(() => parseLauncherVersion("70000.0.0"), VersionError);
  });

  it("E. prerelease collision policy is phase-blind numeric N", () => {
    assert.equal(WINDOWS_PRERELEASE_MAPPING_POLICY, "PHASE_BLIND_NUMERIC_N");
    assert.equal(parseLauncherVersion("1.2.3-alpha.9").windowsVersion, "1.2.3.9");
    assert.equal(parseLauncherVersion("1.2.3-beta.9").windowsVersion, "1.2.3.9");
    assert.equal(parseLauncherVersion("1.2.3-rc.9").windowsVersion, "1.2.3.9");
  });

  it("F. generated modules and derived package fields stay consistent", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      version: string;
      shortVersion: string;
      shortVersionWindows: string;
    };
    const uiPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "ui", "package.json"), "utf8")) as {
      version: string;
    };
    const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
    assert.equal(rootPkg.version, LAUNCHER_VERSION);
    assert.equal(rootPkg.shortVersion, WINDOWS_FILE_VERSION);
    assert.equal(rootPkg.shortVersionWindows, WINDOWS_FILE_VERSION);
    assert.equal(uiPkg.version, LAUNCHER_VERSION);
    assert.match(yml, new RegExp(`^buildVersion:\\s*${WINDOWS_FILE_VERSION.replace(/\./g, "\\.")}\\s*$`, "m"));
    assert.match(
      yml,
      /artifactName:\s*\$\{productName\}-\$\{version\}-win-\$\{arch\}-setup\.\$\{ext\}/
    );
  });

  it("G. build identity distinguishes materially different packaged builds", () => {
    // Provenance is HEAD-derived and refreshed by version:check/generate — not commit-stable.
    const expected = readGitBuildInfo(ROOT, LAUNCHER_VERSION);
    writeBuildGeneratedFiles(ROOT, expected);
    const fromDisk = readGeneratedBuildId(path.join(ROOT, "src/build.generated.ts"));
    assert.equal(fromDisk, expected.buildId);
    assert.match(fromDisk, /^0\.6\.0-rc\.18@[0-9a-f]{12}(\+dirty)?$/);
    assert.notEqual(fromDisk, `${LAUNCHER_VERSION}@unknown`);
  });

  it("H. product.ts / version.ts do not hardcode product SemVer literals", () => {
    const productTs = fs.readFileSync(path.join(ROOT, "desktop", "shared", "product.ts"), "utf8");
    const versionTs = fs.readFileSync(path.join(ROOT, "src", "version.ts"), "utf8");
    assert.doesNotMatch(productTs, /DESKTOP_PRODUCT_VERSION\s*=\s*["']/);
    assert.doesNotMatch(versionTs, /LAUNCHER_VERSION\s*=\s*["']/);
    assert.match(productTs, /version\.generated/);
    assert.match(versionTs, /version\.generated/);
  });
});
