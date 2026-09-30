/**
 * Explicit Desktop resource path resolution (PACK-02).
 * Pure helpers — no Electron imports; callers inject appPath / resourcesPath.
 */
import path from "node:path";

export interface DesktopResourcePathInput {
  /** app.isPackaged */
  readonly isPackaged: boolean;
  /** app.getAppPath() — repo root (dev) or app.asar (packaged) */
  readonly appPath: string;
  /** process.resourcesPath — used for extraResources when packaged */
  readonly resourcesPath: string;
}

export interface DesktopResourcePaths {
  readonly distRoot: string;
  readonly preloadPath: string;
  readonly rendererIndexHtml: string;
  readonly trustedKeysPath: string;
  /** Where trusted keys are expected from */
  readonly trustedKeysSource: "resources" | "app";
}

/**
 * Resolve production Desktop resource paths.
 * Packaged trusted keys: process.resourcesPath/config/trusted-keys.json (extraResources).
 * Core/UI/preload: under app.getAppPath() (asar or repo root).
 */
export function resolveDesktopResourcePaths(input: DesktopResourcePathInput): DesktopResourcePaths {
  const appPath = path.resolve(input.appPath);
  const resourcesPath = path.resolve(input.resourcesPath);

  const trustedKeysSource = input.isPackaged ? "resources" : "app";
  const trustedKeysPath = input.isPackaged
    ? path.join(resourcesPath, "config", "trusted-keys.json")
    : path.join(appPath, "config", "trusted-keys.json");

  return Object.freeze({
    distRoot: path.join(appPath, "dist"),
    preloadPath: path.join(appPath, "dist-desktop", "preload", "preload.cjs"),
    rendererIndexHtml: path.join(
      appPath,
      "ui",
      "dist",
      "sweetcraft-launcher-ui",
      "browser",
      "index.html"
    ),
    trustedKeysPath,
    trustedKeysSource
  });
}

/** Safe labels for diagnostics — never absolute user paths. */
export function describeDesktopResourcePaths(paths: DesktopResourcePaths): {
  trustedKeysSource: "resources" | "app";
  trustedKeysBasename: string;
  distRelativeHint: string;
  rendererRelativeHint: string;
  preloadRelativeHint: string;
} {
  return {
    trustedKeysSource: paths.trustedKeysSource,
    trustedKeysBasename: "trusted-keys.json",
    distRelativeHint: "dist/",
    rendererRelativeHint: "ui/dist/sweetcraft-launcher-ui/browser/index.html",
    preloadRelativeHint: "dist-desktop/preload/preload.cjs"
  };
}
