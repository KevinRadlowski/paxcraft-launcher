import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  parseVersionMeta,
  type MinecraftLibrary,
  type MinecraftVersionMeta,
  type ResolvedMinecraftVersion
} from "../metadata/types.js";

export const MAX_INHERITANCE_DEPTH = 8;

export type VersionMetaFetcher = (versionId: string) => Promise<unknown>;

/**
 * Inheritance merge rules (deterministic, documented):
 *
 * 1. Resolve chain child → ... → root via inheritsFrom (exact ids).
 * 2. Fail on cycle or depth > MAX_INHERITANCE_DEPTH.
 * 3. Merge from root to child (child overrides):
 *    - id: leaf id
 *    - mainClass: nearest defined toward leaf
 *    - downloads.client: nearest defined toward leaf
 *    - assetIndex: nearest defined toward leaf
 *    - javaVersion: nearest defined toward leaf
 *    - arguments: nearest defined toward leaf (not deep-merged)
 *    - minecraftArguments: nearest defined toward leaf
 *    - libraries: concatenate root→leaf order (parent libs first, then child)
 * 4. If inheritsFrom is present but unsupported fields appear that we cannot
 *    safely merge, we still apply the rules above; unknown top-level keys are ignored.
 * 5. Final result MUST have mainClass, client download, assetIndex.
 */
export async function resolveVersionInheritance(
  leafRaw: unknown,
  fetchParent: VersionMetaFetcher
): Promise<ResolvedMinecraftVersion> {
  const leaf = parseVersionMeta(leafRaw);
  const chain: MinecraftVersionMeta[] = [leaf];
  const seen = new Set<string>([leaf.id]);
  let current = leaf;

  while (current.inheritsFrom) {
    if (chain.length > MAX_INHERITANCE_DEPTH) {
      throw new LauncherError(ErrorCode.INHERITANCE_DEPTH_EXCEEDED, "version inheritance too deep", {
        depth: chain.length,
        max: MAX_INHERITANCE_DEPTH
      });
    }
    const parentId = current.inheritsFrom;
    if (seen.has(parentId)) {
      throw new LauncherError(ErrorCode.INHERITANCE_CYCLE, "version inheritance cycle", {
        id: parentId,
        chain: [...seen]
      });
    }
    seen.add(parentId);
    let parentRaw: unknown;
    try {
      parentRaw = await fetchParent(parentId);
    } catch (e) {
      if (LauncherError.isLauncherError(e)) throw e;
      throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `parent version missing: ${parentId}`, {
        parentId,
        cause: e instanceof Error ? e.message : String(e)
      });
    }
    const parent = parseVersionMeta(parentRaw);
    if (parent.id !== parentId) {
      throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "parent id mismatch", {
        expected: parentId,
        got: parent.id
      });
    }
    chain.push(parent);
    current = parent;
  }

  // chain[0]=leaf ... chain[n]=root → merge root→leaf
  const ordered = [...chain].reverse();
  let mainClass: string | undefined;
  let client = undefined as ResolvedMinecraftVersion["client"] | undefined;
  let assetIndex = undefined as ResolvedMinecraftVersion["assetIndex"] | undefined;
  let javaVersion: ResolvedMinecraftVersion["javaVersion"] = null;
  let argumentsBlock: ResolvedMinecraftVersion["arguments"];
  let minecraftArguments: string | undefined;
  let type: string | undefined;
  const libraries: MinecraftLibrary[] = [];

  for (const meta of ordered) {
    if (meta.mainClass) mainClass = meta.mainClass;
    if (meta.downloads?.client) client = meta.downloads.client;
    if (meta.assetIndex) assetIndex = meta.assetIndex;
    if (meta.javaVersion) javaVersion = meta.javaVersion;
    if (meta.arguments) argumentsBlock = meta.arguments;
    if (meta.minecraftArguments) minecraftArguments = meta.minecraftArguments;
    if (meta.type) type = meta.type;
    if (meta.libraries) libraries.push(...meta.libraries);
  }

  if (!mainClass) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "resolved version missing mainClass");
  }
  if (!client) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "resolved version missing client jar");
  }
  if (!assetIndex) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "resolved version missing assetIndex");
  }

  const resolved: ResolvedMinecraftVersion = {
    id: leaf.id,
    mainClass,
    client,
    assetIndex,
    libraries,
    javaVersion,
    inheritanceChain: ordered.map((m) => m.id)
  };
  if (argumentsBlock) resolved.arguments = argumentsBlock;
  if (minecraftArguments) resolved.minecraftArguments = minecraftArguments;
  if (type) resolved.type = type;
  return resolved;
}
