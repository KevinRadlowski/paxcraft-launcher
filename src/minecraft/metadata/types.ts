import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { IntegrityExpectation } from "../integrity/index.js";
import { sha1Integrity } from "../integrity/index.js";
import { parseMinecraftRule, type MinecraftRule } from "../rules/index.js";
import {
  assertNonNegativeSafeInteger,
  requireManifestEntrySha1
} from "./bytes.js";

export const DEFAULT_VERSION_MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
export const DEFAULT_FABRIC_META_BASE = "https://meta.fabricmc.net";

export interface VersionManifestEntry {
  id: string;
  type: string;
  url: string;
  /** Official version_manifest_v2 always provides sha1; required for integrity. */
  sha1: string;
}

export interface VersionManifestV2 {
  latest: { release: string; snapshot: string };
  versions: VersionManifestEntry[];
}

export interface MinecraftArtifactDownload {
  sha1: string;
  size: number;
  url: string;
}

export interface MinecraftLibraryDownloads {
  artifact?: MinecraftArtifactDownload & { path?: string };
  classifiers?: Record<string, MinecraftArtifactDownload & { path?: string }>;
}

export interface MinecraftLibrary {
  name: string;
  downloads?: MinecraftLibraryDownloads;
  rules?: MinecraftRule[];
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
  /**
   * Fabric Maven repository base (HTTPS), when the library has no downloads.artifact.
   * Example: "https://maven.fabricmc.net/"
   */
  mavenUrl?: string;
  /** Optional digests published inline on Fabric Meta profiles (prefer sha256). */
  mavenSha1?: string;
  mavenSha256?: string;
  mavenSize?: number;
}

export interface MinecraftAssetIndexRef {
  id: string;
  sha1: string;
  size: number;
  totalSize?: number;
  url: string;
}

export interface MinecraftJavaVersion {
  component?: string;
  majorVersion: number;
}

export interface MinecraftVersionMeta {
  id: string;
  inheritsFrom?: string;
  mainClass?: string;
  assetIndex?: MinecraftAssetIndexRef;
  downloads?: {
    client?: MinecraftArtifactDownload;
    server?: MinecraftArtifactDownload;
  };
  libraries?: MinecraftLibrary[];
  arguments?: {
    game?: unknown[];
    jvm?: unknown[];
  };
  minecraftArguments?: string;
  javaVersion?: MinecraftJavaVersion;
  type?: string;
  /** Raw JSON retained for write-through if needed */
  raw: Record<string, unknown>;
}

export interface ResolvedMinecraftVersion {
  id: string;
  mainClass: string;
  client: MinecraftArtifactDownload;
  assetIndex: MinecraftAssetIndexRef;
  libraries: MinecraftLibrary[];
  javaVersion: MinecraftJavaVersion | null;
  arguments?: MinecraftVersionMeta["arguments"];
  minecraftArguments?: string;
  type?: string;
  /** Ordered chain id list after inheritance resolution */
  inheritanceChain: string[];
}

export function parseVersionManifest(raw: unknown): VersionManifestV2 {
  if (!isObj(raw) || !isObj(raw.latest) || !Array.isArray(raw.versions)) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "invalid version manifest");
  }
  const versions: VersionManifestEntry[] = [];
  for (const v of raw.versions) {
    if (!isObj(v) || typeof v.id !== "string" || typeof v.url !== "string" || typeof v.type !== "string") {
      throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "invalid version manifest entry");
    }
    assertHttps(v.url);
    const sha1 = requireManifestEntrySha1(
      typeof v.sha1 === "string" ? v.sha1 : undefined,
      v.id
    );
    versions.push({ id: v.id, type: v.type, url: v.url, sha1 });
  }
  return {
    latest: {
      release: String(raw.latest.release ?? ""),
      snapshot: String(raw.latest.snapshot ?? "")
    },
    versions
  };
}

export function findExactVersion(
  manifest: VersionManifestV2,
  minecraftVersion: string
): VersionManifestEntry {
  const found = manifest.versions.find((v) => v.id === minecraftVersion);
  if (!found) {
    throw new LauncherError(ErrorCode.MINECRAFT_VERSION_NOT_FOUND, `Minecraft version not found: ${minecraftVersion}`, {
      minecraftVersion
    });
  }
  return found;
}

export function parseVersionMeta(raw: unknown): MinecraftVersionMeta {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "version meta missing id");
  }
  const meta: MinecraftVersionMeta = {
    id: raw.id,
    raw: raw as Record<string, unknown>
  };
  if (typeof raw.inheritsFrom === "string") meta.inheritsFrom = raw.inheritsFrom;
  if (typeof raw.mainClass === "string") meta.mainClass = raw.mainClass;
  if (typeof raw.type === "string") meta.type = raw.type;
  if (typeof raw.minecraftArguments === "string") meta.minecraftArguments = raw.minecraftArguments;
  if (isObj(raw.javaVersion)) {
    if (!("majorVersion" in raw.javaVersion)) {
      throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "javaVersion missing majorVersion");
    }
    meta.javaVersion = {
      majorVersion: assertNonNegativeSafeInteger(raw.javaVersion.majorVersion, "javaVersion.majorVersion")
    };
    if (typeof raw.javaVersion.component === "string") {
      meta.javaVersion.component = raw.javaVersion.component;
    }
  }
  if (isObj(raw.assetIndex)) {
    meta.assetIndex = parseAssetIndexRef(raw.assetIndex);
  }
  if (isObj(raw.downloads) && isObj(raw.downloads.client)) {
    meta.downloads = { client: parseArtifact(raw.downloads.client) };
  }
  if (Array.isArray(raw.libraries)) {
    meta.libraries = raw.libraries.map((l, i) => parseLibrary(l, i));
  }
  if (isObj(raw.arguments)) {
    const argumentsBlock: { game?: unknown[]; jvm?: unknown[] } = {};
    if (Array.isArray(raw.arguments.game)) argumentsBlock.game = raw.arguments.game;
    if (Array.isArray(raw.arguments.jvm)) argumentsBlock.jvm = raw.arguments.jvm;
    meta.arguments = argumentsBlock;
  }
  return meta;
}

function parseAssetIndexRef(raw: Record<string, unknown>): MinecraftAssetIndexRef {
  if (typeof raw.id !== "string" || typeof raw.sha1 !== "string" || typeof raw.url !== "string") {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "invalid assetIndex ref");
  }
  assertHttps(raw.url);
  const ref: MinecraftAssetIndexRef = {
    id: raw.id,
    sha1: sha1Integrity(raw.sha1).digest,
    size: assertNonNegativeSafeInteger(raw.size, "assetIndex.size"),
    url: raw.url
  };
  if (raw.totalSize !== undefined) {
    ref.totalSize = assertNonNegativeSafeInteger(raw.totalSize, "assetIndex.totalSize");
  }
  return ref;
}

function parseArtifact(raw: Record<string, unknown>): MinecraftArtifactDownload {
  if (typeof raw.sha1 !== "string" || typeof raw.url !== "string") {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "invalid artifact download");
  }
  assertHttps(raw.url);
  return {
    sha1: sha1Integrity(raw.sha1).digest,
    size: assertNonNegativeSafeInteger(raw.size, "artifact.size"),
    url: raw.url
  };
}

function parseLibrary(raw: unknown, index: number): MinecraftLibrary {
  if (!isObj(raw) || typeof raw.name !== "string") {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `invalid library[${index}]`);
  }
  const lib: MinecraftLibrary = { name: raw.name };
  if (Array.isArray(raw.rules)) {
    lib.rules = raw.rules.map((r, ri) => parseMinecraftRule(r, ri));
  }
  if (isObj(raw.natives)) {
    lib.natives = {};
    for (const [k, v] of Object.entries(raw.natives)) {
      if (typeof v === "string") lib.natives[k] = v;
    }
  }
  if (isObj(raw.extract) && Array.isArray(raw.extract.exclude)) {
    lib.extract = { exclude: raw.extract.exclude.filter((x): x is string => typeof x === "string") };
  }
  if (isObj(raw.downloads)) {
    lib.downloads = {};
    if (isObj(raw.downloads.artifact)) {
      const a = parseArtifact(raw.downloads.artifact);
      lib.downloads.artifact = { ...a };
      if (typeof raw.downloads.artifact.path === "string") {
        assertSafeLibraryPath(raw.downloads.artifact.path);
        lib.downloads.artifact.path = raw.downloads.artifact.path.replace(/\\/g, "/");
      }
    }
    if (isObj(raw.downloads.classifiers)) {
      lib.downloads.classifiers = {};
      for (const [key, val] of Object.entries(raw.downloads.classifiers)) {
        if (!isObj(val)) continue;
        const art = parseArtifact(val);
        const entry: MinecraftArtifactDownload & { path?: string } = { ...art };
        if (typeof val.path === "string") {
          assertSafeLibraryPath(val.path);
          entry.path = val.path.replace(/\\/g, "/");
        }
        lib.downloads.classifiers[key] = entry;
      }
    }
  }
  // Fabric Meta Maven-style: name + url (+ optional sha1/sha256/size). Ignore md5.
  if (typeof raw.url === "string" && raw.url.length > 0) {
    assertHttps(raw.url);
    lib.mavenUrl = raw.url;
  }
  if (typeof raw.sha256 === "string" && raw.sha256.length > 0) {
    lib.mavenSha256 = raw.sha256.toLowerCase();
  }
  if (typeof raw.sha1 === "string" && raw.sha1.length > 0) {
    lib.mavenSha1 = raw.sha1.toLowerCase();
  }
  if (raw.size !== undefined) {
    lib.mavenSize = assertNonNegativeSafeInteger(raw.size, `library[${index}].size`);
  }
  return lib;
}

export function assertSafeLibraryPath(p: string): void {
  if (!p || p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `unsafe library path: ${p}`);
  }
  const parts = p.replace(/\\/g, "/").split("/");
  if (parts.some((x) => x === ".." || x === "" || x === ".")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `unsafe library path: ${p}`);
  }
}

export function artifactIntegrity(art: MinecraftArtifactDownload): IntegrityExpectation {
  return sha1Integrity(art.sha1);
}

function assertHttps(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `invalid URL: ${url}`);
  }
  if (u.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "Minecraft metadata URL must be HTTPS", { url });
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
