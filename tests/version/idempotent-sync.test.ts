/**
 * PACK-12G â€” version:generate sync must not falsely dirty a clean release checkout.
 * Root cause: unconditional JSON/YAML rewrite flipped CRLFâ†’LF on Windows CI.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseLauncherVersion,
  syncElectronBuilderBuildVersion,
  syncRootPackageDerivedFields,
  syncUiPackageVersion
} from "../../scripts/version/lib.mts";

const SEMVER = "0.6.0-rc.18";
const info = parseLauncherVersion(SEMVER);

describe("PACK-12G idempotent version sync (no false dirty)", () => {
  it("skips root package.json write when shortVersion* already match (CRLF preserved)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-sync-root-"));
    try {
      const pkgPath = path.join(dir, "package.json");
      // Simulate Windows checkout CRLF with correct values.
      const body =
        `{\r\n  "name": "x",\r\n  "version": "${SEMVER}",\r\n` +
        `  "shortVersion": "${info.windowsVersion}",\r\n` +
        `  "shortVersionWindows": "${info.windowsVersion}"\r\n}\r\n`;
      fs.writeFileSync(pkgPath, body, "utf8");
      const before = fs.readFileSync(pkgPath);
      assert.equal(syncRootPackageDerivedFields(dir, info), false);
      assert.ok(Buffer.compare(before, fs.readFileSync(pkgPath)) === 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips ui/package.json write when version already matches", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-sync-ui-"));
    try {
      fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
      const pkgPath = path.join(dir, "ui", "package.json");
      const body = `{\r\n  "name": "ui",\r\n  "version": "${SEMVER}"\r\n}\r\n`;
      fs.writeFileSync(pkgPath, body, "utf8");
      const before = fs.readFileSync(pkgPath);
      assert.equal(syncUiPackageVersion(dir, info), false);
      assert.ok(Buffer.compare(before, fs.readFileSync(pkgPath)) === 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips electron-builder.yml write when buildVersion already matches", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-sync-yml-"));
    try {
      const ymlPath = path.join(dir, "electron-builder.yml");
      const body = `buildVersion: ${info.windowsVersion}\r\nappId: org.paxhorizon.paxcraft.launcher\r\n`;
      fs.writeFileSync(ymlPath, body, "utf8");
      const before = fs.readFileSync(ymlPath);
      assert.equal(syncElectronBuilderBuildVersion(dir, info), false);
      assert.ok(Buffer.compare(before, fs.readFileSync(ymlPath)) === 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes when values actually differ", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-sync-write-"));
    try {
      fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: SEMVER, shortVersion: "0.0.0.0", shortVersionWindows: "0.0.0.0" }, null, 2) +
          "\n",
        "utf8"
      );
      fs.writeFileSync(
        path.join(dir, "ui", "package.json"),
        JSON.stringify({ name: "ui", version: "0.0.0" }, null, 2) + "\n",
        "utf8"
      );
      fs.writeFileSync(path.join(dir, "electron-builder.yml"), "buildVersion: 0.0.0.0\nappId: x\n", "utf8");
      assert.equal(syncRootPackageDerivedFields(dir, info), true);
      assert.equal(syncUiPackageVersion(dir, info), true);
      assert.equal(syncElectronBuilderBuildVersion(dir, info), true);
      const root = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        shortVersion: string;
      };
      const ui = JSON.parse(fs.readFileSync(path.join(dir, "ui", "package.json"), "utf8")) as {
        version: string;
      };
      assert.equal(root.shortVersion, info.windowsVersion);
      assert.equal(ui.version, SEMVER);
      assert.match(fs.readFileSync(path.join(dir, "electron-builder.yml"), "utf8"), /buildVersion:\s*0\.6\.0\.18/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
