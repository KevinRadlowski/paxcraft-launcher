/**
 * PACK-10.1G — authoritative SweetCraft instance location resolution.
 * Single source of truth: persisted sweetcraftInstancePath in settings,
 * with legacy default fallback when unset.
 */
import fs from "node:fs";
import path from "node:path";
import {
  defaultInstanceRoot,
  defaultRuntimeRoot,
  defaultSecureStoreRoot,
  foreignSweetCraftRootsBesideProductUserData,
  isUnderForeignSweetCraftRoot,
  LAUNCHER_DATA_DIR_NAME
} from "./productData.js";

export interface InstanceLocationContext {
  readonly launcherDataRoot: string;
  readonly productUserDataRoot: string;
  /** Persisted configured instance root — null/undefined = use legacy default. */
  readonly configuredInstancePath?: string | null;
  readonly existsSync?: (p: string) => boolean;
  readonly accessSync?: (p: string) => void;
}

export interface ResolvedInstanceLocation {
  /** Authoritative absolute instance root used by install/play/uninstall. */
  readonly instanceRoot: string;
  /** Legacy canonical default under launcher-data. */
  readonly legacyDefaultRoot: string;
  readonly isConfigured: boolean;
  /** True when the resolved root directory exists on disk. */
  readonly instanceAvailable: boolean;
  /**
   * True when a configured path is set but its volume/parent is not reachable.
   * Does not fall back to legacy default.
   */
  readonly locationUnavailable: boolean;
}

function exists(ctx: InstanceLocationContext, p: string): boolean {
  const fn = ctx.existsSync ?? fs.existsSync;
  try {
    return fn(p);
  } catch {
    return false;
  }
}

/** Normalize to absolute path with platform separators; reject relative/empty/. /.. */
export function canonicalizeInstancePath(raw: string): string {
  if (typeof raw !== "string") {
    throw new Error("instance path must be a string");
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error("instance path is empty or relative");
  }
  if (trimmed.includes("\0")) {
    throw new Error("instance path contains null byte");
  }
  if (!path.isAbsolute(trimmed) && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new Error("instance path is relative");
  }
  const resolved = path.resolve(trimmed);
  const segments = resolved.split(path.sep);
  if (segments.some((s) => s === "..")) {
    throw new Error("instance path escapes with parent segments");
  }
  return resolved;
}

/** Check whether the volume containing candidate is reachable (Windows drive letter). */
export function isInstanceVolumeAccessible(
  candidate: string,
  accessSync: (p: string) => void = fs.accessSync
): boolean {
  const parsed = path.parse(candidate);
  const probe = parsed.root || candidate;
  try {
    accessSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the authoritative SweetCraft instance root.
 * Missing setting → default {launcher-data}/instances/paxcraft.
 */
export function resolveSweetCraftInstanceLocation(
  ctx: InstanceLocationContext
): ResolvedInstanceLocation {
  const launcherDataRoot = path.resolve(ctx.launcherDataRoot);
  const legacyDefaultRoot = path.resolve(defaultInstanceRoot(launcherDataRoot));
  const configured = ctx.configuredInstancePath?.trim();

  if (!configured) {
    return {
      instanceRoot: legacyDefaultRoot,
      legacyDefaultRoot,
      isConfigured: false,
      instanceAvailable: exists(ctx, legacyDefaultRoot),
      locationUnavailable: false
    };
  }

  const instanceRoot = canonicalizeInstancePath(configured);
  const volumeOk = isInstanceVolumeAccessible(instanceRoot, ctx.accessSync);
  const instanceAvailable = volumeOk && exists(ctx, instanceRoot);

  return {
    instanceRoot,
    legacyDefaultRoot,
    isConfigured: true,
    instanceAvailable,
    locationUnavailable: !volumeOk
  };
}

export interface InstancePathGuardContext {
  readonly launcherDataRoot: string;
  readonly productUserDataRoot: string;
  readonly runtimeRoot: string;
  readonly secureRoot: string;
  /** Electron app.getAppPath() when available — launcher application directory. */
  readonly applicationDirectory?: string;
}

export function buildInstancePathGuardContext(
  launcherDataRoot: string,
  productUserDataRoot: string,
  applicationDirectory?: string
): InstancePathGuardContext {
  const dataDir = path.resolve(launcherDataRoot);
  return {
    launcherDataRoot: dataDir,
    productUserDataRoot: path.resolve(productUserDataRoot),
    runtimeRoot: path.resolve(defaultRuntimeRoot(dataDir)),
    secureRoot: path.resolve(defaultSecureStoreRoot(dataDir)),
    ...(applicationDirectory ? { applicationDirectory: path.resolve(applicationDirectory) } : {})
  };
}

function isFilesystemRoot(candidate: string): boolean {
  const parsed = path.parse(candidate);
  return candidate === parsed.root || parsed.root === candidate;
}

function isDriveRoot(candidate: string): boolean {
  const parsed = path.parse(candidate);
  return candidate === parsed.root && /^[A-Za-z]:\\?$/.test(parsed.root);
}

const WINDOWS_DIR_NAMES = new Set(["windows", "program files", "program files (x86)"]);

function isWindowsSystemDirectory(candidate: string): boolean {
  if (process.platform !== "win32") return false;
  const parts = path.normalize(candidate).split(path.sep).filter(Boolean);
  if (parts.length === 0) return false;
  const first = parts[0]!.toLowerCase();
  if (first.endsWith(":")) {
    return parts.length === 1;
  }
  return WINDOWS_DIR_NAMES.has(parts[0]!.toLowerCase());
}

function pathsOverlap(a: string, b: string): boolean {
  const rel = path.relative(a, b);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type InstancePathValidationFailure =
  | "EMPTY"
  | "RELATIVE"
  | "FILESYSTEM_ROOT"
  | "DRIVE_ROOT"
  | "LAUNCHER_DATA_ROOT"
  | "RUNTIME_ROOT"
  | "SECURE_ROOT"
  | "STATE_ROOT"
  | "INSTANCES_ROOT"
  | "PRODUCT_USER_DATA_ROOT"
  | "APPLICATION_DIRECTORY"
  | "WINDOWS_SYSTEM"
  | "OVERLAP_SOURCE"
  | "OVERLAP_DESTINATION"
  | "SAME_PATH"
  | "FOREIGN_SWEETCRAFT_DATA_ROOT";

export interface InstancePathValidationResult {
  readonly ok: boolean;
  readonly canonicalPath?: string;
  readonly reason?: InstancePathValidationFailure;
}

export function legacyDefaultInstanceRoot(launcherDataRoot: string): string {
  return path.resolve(defaultInstanceRoot(launcherDataRoot));
}

function isLegacyDefaultInstancePath(canonical: string, guard: InstancePathGuardContext): boolean {
  return canonical === legacyDefaultInstanceRoot(guard.launcherDataRoot);
}

/**
 * Validate a candidate instance root for fresh install or migration destination.
 */
export function validateInstancePathCandidate(
  raw: string,
  guard: InstancePathGuardContext,
  opts?: { sourceRoot?: string }
): InstancePathValidationResult {
  let canonical: string;
  try {
    canonical = canonicalizeInstancePath(raw);
  } catch {
    return { ok: false, reason: "RELATIVE" };
  }

  if (isFilesystemRoot(canonical) || isDriveRoot(canonical)) {
    return { ok: false, reason: "DRIVE_ROOT" };
  }
  if (isWindowsSystemDirectory(canonical)) {
    return { ok: false, reason: "WINDOWS_SYSTEM" };
  }

  // PACK-PAX-04 — refuse instance paths under foreign SweetCraft APPDATA roots (incl. junctions).
  // Roots are siblings of this product's userData (hermetic under injected test APPDATA).
  if (
    isUnderForeignSweetCraftRoot(canonical, {
      foreignRoots: foreignSweetCraftRootsBesideProductUserData(guard.productUserDataRoot)
    })
  ) {
    return { ok: false, reason: "FOREIGN_SWEETCRAFT_DATA_ROOT" };
  }

  const forbiddenExact: { path: string; reason: InstancePathValidationFailure }[] = [
    { path: guard.launcherDataRoot, reason: "LAUNCHER_DATA_ROOT" },
    { path: guard.runtimeRoot, reason: "RUNTIME_ROOT" },
    { path: guard.secureRoot, reason: "SECURE_ROOT" },
    { path: path.join(guard.launcherDataRoot, "state"), reason: "STATE_ROOT" },
    { path: path.join(guard.launcherDataRoot, "instances"), reason: "INSTANCES_ROOT" },
    { path: guard.productUserDataRoot, reason: "PRODUCT_USER_DATA_ROOT" }
  ];
  if (guard.applicationDirectory) {
    forbiddenExact.push({ path: guard.applicationDirectory, reason: "APPLICATION_DIRECTORY" });
  }

  for (const { path: forbiddenPath, reason } of forbiddenExact) {
    if (canonical === path.resolve(forbiddenPath)) {
      return { ok: false, reason };
    }
  }

  const sensitiveParents = [
    { path: guard.runtimeRoot, reason: "RUNTIME_ROOT" as const },
    { path: guard.secureRoot, reason: "SECURE_ROOT" as const },
    { path: path.join(guard.launcherDataRoot, "state"), reason: "STATE_ROOT" as const }
  ];
  for (const { path: parent, reason } of sensitiveParents) {
    const resolved = path.resolve(parent);
    if (pathsOverlap(resolved, canonical) && canonical !== resolved) {
      return { ok: false, reason };
    }
  }

  if (
    pathsOverlap(path.resolve(guard.launcherDataRoot), canonical) &&
    !isLegacyDefaultInstancePath(canonical, guard)
  ) {
    return { ok: false, reason: "LAUNCHER_DATA_ROOT" };
  }

  const sourceRoot = opts?.sourceRoot?.trim();
  if (sourceRoot) {
    const source = path.resolve(sourceRoot);
    if (canonical === source) {
      return { ok: false, reason: "SAME_PATH" };
    }
    if (pathsOverlap(source, canonical)) {
      return { ok: false, reason: "OVERLAP_DESTINATION" };
    }
    if (pathsOverlap(canonical, source)) {
      return { ok: false, reason: "OVERLAP_SOURCE" };
    }
  }

  return { ok: true, canonicalPath: canonical };
}

/** Classify destination directory for migration — aligned with ownership module. */
export type DestinationClassification =
  | "MISSING"
  | "EMPTY"
  | "NONEMPTY_UNRELATED"
  | "EXISTING_INSTANCE";

export function classifyMigrationDestination(
  destination: string,
  existsSync: (p: string) => boolean = fs.existsSync
): DestinationClassification {
  // Lazy import avoided — inline ownership check to keep single module for desktop mirror.
  if (!existsSync(destination)) return "MISSING";
  try {
    const entries = fs.readdirSync(destination);
    if (entries.length === 0) return "EMPTY";
    const statePath = path.join(destination, "launcher", "state.json");
    if (existsSync(statePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as unknown;
        if (
          typeof raw === "object" &&
          raw !== null &&
          !Array.isArray(raw) &&
          (raw as Record<string, unknown>).schemaVersion === 1
        ) {
          return "EXISTING_INSTANCE";
        }
      } catch {
        // fall through
      }
    }
    return "NONEMPTY_UNRELATED";
  } catch {
    return "NONEMPTY_UNRELATED";
  }
}

export { LAUNCHER_DATA_DIR_NAME };
