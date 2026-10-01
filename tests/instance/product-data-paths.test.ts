/**
 * PACK-03 / PACK-PAX-04 — Pax data paths + SweetCraft non-interference (hermetic APPDATA).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_INSTANCE_ID,
  ENV_LAUNCHER_DATA_DIR,
  FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME,
  FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME,
  LAUNCHER_DATA_DIR_NAME,
  LEGACY_SWEETCRAFT_ENV_LAUNCHER_DATA_DIR,
  PRODUCT_USER_DATA_DIR_NAME,
  ForeignSweetCraftDataPathError,
  defaultInstanceRoot,
  defaultLauncherDataDir,
  defaultRuntimeRoot,
  isUnderForeignSweetCraftRoot,
  launcherDataDirHasProductMarkers,
  migrateLegacyLauncherDataIfNeeded,
  resolveCanonicalLauncherDataDir,
  resolveForeignSweetCraftRoots,
  resolveLauncherDataRoot,
  resolveProductUserDataRoot
} from "../../src/instance/paths/index.js";
import {
  buildInstancePathGuardContext,
  validateInstancePathCandidate
} from "../../src/instance/paths/instanceLocation.js";
import {
  DEFAULT_INSTANCE_ID as DESKTOP_INSTANCE_ID,
  LAUNCHER_DATA_DIR_NAME as DESKTOP_DATA_NAME,
  PRODUCT_USER_DATA_DIR_NAME as DESKTOP_PRODUCT_NAME,
  defaultInstancePathFromUserData,
  defaultRuntimePathFromUserData,
  launcherDataDirFromUserData
} from "../../desktop/shared/product-data.js";

function makeAppDataTree(): { root: string; appData: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pax-pack04-"));
  const appData = path.join(root, "AppData", "Roaming");
  fs.mkdirSync(appData, { recursive: true });
  return {
    root,
    appData,
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  };
}

function seedSweetCraftSentinels(appData: string): {
  productRoot: string;
  legacyRoot: string;
  markerFile: string;
} {
  const productRoot = path.join(appData, FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME, "launcher-data");
  const legacyRoot = path.join(appData, FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME);
  fs.mkdirSync(path.join(productRoot, "state"), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, "state"), { recursive: true });
  const markerFile = path.join(productRoot, "state", "accounts.json");
  fs.writeFileSync(markerFile, '{"sentinel":"sweetcraft-untouched"}\n', "utf8");
  fs.writeFileSync(path.join(legacyRoot, "state", "anti-rollback.json"), '{"seq":99}\n', "utf8");
  fs.mkdirSync(path.join(productRoot, "secure"), { recursive: true });
  fs.writeFileSync(path.join(productRoot, "secure", "probe.txt"), "sc-dpapi-probe", "utf8");
  return { productRoot, legacyRoot, markerFile };
}

describe("PACK-PAX-04 Pax data paths + SweetCraft isolation", () => {
  it("A. CLI Windows default converges with Desktop Pax layout", () => {
    const { appData, cleanup } = makeAppDataTree();
    try {
      const opts = {
        platform: "win32" as const,
        env: { APPDATA: appData },
        homedir: path.dirname(path.dirname(appData))
      };
      const product = resolveProductUserDataRoot(opts);
      const data = defaultLauncherDataDir(opts);
      assert.equal(product, path.join(appData, PRODUCT_USER_DATA_DIR_NAME));
      assert.equal(PRODUCT_USER_DATA_DIR_NAME, "PaxCraft Launcher");
      assert.equal(data, path.join(product, LAUNCHER_DATA_DIR_NAME));
      assert.equal(launcherDataDirFromUserData(product), data);
      assert.equal(DESKTOP_PRODUCT_NAME, PRODUCT_USER_DATA_DIR_NAME);
      assert.equal(DESKTOP_DATA_NAME, LAUNCHER_DATA_DIR_NAME);
    } finally {
      cleanup();
    }
  });

  it("B. default instance is instances/paxcraft for CLI and Desktop", () => {
    const { appData, cleanup } = makeAppDataTree();
    try {
      const opts = { platform: "win32" as const, env: { APPDATA: appData } };
      const data = defaultLauncherDataDir(opts);
      const inst = defaultInstanceRoot(data);
      assert.equal(path.basename(inst), "paxcraft");
      assert.equal(DEFAULT_INSTANCE_ID, "paxcraft");
      assert.equal(DESKTOP_INSTANCE_ID, DEFAULT_INSTANCE_ID);
      const product = resolveProductUserDataRoot(opts);
      assert.equal(defaultInstancePathFromUserData(product), inst);
    } finally {
      cleanup();
    }
  });

  it("C. default runtime converges under Pax dataDir", () => {
    const { appData, cleanup } = makeAppDataTree();
    try {
      const opts = { platform: "win32" as const, env: { APPDATA: appData } };
      const data = defaultLauncherDataDir(opts);
      const rt = defaultRuntimeRoot(data);
      assert.equal(rt, path.join(data, "runtime"));
      assert.equal(defaultRuntimePathFromUserData(resolveProductUserDataRoot(opts)), rt);
    } finally {
      cleanup();
    }
  });

  it("D. PAXCRAFT_LAUNCHER_DATA_DIR env override accepted when outside SweetCraft", () => {
    const { root, appData, cleanup } = makeAppDataTree();
    try {
      const custom = path.join(root, "env-pax-data");
      const resolved = resolveLauncherDataRoot({
        platform: "win32",
        env: { APPDATA: appData, [ENV_LAUNCHER_DATA_DIR]: custom }
      });
      assert.equal(resolved.source, "env");
      assert.equal(resolved.dataDir, path.resolve(custom));
      assert.equal(resolved.legacyDataDir, null);
    } finally {
      cleanup();
    }
  });

  it("E. SWEETCRAFT_LAUNCHER_DATA_DIR has no effect (no silent alias)", () => {
    const { root, appData, cleanup } = makeAppDataTree();
    try {
      const decoy = path.join(root, "sweetcraft-decoy-data");
      fs.mkdirSync(decoy, { recursive: true });
      const resolved = resolveLauncherDataRoot({
        platform: "win32",
        env: {
          APPDATA: appData,
          [LEGACY_SWEETCRAFT_ENV_LAUNCHER_DATA_DIR]: decoy
        }
      });
      assert.equal(resolved.source, "canonical");
      assert.equal(
        resolved.dataDir,
        path.join(appData, PRODUCT_USER_DATA_DIR_NAME, LAUNCHER_DATA_DIR_NAME)
      );
      assert.notEqual(resolved.dataDir, path.resolve(decoy));
    } finally {
      cleanup();
    }
  });

  it("F. explicit Pax override accepted; SweetCraft roots refused", () => {
    const { root, appData, cleanup } = makeAppDataTree();
    try {
      seedSweetCraftSentinels(appData);
      const ok = path.join(root, "custom-pax-data");
      const resolved = resolveLauncherDataRoot({
        platform: "win32",
        env: { APPDATA: appData },
        explicitDataDir: ok
      });
      assert.equal(resolved.source, "explicit");
      assert.equal(resolved.dataDir, path.resolve(ok));

      const scData = path.join(appData, FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME, "launcher-data");
      assert.throws(
        () =>
          resolveLauncherDataRoot({
            platform: "win32",
            env: { APPDATA: appData },
            explicitDataDir: scData
          }),
        (e: unknown) => e instanceof ForeignSweetCraftDataPathError
      );
      assert.throws(
        () =>
          resolveLauncherDataRoot({
            platform: "win32",
            env: { APPDATA: appData, [ENV_LAUNCHER_DATA_DIR]: scData }
          }),
        (e: unknown) => e instanceof ForeignSweetCraftDataPathError
      );
    } finally {
      cleanup();
    }
  });

  it("G. no migration / no probe of SweetCraft sentinels; markers unchanged", () => {
    const { appData, cleanup } = makeAppDataTree();
    try {
      const { productRoot, legacyRoot, markerFile } = seedSweetCraftSentinels(appData);
      const before = fs.readFileSync(markerFile, "utf8");
      const beforeLegacy = fs.readFileSync(
        path.join(legacyRoot, "state", "anti-rollback.json"),
        "utf8"
      );

      const opts = { platform: "win32" as const, env: { APPDATA: appData } };
      assert.equal(launcherDataDirHasProductMarkers(productRoot, opts), true);
      assert.equal(launcherDataDirHasProductMarkers(legacyRoot, opts), true);

      const mig = migrateLegacyLauncherDataIfNeeded(opts);
      assert.equal(mig.migrated, false);
      assert.deepEqual(mig.copiedEntries, []);

      const resolved = resolveLauncherDataRoot({ ...opts, allowLegacyFallback: true });
      assert.equal(resolved.source, "canonical");
      assert.equal(resolved.legacyDataDir, null);
      assert.ok(resolved.dataDir.includes("PaxCraft Launcher"));
      assert.ok(!resolved.dataDir.includes("SweetCraft"));

      const paxCanonical = resolveCanonicalLauncherDataDir(opts);
      assert.equal(launcherDataDirHasProductMarkers(paxCanonical, opts), false);
      assert.ok(!fs.existsSync(path.join(paxCanonical, "state", "accounts.json")));

      assert.equal(fs.readFileSync(markerFile, "utf8"), before);
      assert.equal(
        fs.readFileSync(path.join(legacyRoot, "state", "anti-rollback.json"), "utf8"),
        beforeLegacy
      );
    } finally {
      cleanup();
    }
  });

  it("H. instance custom path under SweetCraft roots refused (guard)", () => {
    const { appData, cleanup } = makeAppDataTree();
    try {
      seedSweetCraftSentinels(appData);
      const paxUser = path.join(appData, PRODUCT_USER_DATA_DIR_NAME);
      const paxData = path.join(paxUser, LAUNCHER_DATA_DIR_NAME);
      fs.mkdirSync(paxData, { recursive: true });
      const guard = buildInstancePathGuardContext(paxData, paxUser);
      const foreignInst = path.join(
        appData,
        FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME,
        "launcher-data",
        "instances",
        "stolen"
      );
      const result = validateInstancePathCandidate(foreignInst, guard);
      assert.equal(result.ok, false);
      assert.equal(result.reason, "FOREIGN_SWEETCRAFT_DATA_ROOT");

      const okCustom = path.join(path.dirname(appData), "Games", "PaxCustomInstance");
      const ok = validateInstancePathCandidate(okCustom, guard);
      assert.equal(ok.ok, true);
      assert.equal(ok.canonicalPath, path.resolve(okCustom));
    } finally {
      cleanup();
    }
  });

  it("I. junction into SweetCraft root refused when testable", () => {
    if (process.platform !== "win32") {
      // Junction semantics are Windows-specific for this regression.
      return;
    }
    const { root, appData, cleanup } = makeAppDataTree();
    try {
      const { productRoot } = seedSweetCraftSentinels(appData);
      const link = path.join(root, "junction-to-sc");
      let linked = false;
      try {
        fs.symlinkSync(productRoot, link, "junction");
        linked = true;
      } catch {
        // Privilege / FS policy — skip without failing the suite.
        return;
      }
      assert.equal(linked, true);
      assert.equal(
        isUnderForeignSweetCraftRoot(link, {
          platform: "win32",
          env: { APPDATA: appData }
        }),
        true
      );
      assert.throws(
        () =>
          resolveLauncherDataRoot({
            platform: "win32",
            env: { APPDATA: appData },
            explicitDataDir: link
          }),
        (e: unknown) => e instanceof ForeignSweetCraftDataPathError
      );
    } finally {
      cleanup();
    }
  });

  it("J. foreign roots listing is SweetCraft-only; Pax root distinct", () => {
    const { appData, cleanup } = makeAppDataTree();
    try {
      const opts = { platform: "win32" as const, env: { APPDATA: appData } };
      const foreign = resolveForeignSweetCraftRoots(opts);
      assert.equal(foreign.length, 2);
      assert.ok(foreign.some((p) => p.endsWith(FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME)));
      assert.ok(foreign.some((p) => p.endsWith(FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME)));
      const pax = resolveProductUserDataRoot(opts);
      assert.ok(!foreign.includes(pax));
    } finally {
      cleanup();
    }
  });

  it("K. tests never target real APPDATA — injected env only", () => {
    const real = process.env.APPDATA ?? "";
    const { appData, cleanup } = makeAppDataTree();
    try {
      const data = defaultLauncherDataDir({
        platform: "win32",
        env: { APPDATA: appData }
      });
      assert.ok(data.startsWith(appData));
      if (real) {
        assert.ok(!data.startsWith(real), "must not write under real APPDATA");
      }
    } finally {
      cleanup();
    }
  });
});
