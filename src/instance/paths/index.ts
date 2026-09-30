import path from "node:path";
import {
  resolveLauncherDataRoot,
  defaultInstanceRoot as instanceRootUnder,
  defaultRuntimeRoot as runtimeRootUnder,
  type ProductDataPathOptions
} from "./productData.js";

export {
  PRODUCT_USER_DATA_DIR_NAME,
  LAUNCHER_DATA_DIR_NAME,
  DEFAULT_INSTANCE_ID,
  LEGACY_CLI_DATA_DIR_NAME,
  ENV_LAUNCHER_DATA_DIR,
  resolveProductUserDataRoot,
  resolveCanonicalLauncherDataDir,
  resolveLegacyLauncherDataDir,
  resolveLauncherDataRoot,
  launcherDataDirHasProductMarkers,
  migrateLegacyLauncherDataIfNeeded,
  defaultSecureStoreRoot,
  defaultLogsRoot,
  defaultSettingsPath
} from "./productData.js";
export {
  resolveSweetCraftInstanceLocation,
  canonicalizeInstancePath,
  validateInstancePathCandidate,
  buildInstancePathGuardContext,
  classifyMigrationDestination,
  isInstanceVolumeAccessible,
  type ResolvedInstanceLocation,
  type InstanceLocationContext,
  type InstancePathGuardContext,
  type InstancePathValidationResult
} from "./instanceLocation.js";
export {
  classifyInstanceRootOwnership,
  hasSweetCraftOwnershipMarker,
  assertFreshInstallLocationAllowed,
  assertEmptyOrAbsentDestination,
  resolveCompleteUninstallDeleteMode,
  INSTANCE_STATE_RELATIVE,
  type InstanceRootOwnership,
  type CompleteUninstallDeleteMode
} from "../ownership/index.js";
export type { ProductDataPathOptions, ResolvedLauncherDataRoot, LauncherDataRootSource } from "./productData.js";

/**
 * Default launcher managed data directory (canonical product layout).
 * Windows: %APPDATA%\SweetCraft Launcher\launcher-data
 * Honors SWEETCRAFT_LAUNCHER_DATA_DIR and legacy fallback (see productData.ts).
 */
export function defaultLauncherDataDir(opts?: ProductDataPathOptions): string {
  return resolveLauncherDataRoot(opts).dataDir;
}

export function antiRollbackStatePath(dataDir: string = defaultLauncherDataDir()): string {
  return path.join(dataDir, "state", "anti-rollback.json");
}

export function accountsStatePath(dataDir: string = defaultLauncherDataDir()): string {
  return path.join(dataDir, "state", "accounts.json");
}

/** Default SweetCraft game instance root (isolated; never implicit .minecraft). */
export function defaultInstanceRoot(dataDir: string = defaultLauncherDataDir()): string {
  return instanceRootUnder(dataDir);
}

/** Default Minecraft/Fabric runtime cache root beside launcher data. */
export function defaultRuntimeRoot(dataDir: string = defaultLauncherDataDir()): string {
  return runtimeRootUnder(dataDir);
}
