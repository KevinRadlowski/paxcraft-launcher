import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { ErrorCode, LauncherError } from "../core/errors/index.js";
import { LAUNCHER_VERSION, PRODUCT_NAME } from "../version.js";
import type { ResolvedMinecraftRuntime } from "../minecraft/fabric/index.js";
import type { RuntimePaths } from "../minecraft/runtime/paths.js";
import type { PlatformInfo } from "../platform/index.js";
import type { DiscoveredJava } from "../java/requirements/index.js";
import { isJavaCompatible, pickCompatibleJava } from "../java/requirements/index.js";
import { validateLaunchIdentity, type LaunchIdentity } from "./identity.js";
import { mergeLaunchFeatures, type LaunchFeatures } from "./features.js";
import { isHeapMemoryJvmArg, memoryJvmArgs, validateLaunchMemory, type LaunchMemoryOptions } from "./memory.js";
import { refuseLegacyMinecraftArguments, resolveModernArguments } from "./arguments.js";
import { buildClasspath, validateMainClass } from "./classpath.js";
import type { LaunchSpec } from "./types.js";
import type { PlaceholderValues } from "./placeholders.js";
import type { ArgfilePlan } from "./argfile.js";

/** Windows CreateProcess practical cmdline limit; above this we plan an @argfile. */
export const WINDOWS_ARGV_SOFT_LIMIT = 30_000;

export interface BuildLaunchSpecOptions {
  runtime: ResolvedMinecraftRuntime;
  paths: RuntimePaths;
  /** Isolated SweetCraft instance root (= gameDirectory). */
  instanceRoot: string;
  platform: PlatformInfo;
  java: DiscoveredJava;
  identity: LaunchIdentity;
  memory: LaunchMemoryOptions;
  features?: Partial<LaunchFeatures>;
  resolution?: { width: number; height: number };
  environment?: Record<string, string>;
  /** Extra launcher-controlled JVM args (after memory, before metadata). Heap flags stripped. */
  extraJvmArgs?: string[];
  launcherName?: string;
  launcherVersion?: string;
  /** Force argfile plan even under limit (tests). Does NOT write the file. */
  forceArgfile?: boolean;
  /** Skip classpath file existence (ordering-only tests). */
  requireClasspathFiles?: boolean;
}

/**
 * Build logical LaunchSpec only — no filesystem mutation except existence probes.
 * Argfile is planned (ArgfilePlan) but never written here.
 */
export async function buildLaunchSpec(opts: BuildLaunchSpecOptions): Promise<LaunchSpec> {
  const identity = validateLaunchIdentity(opts.identity);
  const memory = validateLaunchMemory(opts.memory);
  const features = mergeLaunchFeatures(opts.features);
  const mainClass = validateMainClass(opts.runtime.mainClass);

  refuseLegacyMinecraftArguments(opts.runtime.minecraftArguments);
  if (!opts.runtime.arguments) {
    throw new LauncherError(
      ErrorCode.UNSUPPORTED_LAUNCH_METADATA,
      "modern arguments.jvm/game required"
    );
  }

  if (opts.runtime.javaRequirement) {
    if (!isJavaCompatible(opts.java, opts.runtime.javaRequirement)) {
      pickCompatibleJava([opts.java], opts.runtime.javaRequirement);
    }
  }

  await assertLocalJavaExecutable(opts.java.javaPath);

  const instanceRoot = path.resolve(opts.instanceRoot);
  if (!instanceRoot.trim()) {
    throw new LauncherError(ErrorCode.INSTANCE_ROOT_REQUIRED, "instanceRoot required");
  }

  const nativesDirectory = opts.paths.nativesDir(
    opts.runtime.minecraftVersion,
    opts.runtime.fabricLoaderVersion
  );
  assertUnderRoot(nativesDirectory, opts.paths.root);

  const cp = await buildClasspath({
    runtime: opts.runtime,
    paths: opts.paths,
    platform: opts.platform,
    requireFilesExist: opts.requireClasspathFiles !== false
  });

  if (features.has_custom_resolution) {
    validateResolution(opts.resolution);
  }

  const launcherName = opts.launcherName ?? PRODUCT_NAME;
  const launcherVersion = opts.launcherVersion ?? LAUNCHER_VERSION;

  const placeholders = buildPlaceholderValues({
    identity,
    runtime: opts.runtime,
    instanceRoot,
    assetsRoot: opts.paths.assetsDir(),
    nativesDirectory,
    libraryDirectory: opts.paths.librariesDir(),
    classpath: cp.classpathString,
    classpathSeparator: cp.separator,
    launcherName,
    launcherVersion,
    ...(features.has_custom_resolution && opts.resolution
      ? { resolution: opts.resolution }
      : {})
  });

  const metaJvm = resolveModernArguments(opts.runtime.arguments?.jvm, {
    platform: opts.platform,
    features,
    placeholders,
    kind: "jvm"
  }).filter((a) => !isHeapMemoryJvmArg(a));

  const metaGame = resolveModernArguments(opts.runtime.arguments?.game, {
    platform: opts.platform,
    features,
    placeholders,
    kind: "game"
  });

  // Launcher memory wins: strip heap flags from extraJvmArgs too.
  const extra = (opts.extraJvmArgs ?? []).filter((a) => !isHeapMemoryJvmArg(a));

  const jvmArgs = [...memoryJvmArgs(memory), ...extra, ...metaJvm];
  const gameArgs = metaGame;
  const logicalArgv = Object.freeze([...jvmArgs, mainClass, ...gameArgs]);

  const useArgfile =
    opts.forceArgfile === true ||
    (opts.platform.os === "windows" &&
      estimateArgvLength(opts.java.javaPath, jvmArgs, mainClass, gameArgs) >
        WINDOWS_ARGV_SOFT_LIMIT);

  let argfilePlan: ArgfilePlan | undefined;
  if (useArgfile) {
    argfilePlan = Object.freeze({
      required: true as const,
      tmpRoot: opts.paths.tmpDir(),
      runtimeRoot: opts.paths.root,
      lines: Object.freeze([...logicalArgv])
    });
  }

  const environment: Record<string, string> = { ...(opts.environment ?? {}) };

  return Object.freeze({
    javaExecutable: opts.java.javaPath,
    workingDirectory: instanceRoot,
    mainClass,
    classpathEntries: Object.freeze([...cp.entries]),
    jvmArgs: Object.freeze(jvmArgs),
    gameArgs: Object.freeze(gameArgs),
    argv: logicalArgv,
    environment: Object.freeze(environment),
    nativesDirectory,
    memory,
    features,
    metadata: Object.freeze({
      minecraftVersion: opts.runtime.minecraftVersion,
      fabricLoaderVersion: opts.runtime.fabricLoaderVersion,
      versionType: opts.runtime.versionType,
      assetsIndexName: opts.runtime.assetIndex.id,
      launcherName,
      launcherVersion
    }),
    ...(argfilePlan ? { argfilePlan } : {})
  });
}

export { escapeJavaArgfileLine } from "./argfileEscape.js";

function buildPlaceholderValues(opts: {
  identity: LaunchIdentity;
  runtime: ResolvedMinecraftRuntime;
  instanceRoot: string;
  assetsRoot: string;
  nativesDirectory: string;
  libraryDirectory: string;
  classpath: string;
  classpathSeparator: string;
  launcherName: string;
  launcherVersion: string;
  resolution?: { width: number; height: number };
}): PlaceholderValues {
  const userProps = JSON.stringify(opts.identity.userProperties ?? {});
  const profileProps = JSON.stringify(opts.identity.profileProperties ?? {});
  return {
    auth_player_name: opts.identity.username,
    version_name: opts.runtime.minecraftVersion,
    game_directory: opts.instanceRoot,
    assets_root: opts.assetsRoot,
    assets_index_name: opts.runtime.assetIndex.id,
    auth_uuid: opts.identity.uuid,
    auth_access_token: opts.identity.accessToken,
    user_type: opts.identity.userType,
    version_type: opts.runtime.versionType,
    natives_directory: opts.nativesDirectory,
    launcher_name: opts.launcherName,
    launcher_version: opts.launcherVersion,
    classpath: opts.classpath,
    classpath_separator: opts.classpathSeparator,
    library_directory: opts.libraryDirectory,
    user_properties: userProps,
    profile_properties: profileProps,
    resolution_width: opts.resolution ? String(opts.resolution.width) : "0",
    resolution_height: opts.resolution ? String(opts.resolution.height) : "0",
    clientid: opts.identity.clientId ?? "",
    auth_xuid: opts.identity.xuid ?? ""
  };
}

function validateResolution(res: { width: number; height: number } | undefined): void {
  if (!res) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_RESOLUTION, "custom resolution required when feature enabled");
  }
  for (const [field, value] of [
    ["width", res.width],
    ["height", res.height]
  ] as const) {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 320 ||
      value > 7680
    ) {
      throw new LauncherError(ErrorCode.INVALID_LAUNCH_RESOLUTION, `invalid ${field}`, { field, value });
    }
  }
}

async function assertLocalJavaExecutable(javaPath: string): Promise<void> {
  if (!javaPath || javaPath.includes("://") || javaPath.startsWith("//")) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_SPEC, "javaExecutable must be a local path");
  }
  try {
    await access(javaPath, fsConstants.F_OK);
  } catch {
    throw new LauncherError(ErrorCode.MISSING_JAVA, "java executable not found", { javaPath });
  }
}

function assertUnderRoot(abs: string, root: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "path escapes runtime root", { abs, root });
  }
}

function estimateArgvLength(
  java: string,
  jvmArgs: string[],
  mainClass: string,
  gameArgs: string[]
): number {
  return [java, ...jvmArgs, mainClass, ...gameArgs].join(" ").length;
}
