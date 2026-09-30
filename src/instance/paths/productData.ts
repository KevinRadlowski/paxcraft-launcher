/**
 * Canonical SweetCraft Launcher product data layout (PACK-03).
 * Shared by CLI and Desktop — no Electron imports.
 *
 * Windows product userData (Electron / CLI):
 *   %APPDATA%\SweetCraft Launcher
 * Launcher managed root:
 *   %APPDATA%\SweetCraft Launcher\launcher-data
 * Default instance:
 *   …/launcher-data/instances/sweetcraft
 *
 * Legacy CLI root (pre-PACK-03):
 *   %APPDATA%\SweetCraftLauncher  (was the data dir itself)
 */
import fs from "node:fs";
import path from "node:path";
import { homedir as osHomedir } from "node:os";

/** Electron productName / Windows AppData folder — keep in sync with desktop/shared/product.ts */
export const PRODUCT_USER_DATA_DIR_NAME = "SweetCraft Launcher";

/** Managed application data under product userData. */
export const LAUNCHER_DATA_DIR_NAME = "launcher-data";

/** Canonical default instance id (was CLI "default", Desktop "sweetcraft"). */
export const DEFAULT_INSTANCE_ID = "sweetcraft";

/** Pre-PACK-03 CLI data directory name (flat APPDATA child = data root). */
export const LEGACY_CLI_DATA_DIR_NAME = "SweetCraftLauncher";

export const ENV_LAUNCHER_DATA_DIR = "SWEETCRAFT_LAUNCHER_DATA_DIR";

export type LauncherDataRootSource = "explicit" | "env" | "canonical" | "legacy-fallback";

export interface ProductDataPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homedir?: string;
  /**
   * Electron app.getPath("userData") when available.
   * Must already be the product userData root (…/SweetCraft Launcher).
   */
  readonly electronUserData?: string;
  /** Explicit override (CLI --data-dir). Highest precedence after validation. */
  readonly explicitDataDir?: string;
  /**
   * When true (default), allow reading/writing legacy CLI root if canonical is empty
   * and legacy has product markers. Never deletes legacy.
   */
  readonly allowLegacyFallback?: boolean;
  /** Injected FS for tests. */
  readonly existsSync?: (p: string) => boolean;
}

export interface ResolvedLauncherDataRoot {
  readonly dataDir: string;
  readonly productUserDataRoot: string;
  readonly source: LauncherDataRootSource;
  readonly legacyDataDir: string | null;
  readonly canonicalDataDir: string;
}

function platformOf(opts?: ProductDataPathOptions): NodeJS.Platform {
  return opts?.platform ?? process.platform;
}

function envOf(opts?: ProductDataPathOptions): NodeJS.ProcessEnv {
  return opts?.env ?? process.env;
}

function homeOf(opts?: ProductDataPathOptions): string {
  return opts?.homedir ?? osHomedir();
}

function exists(opts: ProductDataPathOptions | undefined, p: string): boolean {
  const fn = opts?.existsSync ?? fs.existsSync;
  try {
    return fn(p);
  } catch {
    return false;
  }
}

/** Product-level userData root (Electron userData equivalent). */
export function resolveProductUserDataRoot(opts?: ProductDataPathOptions): string {
  if (opts?.electronUserData?.trim()) {
    return path.resolve(opts.electronUserData.trim());
  }
  const home = homeOf(opts);
  const plat = platformOf(opts);
  const env = envOf(opts);
  if (plat === "win32") {
    const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, PRODUCT_USER_DATA_DIR_NAME);
  }
  if (plat === "darwin") {
    return path.join(home, "Library", "Application Support", PRODUCT_USER_DATA_DIR_NAME);
  }
  return path.join(home, ".local", "share", PRODUCT_USER_DATA_DIR_NAME);
}

/** Canonical managed data root: {productUserData}/launcher-data */
export function resolveCanonicalLauncherDataDir(opts?: ProductDataPathOptions): string {
  return path.join(resolveProductUserDataRoot(opts), LAUNCHER_DATA_DIR_NAME);
}

/** Legacy CLI data root (was itself the data dir). */
export function resolveLegacyLauncherDataDir(opts?: ProductDataPathOptions): string {
  const home = homeOf(opts);
  const plat = platformOf(opts);
  const env = envOf(opts);
  if (plat === "win32") {
    const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, LEGACY_CLI_DATA_DIR_NAME);
  }
  if (plat === "darwin") {
    return path.join(home, "Library", "Application Support", LEGACY_CLI_DATA_DIR_NAME);
  }
  return path.join(home, ".local", "share", LEGACY_CLI_DATA_DIR_NAME);
}

/**
 * Markers indicating the directory is an in-use launcher data root.
 * Kept conservative — presence of any known product file/dir.
 */
export function launcherDataDirHasProductMarkers(
  dataDir: string,
  opts?: ProductDataPathOptions
): boolean {
  const probes = [
    path.join(dataDir, "state", "accounts.json"),
    path.join(dataDir, "state", "anti-rollback.json"),
    path.join(dataDir, "settings.json"),
    path.join(dataDir, "secure"),
    path.join(dataDir, "instances"),
    path.join(dataDir, "runtime")
  ];
  return probes.some((p) => exists(opts, p));
}

/**
 * Soft migration: copy missing top-level entries from legacy → canonical.
 * - Never deletes legacy
 * - Never overwrites existing destination files/dirs
 * - No-op if destination already has product markers
 * - No-op if legacy empty
 */
export function migrateLegacyLauncherDataIfNeeded(
  opts?: ProductDataPathOptions
): {
  readonly migrated: boolean;
  readonly canonicalDataDir: string;
  readonly legacyDataDir: string;
  readonly copiedEntries: readonly string[];
} {
  const canonical = resolveCanonicalLauncherDataDir(opts);
  const legacy = resolveLegacyLauncherDataDir(opts);
  const copied: string[] = [];

  if (launcherDataDirHasProductMarkers(canonical, opts)) {
    return { migrated: false, canonicalDataDir: canonical, legacyDataDir: legacy, copiedEntries: copied };
  }
  if (!launcherDataDirHasProductMarkers(legacy, opts)) {
    return { migrated: false, canonicalDataDir: canonical, legacyDataDir: legacy, copiedEntries: copied };
  }

  // Use real fs for migration (tests can pre-seed dirs).
  fs.mkdirSync(canonical, { recursive: true });
  const entries = ["state", "secure", "instances", "runtime", "settings.json"];
  for (const name of entries) {
    const from = path.join(legacy, name);
    const to = path.join(canonical, name);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) continue;
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      fs.cpSync(from, to, { recursive: true, force: false });
      copied.push(name);
    } else if (st.isFile()) {
      fs.copyFileSync(from, to);
      copied.push(name);
    }
  }
  return {
    migrated: copied.length > 0,
    canonicalDataDir: canonical,
    legacyDataDir: legacy,
    copiedEntries: copied
  };
}

/**
 * Resolve the active launcher data root.
 * Precedence: explicit → env → canonical (after optional soft migration) → legacy fallback.
 */
export function resolveLauncherDataRoot(opts?: ProductDataPathOptions): ResolvedLauncherDataRoot {
  const productUserDataRoot = resolveProductUserDataRoot(opts);
  const canonicalDataDir = resolveCanonicalLauncherDataDir(opts);
  const legacyDataDir = resolveLegacyLauncherDataDir(opts);
  const allowLegacy = opts?.allowLegacyFallback !== false;

  const explicit = opts?.explicitDataDir?.trim();
  if (explicit) {
    return {
      dataDir: path.resolve(explicit),
      productUserDataRoot,
      source: "explicit",
      legacyDataDir,
      canonicalDataDir
    };
  }

  const envDir = envOf(opts)[ENV_LAUNCHER_DATA_DIR]?.trim();
  if (envDir) {
    return {
      dataDir: path.resolve(envDir),
      productUserDataRoot,
      source: "env",
      legacyDataDir,
      canonicalDataDir
    };
  }

  // Soft migrate legacy → canonical when safe.
  try {
    migrateLegacyLauncherDataIfNeeded(opts);
  } catch {
    // Migration failure must not crash path resolution — fall through.
  }

  if (launcherDataDirHasProductMarkers(canonicalDataDir, opts) || !allowLegacy) {
    return {
      dataDir: canonicalDataDir,
      productUserDataRoot,
      source: "canonical",
      legacyDataDir,
      canonicalDataDir
    };
  }

  if (allowLegacy && launcherDataDirHasProductMarkers(legacyDataDir, opts)) {
    return {
      dataDir: legacyDataDir,
      productUserDataRoot,
      source: "legacy-fallback",
      legacyDataDir,
      canonicalDataDir
    };
  }

  // Fresh install — prefer canonical even if empty.
  return {
    dataDir: canonicalDataDir,
    productUserDataRoot,
    source: "canonical",
    legacyDataDir,
    canonicalDataDir
  };
}

export function defaultInstanceRoot(dataDir: string): string {
  return path.join(dataDir, "instances", DEFAULT_INSTANCE_ID);
}

export function defaultRuntimeRoot(dataDir: string): string {
  return path.join(dataDir, "runtime");
}

export function defaultSecureStoreRoot(dataDir: string): string {
  return path.join(dataDir, "secure");
}

export function defaultLogsRoot(dataDir: string): string {
  return path.join(defaultInstanceRoot(dataDir), "logs");
}

export function defaultSettingsPath(dataDir: string): string {
  return path.join(dataDir, "settings.json");
}
