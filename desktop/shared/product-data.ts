/**
 * Product data path constants — keep in sync with src/instance/paths/productData.ts
 * (Desktop cannot import src/ at compile time; Electron userData already uses productName.)
 */
import path from "node:path";

export const PRODUCT_USER_DATA_DIR_NAME = "PaxCraft Launcher";
export const LAUNCHER_DATA_DIR_NAME = "launcher-data";
export const DEFAULT_INSTANCE_ID = "paxcraft";

/** {userData}/launcher-data */
export function launcherDataDirFromUserData(userData: string): string {
  return path.join(userData, LAUNCHER_DATA_DIR_NAME);
}

export function defaultInstancePathFromUserData(userData: string): string {
  return path.join(launcherDataDirFromUserData(userData), "instances", DEFAULT_INSTANCE_ID);
}

export function defaultRuntimePathFromUserData(userData: string): string {
  return path.join(launcherDataDirFromUserData(userData), "runtime");
}
