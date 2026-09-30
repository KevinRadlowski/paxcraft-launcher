import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { ErrorCode, LauncherError } from "../core/errors/index.js";
import type { ResolvedMinecraftRuntime } from "../minecraft/fabric/index.js";
import type { RuntimePaths } from "../minecraft/runtime/paths.js";
import type { PlatformInfo } from "../platform/index.js";

export interface ClasspathBuildResult {
  entries: string[];
  classpathString: string;
  separator: string;
}

/**
 * Deterministic classpath: libraries (resolved order) then client jar.
 * Every entry must exist under runtime roots.
 */
export async function buildClasspath(opts: {
  runtime: ResolvedMinecraftRuntime;
  paths: RuntimePaths;
  platform: PlatformInfo;
  /** When false, skip existence checks (unit tests of ordering only). Default true. */
  requireFilesExist?: boolean;
}): Promise<ClasspathBuildResult> {
  const separator = opts.platform.os === "windows" ? ";" : ":";
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const lib of opts.runtime.libraries) {
    if (lib.kind === "native") continue; // natives are extracted, not on classpath
    const abs = opts.paths.libraryFile(lib.path);
    assertUnderRoot(abs, opts.paths.root, "library");
    const key = path.normalize(abs).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (opts.requireFilesExist !== false) {
      await assertExists(abs);
    }
    entries.push(abs);
  }

  const clientJar = opts.paths.versionJar(opts.runtime.minecraftVersion);
  assertUnderRoot(clientJar, opts.paths.root, "client");
  const clientKey = path.normalize(clientJar).toLowerCase();
  if (!seen.has(clientKey)) {
    if (opts.requireFilesExist !== false) {
      await assertExists(clientJar);
    }
    entries.push(clientJar);
  }

  return {
    entries,
    classpathString: entries.join(separator),
    separator
  };
}

function assertUnderRoot(abs: string, root: string, kind: string): void {
  const resolved = path.resolve(abs);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new LauncherError(ErrorCode.CLASSPATH_ENTRY_UNSAFE, `classpath ${kind} outside runtime root`, {
      path: abs,
      root
    });
  }
}

async function assertExists(abs: string): Promise<void> {
  try {
    await access(abs, fsConstants.F_OK);
  } catch {
    throw new LauncherError(ErrorCode.CLASSPATH_ENTRY_MISSING, "classpath entry missing", { path: abs });
  }
}

export function validateMainClass(mainClass: string): string {
  if (typeof mainClass !== "string" || !mainClass.trim()) {
    throw new LauncherError(ErrorCode.INVALID_MAIN_CLASS, "mainClass empty");
  }
  if (/[\x00-\x1f\s]/.test(mainClass)) {
    throw new LauncherError(ErrorCode.INVALID_MAIN_CLASS, "mainClass contains whitespace/control chars");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(mainClass) && mainClass !== "Main") {
    // Allow simple Main for tests; require dotted FQCN otherwise
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(mainClass)) {
      throw new LauncherError(ErrorCode.INVALID_MAIN_CLASS, "mainClass malformed", { mainClass });
    }
  }
  return mainClass;
}
