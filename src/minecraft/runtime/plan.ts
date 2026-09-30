import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { HttpClient } from "../../distribution/http/index.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import { summarizePlannedDownloadBytes } from "../../instance/plan/plannedDownloadBytes.js";
import { enrichRuntimePlanDownloadSizes } from "./enrichDownloadSizes.js";
import type { PlatformInfo } from "../../platform/index.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  findExactVersion,
  parseVersionManifest,
  type VersionManifestV2
} from "../metadata/types.js";
import {
  loadSha1VerifiedJson,
  loadVerifiedAssetIndexJson,
  parseJsonFromBytes,
  type FetchedMetadata
} from "../metadata/bytes.js";
import { resolveVersionInheritance } from "../version/index.js";
import {
  mergeMinecraftAndFabric,
  parseFabricLoaderList,
  parseFabricProfile,
  selectExactFabricLoader,
  type ResolvedMinecraftRuntime
} from "../fabric/index.js";
import { parseAssetIndex, assetObjectRelativePath } from "../assets/index.js";
import type { RuntimeInstallationPlan, RuntimePlanEntry } from "./types.js";
import type { RuntimePaths } from "./paths.js";
import { sha1Integrity } from "../integrity/index.js";
import { ensureMavenSidecarIntegrity } from "../libraries/sidecar.js";

/**
 * Network sources return opaque bytes. Callers verify then parse.
 * Fabric Meta has no external sha1 contract today — still fetched as bytes + structural validation.
 */
export interface RuntimeMetadataSources {
  fetchVersionManifest(): Promise<FetchedMetadata>;
  fetchVersionMeta(url: string): Promise<FetchedMetadata>;
  fetchAssetIndex(url: string): Promise<FetchedMetadata>;
  fetchFabricLoaderList(minecraftVersion: string): Promise<FetchedMetadata>;
  fetchFabricProfile(minecraftVersion: string, fabricLoaderVersion: string): Promise<FetchedMetadata>;
  /**
   * Fetch arbitrary HTTPS bytes (Maven checksum sidecars).
   * Required when Fabric libraries lack inline digests (e.g. fabric-loader).
   */
  fetchUrlBytes(url: string): Promise<FetchedMetadata>;
}

export interface BuildRuntimePlanOptions {
  minecraftVersion: string;
  fabricLoaderVersion: string;
  platform: PlatformInfo;
  paths: RuntimePaths;
  sources: RuntimeMetadataSources;
  dryRun?: boolean;
  emitter?: ProgressEmitter;
  /** When set, Maven libraries without inline size are resolved via HTTPS HEAD before RUNTIME_PLAN_READY. */
  http?: HttpClient;
  signal?: AbortSignal;
}

/**
 * RESOLUTION only — no filesystem mutation besides existence probes for plan actions.
 *
 * Mojang version JSON trust:
 *   manifest → exact entry (sha1 required) → fetch bytes → verify sha1 → JSON.parse → domain
 * Parent inheritsFrom uses the same path (parent must exist in the same manifest).
 *
 * Asset index trust:
 *   fetch bytes → verify size + sha1 → JSON.parse → objects
 */
export async function buildRuntimeInstallationPlan(
  opts: BuildRuntimePlanOptions
): Promise<RuntimeInstallationPlan> {
  opts.emitter?.emit("RUNTIME_RESOLUTION_STARTED", {
    minecraftVersion: opts.minecraftVersion,
    fabricLoaderVersion: opts.fabricLoaderVersion
  });

  const manifestFetched = await opts.sources.fetchVersionManifest();
  const manifest = parseVersionManifest(parseJsonFromBytes(manifestFetched)) as VersionManifestV2;
  const entry = findExactVersion(manifest, opts.minecraftVersion);

  const leafFetched = await opts.sources.fetchVersionMeta(entry.url);
  const leafRaw = loadSha1VerifiedJson(leafFetched, entry.sha1);

  const fetchParent = async (id: string) => {
    const parentEntry = findExactVersion(manifest, id);
    const parentFetched = await opts.sources.fetchVersionMeta(parentEntry.url);
    return loadSha1VerifiedJson(parentFetched, parentEntry.sha1);
  };

  const vanilla = await resolveVersionInheritance(leafRaw, fetchParent);
  opts.emitter?.emit("MINECRAFT_METADATA_RESOLVED", {
    id: vanilla.id,
    inheritanceChain: vanilla.inheritanceChain
  });

  const fabric = await resolveFabricProfileFromFetchedSources({
    minecraftVersion: opts.minecraftVersion,
    fabricLoaderVersion: opts.fabricLoaderVersion,
    fetchLoaderList: opts.sources.fetchFabricLoaderList,
    fetchProfile: opts.sources.fetchFabricProfile
  });

  opts.emitter?.emit("FABRIC_METADATA_RESOLVED", {
    id: fabric.id,
    mainClass: fabric.mainClass
  });

  const merged: ResolvedMinecraftRuntime = mergeMinecraftAndFabric({
    vanilla,
    fabric,
    platform: opts.platform
  });

  // Fabric Maven libs without inline digests (e.g. fabric-loader) require sidecars.
  const libraries = await ensureMavenSidecarIntegrity(
    merged.libraries,
    opts.sources.fetchUrlBytes
  );
  const resolved: ResolvedMinecraftRuntime = { ...merged, libraries };

  const assetIndexFetched = await opts.sources.fetchAssetIndex(resolved.assetIndex.url);
  const assetIndexRaw = loadVerifiedAssetIndexJson(assetIndexFetched, {
    sha1: resolved.assetIndex.sha1,
    size: resolved.assetIndex.size
  });
  const assets = parseAssetIndex(resolved.assetIndex.id, assetIndexRaw);

  const entries: RuntimePlanEntry[] = [];

  {
    const rel = `versions/${resolved.minecraftVersion}/${resolved.minecraftVersion}.jar`;
    const abs = opts.paths.versionJar(resolved.minecraftVersion);
    const status = await fileStatus(abs, resolved.clientJar.sha1, "sha1", resolved.clientJar.size);
    entries.push({
      action: status === "ok" ? "KEEP" : status === "missing" ? "DOWNLOAD" : "REPAIR",
      kind: "client",
      id: "client",
      relativePath: rel,
      url: resolved.clientJar.url,
      integrity: sha1Integrity(resolved.clientJar.sha1),
      expectedSize: resolved.clientJar.size,
      reason: status === "ok" ? "client_ok" : status === "missing" ? "client_missing" : "client_corrupt"
    });
  }

  for (const lib of resolved.libraries) {
    if (lib.needsMavenSidecar) {
      throw new LauncherError(
        ErrorCode.DOWNLOAD_HASH_MISMATCH,
        "library still missing integrity after sidecar resolution",
        { name: lib.name }
      );
    }
    const abs = opts.paths.libraryFile(lib.path);
    const status = await fileStatus(
      abs,
      lib.integrity.digest,
      lib.integrity.algorithm,
      lib.download.size
    );
    const action = status === "ok" ? "KEEP" : status === "missing" ? "DOWNLOAD" : "REPAIR";
    const entry: RuntimePlanEntry = {
      action,
      kind: lib.kind === "native" ? "native" : "library",
      id: lib.name + (lib.classifier ? `:${lib.classifier}` : ""),
      relativePath: `libraries/${lib.path}`,
      url: lib.download.url,
      integrity: lib.integrity,
      ...(lib.download.size >= 0 ? { expectedSize: lib.download.size } : {}),
      reason: `${lib.kind}_${status}`
    };
    if (lib.kind === "native") {
      entry.extractExclude = lib.extractExclude;
    }
    entries.push(entry);
  }

  for (const lib of resolved.libraries.filter((l) => l.kind === "native")) {
    entries.push({
      action: "EXTRACT_NATIVE",
      kind: "native",
      id: `extract:${lib.name}`,
      relativePath: `libraries/${lib.path}`,
      extractExclude: lib.extractExclude,
      reason: "extract_natives"
    });
  }

  {
    const abs = opts.paths.assetIndexFile(resolved.assetIndex.id);
    const status = await fileStatus(abs, resolved.assetIndex.sha1, "sha1", resolved.assetIndex.size);
    entries.push({
      action: status === "ok" ? "KEEP" : status === "missing" ? "DOWNLOAD" : "REPAIR",
      kind: "assetIndex",
      id: resolved.assetIndex.id,
      relativePath: `assets/indexes/${resolved.assetIndex.id}.json`,
      url: resolved.assetIndex.url,
      integrity: sha1Integrity(resolved.assetIndex.sha1),
      expectedSize: resolved.assetIndex.size,
      reason: `assetIndex_${status}`
    });
  }

  for (const obj of assets.objects) {
    const rel = `assets/${assetObjectRelativePath(obj.hash)}`;
    const abs = opts.paths.assetObjectFile(obj.hash);
    const status = await fileStatus(abs, obj.hash, "sha1", obj.size);
    entries.push({
      action: status === "ok" ? "KEEP" : status === "missing" ? "DOWNLOAD" : "REPAIR",
      kind: "asset",
      id: obj.hash,
      relativePath: rel,
      url: `https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`,
      integrity: sha1Integrity(obj.hash),
      expectedSize: obj.size,
      reason: `asset_${status}`
    });
  }

  entries.push({
    action: "WRITE_METADATA",
    kind: "metadata",
    id: "runtime-state",
    relativePath: "launcher/runtime-state.json",
    reason: "write_state"
  });

  const summary = {
    download: entries.filter((e) => e.action === "DOWNLOAD").length,
    keep: entries.filter((e) => e.action === "KEEP").length,
    repair: entries.filter((e) => e.action === "REPAIR").length,
    extractNative: entries.filter((e) => e.action === "EXTRACT_NATIVE").length,
    writeMetadata: entries.filter((e) => e.action === "WRITE_METADATA").length
  };

  let finalEntries = entries;
  if (opts.http) {
    finalEntries = await enrichRuntimePlanDownloadSizes(entries, opts.http, opts.signal);
  }

  const plan: RuntimeInstallationPlan = {
    dryRun: opts.dryRun === true,
    minecraftVersion: resolved.minecraftVersion,
    fabricLoaderVersion: resolved.fabricLoaderVersion,
    mainClass: resolved.mainClass,
    javaRequirement: resolved.javaRequirement,
    entries: finalEntries,
    summary,
    resolved,
    assets: assets.objects
  };

  const downloadPlan = summarizePlannedDownloadBytes(finalEntries);
  opts.emitter?.emit("RUNTIME_PLAN_READY", {
    summary,
    dryRun: plan.dryRun,
    plannedDownloadBytes: downloadPlan.plannedDownloadBytes,
    hasUnknownDownloadSize: downloadPlan.hasUnknownDownloadSize,
    plannedDownloadFiles: downloadPlan.plannedDownloadFiles
  });
  return plan;
}

async function resolveFabricProfileFromFetchedSources(opts: {
  minecraftVersion: string;
  fabricLoaderVersion: string;
  fetchLoaderList: (minecraftVersion: string) => Promise<FetchedMetadata>;
  fetchProfile: (minecraftVersion: string, fabricLoaderVersion: string) => Promise<FetchedMetadata>;
}) {
  const list = parseFabricLoaderList(parseJsonFromBytes(await opts.fetchLoaderList(opts.minecraftVersion)));
  selectExactFabricLoader(list, opts.fabricLoaderVersion);
  // Exactly one profile fetch per resolution
  const profile = parseFabricProfile(
    parseJsonFromBytes(await opts.fetchProfile(opts.minecraftVersion, opts.fabricLoaderVersion))
  );
  if (profile.fabricLoaderVersion !== opts.fabricLoaderVersion) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "fabric profile loader mismatch");
  }
  if (profile.minecraftVersion !== opts.minecraftVersion) {
    throw new LauncherError(ErrorCode.INVALID_FABRIC_METADATA, "fabric profile minecraft mismatch");
  }
  return profile;
}

async function fileStatus(
  abs: string,
  expectedDigest: string,
  algorithm: "sha1" | "sha256",
  expectedSize: number
): Promise<"ok" | "missing" | "corrupt"> {
  try {
    await access(abs, fsConstants.F_OK);
  } catch {
    return "missing";
  }
  const hash = createHash(algorithm);
  let size = 0;
  for await (const chunk of createReadStream(abs)) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.byteLength;
    hash.update(b);
  }
  const digest = hash.digest("hex");
  if (digest !== expectedDigest.toLowerCase()) return "corrupt";
  // size < 0 means unknown (Maven without size) — digest-only verification
  if (expectedSize >= 0 && size !== expectedSize) return "corrupt";
  return "ok";
}
