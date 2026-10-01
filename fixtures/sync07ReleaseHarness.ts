import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientManifest, ManifestMod } from "../src/core/manifest/index.js";
import type { ReleaseDoc } from "../src/core/release/index.js";
import type { VerifiedChannel } from "../src/core/channel/index.js";
import type { TrustedResolvedRelease } from "../src/core/resolve/index.js";
import { MockByteSource } from "../src/download/engine/sources.js";
import { ProviderResolver } from "../src/download/providers/index.js";
import { joinProductUrl } from "../src/distribution/urls/index.js";

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PM_ROOT = path.resolve(FIXTURE_ROOT, "..", "SweetCraft-PackManager-v0.4");
export const RELEASE_013 = path.join(PM_ROOT, "data", "releases", "0.1.3");
export const RELEASE_014 = path.join(PM_ROOT, "data", "releases", "0.1.4");
export const PRODUCT_BASE = "https://cdn.example.test/sweetcraft";

export const CASINO_OLD_SHA = "27d7d836dfe914ba03642a46b2e5eac1c89d678bd144f1d2dd783d893d1b7727";
export const CASINO_NEW_SHA = "750128c35b68443e5cf3e760cc29781a79229c60473681dedb91b40acf7e269c";
export const CASINO_OLD_FILE = "xbase-casino-0.7.5-C2.1+mc26.1.2.jar";
export const CASINO_NEW_FILE = "xbase-casino-0.9.17-B2.7.2.1+mc26.1.2.jar";

export const DELETED_MOD_IDS = [
  "armoredfoes",
  "bettercombat",
  "distanthorizons",
  "player_animation_library",
  "uselessreptile",
  "visualworkbench",
  "yet_another_config_lib_v3"
] as const;

export const DELETE_CONFIG_PATHS = [
  "config/DistantHorizons.toml",
  "config/armoredfoes-server.toml",
  "config/bettercombat/client.json5",
  "config/bettercombat/fallback_compatibility.json",
  "config/bettercombat/server.json5",
  "config/bettercombat/weapon_trails.json",
  "config/inventoryprofilesnext/integrationHints/exampleIntegrationHints.json",
  "config/uselessreptile.json5",
  "config/uselessreptile_client.json5",
  "config/uselessreptile_mob_attributes.json5",
  "config/visualworkbench-client.toml",
  "config/visualworkbench-server.toml",
  "config/yacl.json5"
] as const;

export function sha256Of(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function hashFile(p: string): Promise<{ sha256: string; size: number }> {
  const buf = await readFile(p);
  return { sha256: sha256Of(buf), size: buf.length };
}

export async function loadClientManifest(releaseDir: string): Promise<ClientManifest> {
  return JSON.parse(await readFile(path.join(releaseDir, "client-manifest.json"), "utf8")) as ClientManifest;
}

export async function loadReleaseDoc(releaseDir: string): Promise<ReleaseDoc> {
  return JSON.parse(await readFile(path.join(releaseDir, "release.json"), "utf8")) as ReleaseDoc;
}

export async function buildTrustedResolvedLocal(opts: {
  releaseDir: string;
  packVersion: string;
  releaseSequence: number;
  channel?: string;
}): Promise<TrustedResolvedRelease> {
  const manifest = await loadClientManifest(opts.releaseDir);
  const release = await loadReleaseDoc(opts.releaseDir);
  const clientHash = await hashFile(path.join(opts.releaseDir, "client-manifest.json"));
  const releaseHash = await hashFile(path.join(opts.releaseDir, "release.json"));

  release.artefacts.clientManifest.sha256 = clientHash.sha256;
  release.artefacts.serverManifest.sha256 = (
    await hashFile(path.join(opts.releaseDir, "server-manifest.json"))
  ).sha256;
  release.artefacts.checksums.sha256 = (await hashFile(path.join(opts.releaseDir, "checksums.json"))).sha256;

  const channelName = opts.channel ?? "dev-local";
  const channel: VerifiedChannel = {
    trusted: true,
    publicKeyId: "sync07-local",
    descriptor: {
      schemaVersion: 1,
      channel: channelName,
      packVersion: opts.packVersion,
      releaseSequence: opts.releaseSequence,
      releasePath: `releases/${opts.packVersion}/release.json`,
      releaseSha256: releaseHash.sha256,
      signature: {
        status: "unsigned-dev",
        algorithm: "ed25519",
        publicKeyId: null,
        payload: "SWEETCRAFT-CHANNEL-SIGNATURE-V1",
        value: null
      }
    }
  };

  return {
    trusted: true,
    channel,
    release: {
      trusted: true,
      release,
      releaseBytesSha256: releaseHash.sha256,
      publicKeyId: "sync07-local"
    },
    clientManifest: manifest,
    productBase: PRODUCT_BASE,
    candidate: {
      channel: channelName,
      releaseSequence: opts.releaseSequence,
      packVersion: opts.packVersion,
      releasePath: `releases/${opts.packVersion}/release.json`,
      releaseSha256: releaseHash.sha256
    }
  };
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else out.push(abs);
    }
  }
  await walk(dir);
  return out;
}

/** Mount staged release bytes + provider mod URLs for a local PM release directory. */
export async function mountLocalReleaseSource(
  source: MockByteSource,
  releaseDir: string,
  manifest: ClientManifest,
  productBase: string,
  opts?: { modBytesByFile?: Map<string, Buffer>; cleanModsDir?: string }
): Promise<void> {
  const resolver = new ProviderResolver();
  const packVersion = manifest.packVersion;

  for (const mod of manifest.mods) {
    let bytes: Buffer | null = null;
    const hosted = path.join(releaseDir, "files", "mods", mod.file);
    try {
      bytes = await readFile(hosted);
    } catch {
      /* try overrides */
    }
    if (!bytes && opts?.modBytesByFile?.has(mod.file)) {
      bytes = opts.modBytesByFile.get(mod.file)!;
    }
    if (!bytes && opts?.cleanModsDir) {
      try {
        bytes = await readFile(path.join(opts.cleanModsDir, mod.file));
      } catch {
        /* optional */
      }
    }
    if (!bytes) {
      throw new Error(`missing mod bytes for ${mod.file}`);
    }
    if (sha256Of(bytes) !== mod.sha256.toLowerCase()) {
      throw new Error(`mod byte hash mismatch ${mod.file}`);
    }
    const url = mod.provider.url;
    if (!url) throw new Error(`mod missing provider url ${mod.id}`);
    source.set(url, bytes);
  }

  for (const cfg of manifest.configs) {
    const staged = path.join(releaseDir, "files", cfg.path);
    const bytes = await readFile(staged);
    if (sha256Of(bytes) !== cfg.sha256.toLowerCase()) {
      throw new Error(`config hash mismatch ${cfg.path}`);
    }
    const dl = resolver.resolveCdnFile({
      productBase,
      packVersion,
      relativeUnderFiles: cfg.path,
      expectedSha256: cfg.sha256,
      expectedSize: -1,
      id: `cfg:${cfg.path}`,
      targetPath: cfg.path
    });
    source.set(dl.url, bytes);
  }

  for (const rp of manifest.resourcePacks ?? []) {
    const base = path.basename(rp.targetPath);
    const staged = path.join(releaseDir, "files", "resourcepacks", base);
    const bytes = await readFile(staged);
    const dl = resolver.resolveCdnFile({
      productBase,
      packVersion,
      relativeUnderFiles: `resourcepacks/${base}`,
      expectedSha256: rp.sha256,
      expectedSize: rp.size,
      id: `rp:${rp.id}`,
      targetPath: rp.targetPath
    });
    source.set(dl.url, bytes);
  }
}

export function findMod(manifest: ClientManifest, id: string): ManifestMod {
  const m = manifest.mods.find(x => x.id === id);
  if (!m) throw new Error(`mod not in manifest: ${id}`);
  return m;
}

export async function inventoryManagedOnDisk(
  instanceRoot: string,
  prefix: string
): Promise<Map<string, { sha256: string; size: number }>> {
  const base = path.join(instanceRoot, prefix);
  const out = new Map<string, { sha256: string; size: number }>();
  let files: string[];
  try {
    files = await listFilesRecursive(base);
  } catch {
    return out;
  }
  for (const abs of files) {
    const rel = path.relative(instanceRoot, abs).split(path.sep).join("/");
    const h = await hashFile(abs);
    out.set(rel, h);
  }
  return out;
}

export function cdnConfigUrl(productBase: string, packVersion: string, configPath: string): string {
  return joinProductUrl(productBase, `releases/${packVersion}/files/${configPath}`);
}
