import type { LaunchMemoryOptions } from "./memory.js";
import type { LaunchFeatures } from "./features.js";
import type { ArgfilePlan } from "./argfile.js";

/**
 * Immutable argv-based launch specification (logical).
 * Never treat a concatenated shell string as source of truth.
 * buildLaunchSpec does NOT write argfiles — see ArgfilePlan + materializeLaunchArguments.
 */
export interface LaunchSpec {
  readonly javaExecutable: string;
  readonly workingDirectory: string;
  readonly mainClass: string;
  readonly classpathEntries: readonly string[];
  readonly jvmArgs: readonly string[];
  readonly gameArgs: readonly string[];
  /**
   * Logical argv for Java (jvm + mainClass + game).
   * When argfilePlan is set, spawn must use materializeLaunchArguments() first;
   * do not assume this array is what gets passed to spawn verbatim in that case.
   */
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly nativesDirectory: string;
  readonly memory: LaunchMemoryOptions;
  readonly features: LaunchFeatures;
  readonly metadata: {
    readonly minecraftVersion: string;
    readonly fabricLoaderVersion: string;
    readonly versionType: string;
    readonly assetsIndexName: string;
    readonly launcherName: string;
    readonly launcherVersion: string;
  };
  /** When set, an argfile will be materialized immediately before spawn (not during prepare). */
  readonly argfilePlan?: ArgfilePlan;
}

export interface SanitizedLaunchSpec {
  javaExecutable: string;
  workingDirectory: string;
  mainClass: string;
  classpathEntries: string[];
  jvmArgs: string[];
  gameArgs: string[];
  argv: string[];
  environment: Record<string, string>;
  nativesDirectory: string;
  memory: LaunchMemoryOptions;
  features: LaunchFeatures;
  metadata: LaunchSpec["metadata"];
  /** Whether an argfile would be used at spawn — never includes path with secrets. */
  argfileRequired?: boolean;
}
