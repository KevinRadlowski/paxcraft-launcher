/**
 * Canonical PaxCraft Launcher product data layout (PACK-PAX-04).
 * Shared by CLI and Desktop — no Electron imports.
 *
 * Windows product userData (Electron / CLI):
 *   %APPDATA%\PaxCraft Launcher
 * Launcher managed root:
 *   %APPDATA%\PaxCraft Launcher\launcher-data
 * Default instance:
 *   …/launcher-data/instances/paxcraft
 *
 * Foreign SweetCraft roots (NEVER probed, migrated, or accepted as data/instance roots):
 *   %APPDATA%\SweetCraft Launcher
 *   %APPDATA%\SweetCraftLauncher
 *
 * Env override: PAXCRAFT_LAUNCHER_DATA_DIR only.
 * SWEETCRAFT_LAUNCHER_DATA_DIR is intentionally ignored (no silent alias).
 */
import fs from "node:fs";
import path from "node:path";
import { homedir as osHomedir } from "node:os";

/** Electron productName / Windows AppData folder — keep in sync with desktop/shared/product-data.ts */
export const PRODUCT_USER_DATA_DIR_NAME = "PaxCraft Launcher";

/** Managed application data under product userData. */
export const LAUNCHER_DATA_DIR_NAME = "launcher-data";

/** Canonical default instance id. */
export const DEFAULT_INSTANCE_ID = "paxcraft";

/**
 * Historical SweetCraft folder names — foreign to Pax.
 * Retained as constants so rejection/tests stay explicit. Never used as active data roots.
 */
export const FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME = "SweetCraft Launcher";
export const FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME = "SweetCraftLauncher";

/** @deprecated PACK-PAX-04 — alias of FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME (not an active root). */
export const LEGACY_CLI_DATA_DIR_NAME = FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME;

/** Pax-only data-dir override. */
export const ENV_LAUNCHER_DATA_DIR = "PAXCRAFT_LAUNCHER_DATA_DIR";

/** Former SweetCraft env — must never alias into Pax resolution. */
export const LEGACY_SWEETCRAFT_ENV_LAUNCHER_DATA_DIR = "SWEETCRAFT_LAUNCHER_DATA_DIR";

export type LauncherDataRootSource = "explicit" | "env" | "canonical";

export interface ProductDataPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homedir?: string;
  /**
   * Electron app.getPath("userData") when available.
   * Must already be the Pax product userData root (…/PaxCraft Launcher).
   */
  readonly electronUserData?: string;
  /** Explicit override (CLI --data-dir). Highest precedence after foreign-root validation. */
  readonly explicitDataDir?: string;
  /**
   * @deprecated PACK-PAX-04 — ignored. Legacy SweetCraft fallback/migration removed.
   */
  readonly allowLegacyFallback?: boolean;
  /** Injected FS for tests. */
  readonly existsSync?: (p: string) => boolean;
  /** Injected realpath for junction tests. */
  readonly realpathSync?: (p: string) => string;
}

export interface ResolvedLauncherDataRoot {
  readonly dataDir: string;
  readonly productUserDataRoot: string;
  readonly source: LauncherDataRootSource;
  /** Always null under Pax isolation (no SweetCraft legacy root in active resolution). */
  readonly legacyDataDir: null;
  readonly canonicalDataDir: string;
}

export class ForeignSweetCraftDataPathError extends Error {
  readonly code = "FOREIGN_SWEETCRAFT_DATA_PATH" as const;
  constructor(message: string) {
    super(message);
    this.name = "ForeignSweetCraftDataPathError";
  }
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

function appDataRoot(opts?: ProductDataPathOptions): string {
  const home = homeOf(opts);
  const plat = platformOf(opts);
  const env = envOf(opts);
  if (plat === "win32") {
    return env.APPDATA ?? path.join(home, "AppData", "Roaming");
  }
  if (plat === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return path.join(home, ".local", "share");
}

/** Absolute foreign SweetCraft roots for the given options (product + legacy flat). */
export function resolveForeignSweetCraftRoots(opts?: ProductDataPathOptions): readonly string[] {
  const base = appDataRoot(opts);
  return [
    path.resolve(path.join(base, FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME)),
    path.resolve(path.join(base, FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME))
  ];
}

function tryRealpath(opts: ProductDataPathOptions | undefined, p: string): string {
  const resolved = path.resolve(p);
  const rp = opts?.realpathSync ?? fs.realpathSync;
  try {
    return path.resolve(rp(resolved));
  } catch {
    // Path may not exist yet — compare on lexical resolve only.
    return resolved;
  }
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const c = path.resolve(candidate);
  const r = path.resolve(root);
  if (c === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(prefix);
}

/**
 * True when candidate is inside a foreign SweetCraft root (lexical + realpath when possible).
 * When `foreignRoots` is omitted, roots are derived from opts APPDATA (resolveForeignSweetCraftRoots).
 */
export function isUnderForeignSweetCraftRoot(
  candidate: string,
  opts?: ProductDataPathOptions & { readonly foreignRoots?: readonly string[] }
): boolean {
  const lexical = path.resolve(candidate);
  const real = tryRealpath(opts, candidate);
  const roots = opts?.foreignRoots ?? resolveForeignSweetCraftRoots(opts);
  for (const foreign of roots) {
    const foreignReal = tryRealpath(opts, foreign);
    if (isPathInsideOrEqual(lexical, foreign) || isPathInsideOrEqual(real, foreign)) {
      return true;
    }
    if (isPathInsideOrEqual(lexical, foreignReal) || isPathInsideOrEqual(real, foreignReal)) {
      return true;
    }
  }
  return false;
}

/** Foreign SweetCraft roots sibling to a Pax product userData directory. */
export function foreignSweetCraftRootsBesideProductUserData(
  productUserDataRoot: string
): readonly string[] {
  const appData = path.dirname(path.resolve(productUserDataRoot));
  return [
    path.resolve(path.join(appData, FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME)),
    path.resolve(path.join(appData, FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME))
  ];
}

/** Throws ForeignSweetCraftDataPathError when candidate targets SweetCraft data roots. */
export function assertNotForeignSweetCraftDataPath(
  candidate: string,
  opts?: ProductDataPathOptions
): void {
  if (isUnderForeignSweetCraftRoot(candidate, opts)) {
    throw new ForeignSweetCraftDataPathError(
      "path targets foreign SweetCraft launcher data roots (refused)"
    );
  }
}

/** Product-level userData root (Electron userData equivalent). */
export function resolveProductUserDataRoot(opts?: ProductDataPathOptions): string {
  if (opts?.electronUserData?.trim()) {
    const root = path.resolve(opts.electronUserData.trim());
    assertNotForeignSweetCraftDataPath(root, opts);
    return root;
  }
  return path.join(appDataRoot(opts), PRODUCT_USER_DATA_DIR_NAME);
}

/** Canonical managed data root: {productUserData}/launcher-data */
export function resolveCanonicalLauncherDataDir(opts?: ProductDataPathOptions): string {
  return path.join(resolveProductUserDataRoot(opts), LAUNCHER_DATA_DIR_NAME);
}

/**
 * @deprecated PACK-PAX-04 — returns foreign SweetCraft legacy path for rejection tests only.
 * Never used as an active launcher data root.
 */
export function resolveLegacyLauncherDataDir(opts?: ProductDataPathOptions): string {
  return path.join(appDataRoot(opts), FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME);
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
 * @deprecated PACK-PAX-04 — no-op. Soft migration from SweetCraft roots is permanently disabled.
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
  return {
    migrated: false,
    canonicalDataDir: canonical,
    legacyDataDir: legacy,
    copiedEntries: []
  };
}

/**
 * Resolve the active Pax launcher data root.
 * Precedence: explicit → PAXCRAFT_LAUNCHER_DATA_DIR → canonical.
 * Never migrates or falls back to SweetCraft roots. Never reads SWEETCRAFT_LAUNCHER_DATA_DIR.
 */
export function resolveLauncherDataRoot(opts?: ProductDataPathOptions): ResolvedLauncherDataRoot {
  const productUserDataRoot = resolveProductUserDataRoot(opts);
  const canonicalDataDir = resolveCanonicalLauncherDataDir(opts);

  const explicit = opts?.explicitDataDir?.trim();
  if (explicit) {
    const dataDir = path.resolve(explicit);
    assertNotForeignSweetCraftDataPath(dataDir, opts);
    return {
      dataDir,
      productUserDataRoot,
      source: "explicit",
      legacyDataDir: null,
      canonicalDataDir
    };
  }

  const env = envOf(opts);
  const envDir = env[ENV_LAUNCHER_DATA_DIR]?.trim();
  if (envDir) {
    const dataDir = path.resolve(envDir);
    assertNotForeignSweetCraftDataPath(dataDir, opts);
    return {
      dataDir,
      productUserDataRoot,
      source: "env",
      legacyDataDir: null,
      canonicalDataDir
    };
  }

  // Intentionally ignore LEGACY_SWEETCRAFT_ENV_LAUNCHER_DATA_DIR.
  // Intentionally do not call migrateLegacyLauncherDataIfNeeded / legacy-fallback.

  return {
    dataDir: canonicalDataDir,
    productUserDataRoot,
    source: "canonical",
    legacyDataDir: null,
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
