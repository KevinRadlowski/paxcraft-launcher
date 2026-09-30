import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { sha1Integrity } from "../integrity/index.js";
import { assertNonNegativeSafeInteger } from "../metadata/bytes.js";

export interface AssetObject {
  logicalName: string;
  hash: string;
  size: number;
}

export interface ParsedAssetIndex {
  id: string;
  objects: AssetObject[];
}

/**
 * Parse asset index JSON. Physical path is ONLY derived from hash:
 * objects/<hash[0:2]>/<hash>
 * logicalName is never used as a filesystem path.
 */
export function parseAssetIndex(id: string, raw: unknown): ParsedAssetIndex {
  if (!isObj(raw) || !isObj(raw.objects)) {
    throw new LauncherError(ErrorCode.INVALID_ASSET_INDEX, "asset index missing objects");
  }
  const objects: AssetObject[] = [];
  const seenHash = new Set<string>();
  for (const [logicalName, val] of Object.entries(raw.objects)) {
    if (!isObj(val) || typeof val.hash !== "string") {
      throw new LauncherError(ErrorCode.INVALID_ASSET_OBJECT, "invalid asset object", { logicalName });
    }
    let size: number;
    try {
      size = assertNonNegativeSafeInteger(val.size, "asset.size");
    } catch {
      throw new LauncherError(ErrorCode.INVALID_ASSET_OBJECT, "invalid asset size", { logicalName });
    }
    let hash: string;
    try {
      hash = sha1Integrity(val.hash).digest;
    } catch {
      throw new LauncherError(ErrorCode.INVALID_ASSET_OBJECT, "invalid asset hash", { logicalName });
    }
    // Deduplicate identical objects by hash (same content)
    if (seenHash.has(hash)) {
      // still record logical mapping? For download we only need unique hashes.
      continue;
    }
    seenHash.add(hash);
    objects.push({ logicalName, hash, size });
  }
  return { id, objects };
}

export function assetObjectRelativePath(hash: string): string {
  const h = sha1Integrity(hash).digest;
  return `objects/${h.slice(0, 2)}/${h}`;
}

export function assetObjectUrl(resourcesBase: string, hash: string): string {
  const h = sha1Integrity(hash).digest;
  const base = resourcesBase.replace(/\/+$/, "");
  return `${base}/${h.slice(0, 2)}/${h}`;
}

export const DEFAULT_RESOURCES_BASE = "https://resources.download.minecraft.net";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
