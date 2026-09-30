import { ErrorCode, LauncherError } from "../errors/index.js";

function rejectAbsoluteOrTraversal(pathValue: string, label: string): void {
  if (typeof pathValue !== "string" || !pathValue) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `${label} empty`, { path: pathValue });
  }
  if (pathValue.includes("\\") || pathValue.includes("\0") || pathValue.includes("\r") || pathValue.includes("\n")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `${label} contains forbidden characters`, { path: pathValue });
  }
  if (pathValue.startsWith("/") || /^[a-zA-Z]:/.test(pathValue) || pathValue.startsWith("//")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `${label} absolute path refused`, { path: pathValue });
  }
  const parts = pathValue.split("/");
  if (parts.some((p) => p === ".." || p === "" || p === ".")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `${label} path traversal refused`, { path: pathValue });
  }
}

/** CDN-relative release.json path: releases/<packVersion>/release.json */
export function assertSafeReleasePath(releasePath: string, expectedPackVersion?: string): void {
  rejectAbsoluteOrTraversal(releasePath, "releasePath");
  if (releasePath.includes("..")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `path traversal refused: ${releasePath}`, { path: releasePath });
  }
  const m = /^releases\/([^/]+)\/release\.json$/.exec(releasePath);
  if (!m) {
    throw new LauncherError(
      ErrorCode.UNSAFE_PATH,
      `releasePath must match releases/<packVersion>/release.json (got: ${releasePath})`,
      { path: releasePath }
    );
  }
  if (expectedPackVersion !== undefined && m[1] !== expectedPackVersion) {
    throw new LauncherError(
      ErrorCode.UNSAFE_PATH,
      `releasePath packVersion=${m[1]} != expected ${expectedPackVersion}`,
      { path: releasePath, expectedPackVersion }
    );
  }
}

export function assertSafeConfigPath(configPath: string): void {
  rejectAbsoluteOrTraversal(configPath, "config path");
  if (!configPath.startsWith("config/")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `config path must start with config/: ${configPath}`, {
      path: configPath
    });
  }
}

export function assertSafeResourcePackTargetPath(targetPath: string): void {
  rejectAbsoluteOrTraversal(targetPath, "resource pack targetPath");
  if (!targetPath.startsWith("resourcepacks/")) {
    throw new LauncherError(
      ErrorCode.UNSAFE_PATH,
      `targetPath must start with resourcepacks/: ${targetPath}`,
      { path: targetPath }
    );
  }
  if (!targetPath.toLowerCase().endsWith(".zip")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `targetPath must end with .zip: ${targetPath}`, {
      path: targetPath
    });
  }
}

export function assertSafeResourcePackId(id: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `invalid resource pack id: ${id}`, { id });
  }
}

/** Artefact paths inside a release directory (basename only, no directories). */
export function assertSafeReleaseArtefactPath(artefactPath: string, expectedBasename: string): void {
  rejectAbsoluteOrTraversal(artefactPath, "artefact path");
  if (artefactPath !== expectedBasename) {
    throw new LauncherError(
      ErrorCode.UNSAFE_PATH,
      `artefact path must be exactly ${expectedBasename}, got ${artefactPath}`,
      { path: artefactPath, expectedBasename }
    );
  }
}
