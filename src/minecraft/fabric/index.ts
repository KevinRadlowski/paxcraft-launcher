import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  assertSafeLibraryPath,
  parseVersionMeta,
  type MinecraftLibrary,
  type MinecraftVersionMeta
} from "../metadata/types.js";
import { resolveVersionInheritance, type VersionMetaFetcher } from "../version/index.js";
import type { ResolvedMinecraftVersion } from "../metadata/types.js";
import type { PlatformInfo } from "../../platform/index.js";
import { resolveLibrariesForPlatform, type ResolvedLibraryArtifact } from "../libraries/index.js";

export interface FabricLoaderVersion {
  loader: { version: string; stable?: boolean };
  intermediary?: { version: string };
}

export interface FabricResolvedProfile {
  minecraftVersion: string;
  fabricLoaderVersion: string;
  mainClass: string;
  libraries: MinecraftLibrary[];
  /** Fabric version JSON id typically like "fabric-loader-0.19.3-26.1.2" */
  id: string;
  raw: MinecraftVersionMeta;
}

/**
 * Resolve exact Fabric loader for an exact Minecraft version.
 * Never selects "latest".
 */
export function selectExactFabricLoader(
  loaders: FabricLoaderVersion[],
  fabricLoaderVersion: string
): FabricLoaderVersion {
  const found = loaders.find((l) => l.loader?.version === fabricLoaderVersion);
  if (!found) {
    throw new LauncherError(ErrorCode.FABRIC_LOADER_NOT_FOUND, `Fabric loader not found: ${fabricLoaderVersion}`, {
      fabricLoaderVersion
    });
  }
  return found;
}

export function parseFabricLoaderList(raw: unknown): FabricLoaderVersion[] {
  if (!Array.isArray(raw)) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "fabric loader list must be array");
  }
  const out: FabricLoaderVersion[] = [];
  for (const item of raw) {
    if (!isObj(item) || !isObj(item.loader) || typeof item.loader.version !== "string") {
      throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "invalid fabric loader entry");
    }
    const entry: FabricLoaderVersion = {
      loader: { version: item.loader.version }
    };
    if (typeof item.loader.stable === "boolean") entry.loader.stable = item.loader.stable;
    if (isObj(item.intermediary) && typeof item.intermediary.version === "string") {
      entry.intermediary = { version: item.intermediary.version };
    }
    out.push(entry);
  }
  return out;
}

export function parseFabricProfile(raw: unknown): FabricResolvedProfile {
  const meta = parseVersionMeta(raw);
  if (!meta.mainClass) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "fabric profile missing mainClass");
  }
  // Fabric profile id format: fabric-loader-<loader>-<mc>
  const m = /^fabric-loader-(.+)-(.+)$/.exec(meta.id);
  if (!m) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "unexpected fabric profile id", {
      id: meta.id
    });
  }
  return {
    id: meta.id,
    fabricLoaderVersion: m[1]!,
    minecraftVersion: m[2]!,
    mainClass: meta.mainClass,
    libraries: meta.libraries ?? [],
    raw: meta
  };
}

export interface ResolvedMinecraftRuntime {
  minecraftVersion: string;
  fabricLoaderVersion: string;
  mainClass: string;
  clientJar: ResolvedMinecraftVersion["client"];
  assetIndex: ResolvedMinecraftVersion["assetIndex"];
  libraries: ResolvedLibraryArtifact[];
  javaRequirement: { majorVersion: number; component?: string } | null;
  inheritanceChain: string[];
  fabricProfileId: string;
  /** Modern launch arguments: Fabric overlays vanilla per-key (jvm/game), never wholesale. */
  arguments?: {
    game?: unknown[];
    jvm?: unknown[];
  };
  /** Legacy string — Launch Engine refuses this with UNSUPPORTED_LAUNCH_METADATA. */
  minecraftArguments?: string;
  versionType: string;
}

/**
 * Merge vanilla resolved version + fabric profile libraries.
 * Collision on same library path with different sha1 → fail closed.
 */
export function mergeMinecraftAndFabric(opts: {
  vanilla: ResolvedMinecraftVersion;
  fabric: FabricResolvedProfile;
  platform: PlatformInfo;
}): ResolvedMinecraftRuntime {
  if (opts.fabric.minecraftVersion !== opts.vanilla.id) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "fabric profile MC version mismatch", {
      fabric: opts.fabric.minecraftVersion,
      vanilla: opts.vanilla.id
    });
  }

  const vanillaLibs = resolveLibrariesForPlatform(opts.vanilla.libraries, opts.platform);
  const fabricLibs = resolveLibrariesForPlatform(opts.fabric.libraries, opts.platform);

  const byPath = new Map<string, ResolvedLibraryArtifact>();
  for (const lib of [...vanillaLibs, ...fabricLibs]) {
    const prev = byPath.get(lib.path);
    if (prev) {
      const sameIntegrity =
        prev.integrity.algorithm === lib.integrity.algorithm &&
        prev.integrity.digest === lib.integrity.digest;
      const sameSize =
        (prev.download.size < 0 && lib.download.size < 0) ||
        prev.download.size === lib.download.size;
      if (!sameIntegrity || !sameSize) {
        throw new LauncherError(ErrorCode.RUNTIME_LIBRARY_COLLISION, "library path collision with different metadata", {
          path: lib.path,
          a: prev.integrity.digest,
          b: lib.integrity.digest
        });
      }
      continue;
    }
    byPath.set(lib.path, lib);
  }

  const req = opts.vanilla.javaVersion
    ? {
        majorVersion: opts.vanilla.javaVersion.majorVersion,
        ...(opts.vanilla.javaVersion.component
          ? { component: opts.vanilla.javaVersion.component }
          : {})
      }
    : null;

  // Fabric inheritsFrom vanilla: merge arguments per sub-key (jvm/game), not wholesale.
  // Live Fabric 26.1.2/0.19.3 supplies only jvm:["-DFabricMcEmu=..."] and game:[];
  // replacing the whole block dropped vanilla -cp ${classpath} / natives.
  const launchArgs = mergeFabricLaunchArguments(opts.vanilla.arguments, opts.fabric.raw.arguments);
  const legacyArgs = opts.fabric.raw.minecraftArguments ?? opts.vanilla.minecraftArguments;
  const versionType =
    (typeof opts.fabric.raw.type === "string" && opts.fabric.raw.type) ||
    opts.vanilla.type ||
    "release";

  const out: ResolvedMinecraftRuntime = {
    minecraftVersion: opts.vanilla.id,
    fabricLoaderVersion: opts.fabric.fabricLoaderVersion,
    mainClass: opts.fabric.mainClass, // Fabric replaces main class
    clientJar: opts.vanilla.client,
    assetIndex: opts.vanilla.assetIndex,
    libraries: [...byPath.values()],
    javaRequirement: req,
    inheritanceChain: opts.vanilla.inheritanceChain,
    fabricProfileId: opts.fabric.id,
    versionType
  };
  if (launchArgs) out.arguments = launchArgs;
  if (legacyArgs) out.minecraftArguments = legacyArgs;
  return out;
}

type LaunchArgumentBlock = {
  game?: unknown[];
  jvm?: unknown[];
};

/**
 * Merge Minecraft + Fabric modern argument blocks by sub-key.
 *
 * Semantics (confirmed against live Fabric profile 26.1.2 / 0.19.3):
 * - Fabric is an inheritsFrom overlay: partial `arguments` add to vanilla, do not replace.
 * - Order: vanilla entries first, then Fabric entries (deterministic).
 * - Absent Fabric `arguments` → vanilla unchanged.
 * - Empty Fabric list (e.g. `game: []`) contributes nothing; vanilla list is kept.
 * - Does not invent dedupe beyond concat; live Fabric has no `-cp` so vanilla `-cp` stays unique.
 */
export function mergeFabricLaunchArguments(
  vanilla: LaunchArgumentBlock | undefined,
  fabric: LaunchArgumentBlock | undefined
): LaunchArgumentBlock | undefined {
  if (!fabric) return vanilla;
  if (!vanilla) return fabric;

  const jvm = [...(vanilla.jvm ?? []), ...(fabric.jvm ?? [])];
  const game = [...(vanilla.game ?? []), ...(fabric.game ?? [])];

  const out: LaunchArgumentBlock = {};
  if (vanilla.jvm !== undefined || fabric.jvm !== undefined) out.jvm = jvm;
  if (vanilla.game !== undefined || fabric.game !== undefined) out.game = game;
  return out.jvm !== undefined || out.game !== undefined ? out : undefined;
}

export async function resolveFabricProfileFromSources(opts: {
  minecraftVersion: string;
  fabricLoaderVersion: string;
  fetchLoaderList: (minecraftVersion: string) => Promise<unknown>;
  fetchProfile: (minecraftVersion: string, fabricLoaderVersion: string) => Promise<unknown>;
}): Promise<FabricResolvedProfile> {
  const list = parseFabricLoaderList(await opts.fetchLoaderList(opts.minecraftVersion));
  selectExactFabricLoader(list, opts.fabricLoaderVersion);
  const profile = parseFabricProfile(await opts.fetchProfile(opts.minecraftVersion, opts.fabricLoaderVersion));
  if (profile.fabricLoaderVersion !== opts.fabricLoaderVersion) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "fabric profile loader mismatch");
  }
  if (profile.minecraftVersion !== opts.minecraftVersion) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "fabric profile minecraft mismatch");
  }
  return profile;
}

void assertSafeLibraryPath;
void resolveVersionInheritance;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
