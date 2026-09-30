/**
 * Desktop SweetCraft instance path resolution (PACK-10.1G).
 * Mirrors src/instance/paths/instanceLocation.ts — Desktop cannot import src/ at compile time.
 */
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_INSTANCE_ID,
  LAUNCHER_DATA_DIR_NAME,
  launcherDataDirFromUserData
} from "./product-data.js";

export interface ResolvedDesktopInstancePaths {
  readonly dataDir: string;
  readonly instancePath: string;
  readonly logsPath: string;
  readonly legacyDefaultRoot: string;
  readonly isConfigured: boolean;
  readonly instanceAvailable: boolean;
  readonly locationUnavailable: boolean;
}

function defaultInstanceRoot(dataDir: string): string {
  return path.join(dataDir, "instances", DEFAULT_INSTANCE_ID);
}

export function resolveDesktopInstancePaths(
  userData: string,
  configuredInstancePath?: string | null
): ResolvedDesktopInstancePaths {
  const dataDir = launcherDataDirFromUserData(userData);
  const legacyDefaultRoot = path.resolve(defaultInstanceRoot(dataDir));
  const configured = configuredInstancePath?.trim();

  if (!configured) {
    const instancePath = legacyDefaultRoot;
    return {
      dataDir,
      instancePath,
      logsPath: path.join(instancePath, "logs"),
      legacyDefaultRoot,
      isConfigured: false,
      instanceAvailable: fs.existsSync(instancePath),
      locationUnavailable: false
    };
  }

  const instancePath = path.resolve(configured);
  let locationUnavailable = false;
  try {
    const parsed = path.parse(instancePath);
    fs.accessSync(parsed.root || instancePath);
  } catch {
    locationUnavailable = true;
  }

  return {
    dataDir,
    instancePath,
    logsPath: path.join(instancePath, "logs"),
    legacyDefaultRoot,
    isConfigured: true,
    instanceAvailable: !locationUnavailable && fs.existsSync(instancePath),
    locationUnavailable
  };
}

export { LAUNCHER_DATA_DIR_NAME, DEFAULT_INSTANCE_ID };
