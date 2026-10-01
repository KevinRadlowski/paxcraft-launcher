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
  FOREIGN_SWEETCRAFT_USER_DATA_DIR_NAME,
  FOREIGN_SWEETCRAFT_LEGACY_CLI_DIR_NAME,
  ENV_LAUNCHER_DATA_DIR,
  LEGACY_SWEETCRAFT_ENV_LAUNCHER_DATA_DIR,
  ForeignSweetCraftDataPathError,
  resolveProductUserDataRoot,
  resolveCanonicalLauncherDataDir,
  resolveLegacyLauncherDataDir,
  resolveForeignSweetCraftRoots,
  resolveLauncherDataRoot,
  launcherDataDirHasProductMarkers,
  migrateLegacyLauncherDataIfNeeded,
  isUnderForeignSweetCraftRoot,
  assertNotForeignSweetCraftDataPath,
  foreignSweetCraftRootsBesideProductUserData,
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
 * Windows: %APPDATA%\PaxCraft Launcher\launcher-data
 * Honors PAXCRAFT_LAUNCHER_DATA_DIR only (see productData.ts). Never SweetCraft roots.
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

/** Default PaxCraft game instance root (isolated; never implicit .minecraft). */
export function defaultInstanceRoot(dataDir: string = defaultLauncherDataDir()): string {
  return instanceRootUnder(dataDir);
}

/** Default Minecraft/Fabric runtime cache root beside launcher data. */
export function defaultRuntimeRoot(dataDir: string = defaultLauncherDataDir()): string {
  return runtimeRootUnder(dataDir);
}
