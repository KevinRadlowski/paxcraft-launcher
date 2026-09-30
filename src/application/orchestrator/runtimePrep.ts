import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import type { HttpClient } from "../../distribution/http/index.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { DownloadEngine } from "../../download/engine/index.js";
import { replaceFile, ensureDir, cleanupTemp } from "../../download/fs/index.js";
import type { ByteSource } from "../../download/engine/types.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import type { PlatformInfo } from "../../platform/index.js";
import { detectPlatform } from "../../platform/index.js";
import { RuntimePaths } from "../../minecraft/runtime/paths.js";
import {
  buildRuntimeInstallationPlan,
  type RuntimeMetadataSources
} from "../../minecraft/runtime/plan.js";
import type { RuntimeInstallationPlan, RuntimePlanEntry } from "../../minecraft/runtime/types.js";
import { extractZipSecure } from "../../minecraft/natives/index.js";
import type { TrustedResolvedRelease } from "../../core/resolve/index.js";

export interface RuntimePrepResult {
  plan: RuntimeInstallationPlan;
  downloadedFiles: number;
  downloadedBytes: number;
}

function runtimeAbsolute(paths: RuntimePaths, relativePosix: string): string {
  const norm = relativePosix.replace(/\\/g, "/");
  return path.join(paths.minecraftDir(), ...norm.split("/"));
}

/**
 * Plan + apply Minecraft/Fabric runtime using existing 0.3A planner + DownloadEngine.
 * Does not touch instance state.json — call before pack apply so failure prevents READY commit.
 */
export async function prepareMinecraftRuntime(opts: {
  resolved: TrustedResolvedRelease;
  runtimeRoot: string;
  sources: RuntimeMetadataSources;
  byteSource: ByteSource;
  http?: HttpClient;
  platform?: PlatformInfo;
  emitter?: ProgressEmitter;
  signal?: AbortSignal;
}): Promise<RuntimePrepResult> {
  const paths = new RuntimePaths(opts.runtimeRoot);
  await ensureDir(paths.root);
  await ensureDir(paths.tmpDir());
  await ensureDir(paths.minecraftDir());
  const platform = opts.platform ?? detectPlatform();
  const mc = opts.resolved.clientManifest.minecraft;
  const fabric = opts.resolved.clientManifest.fabricLoader;

  const plan = await buildRuntimeInstallationPlan({
    minecraftVersion: mc,
    fabricLoaderVersion: fabric,
    platform,
    paths,
    sources: opts.sources,
    dryRun: false,
    ...(opts.http ? { http: opts.http } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.emitter ? { emitter: opts.emitter } : {})
  });

  const engine = new DownloadEngine({
    source: opts.byteSource,
    tmpDir: paths.tmpDir(),
    ...(opts.emitter ? { emitter: opts.emitter } : {})
  });

  let downloadedFiles = 0;
  let downloadedBytes = 0;
  const temps: string[] = [];

  try {
    for (const entry of plan.entries) {
      if (opts.signal?.aborted) {
        throw new LauncherError(ErrorCode.OPERATION_ABORTED, "runtime prep aborted", {});
      }
      if (entry.action === "KEEP" || entry.action === "SKIP" || entry.action === "WRITE_METADATA") {
        continue;
      }

      if (entry.action === "DOWNLOAD" || entry.action === "REPAIR") {
        const n = await downloadRuntimeEntry(engine, entry, opts.signal);
        downloadedFiles += 1;
        downloadedBytes += n.size;
        temps.push(n.tempPath);
        const abs = runtimeAbsolute(paths, entry.relativePath);
        await mkdir(path.dirname(abs), { recursive: true });
        await replaceFile(n.tempPath, abs);
        temps.pop();
        continue;
      }

      if (entry.action === "EXTRACT_NATIVE") {
        const abs = runtimeAbsolute(paths, entry.relativePath);
        const zipBytes = await readFile(abs);
        const dest = paths.nativesDir(mc, fabric);
        opts.emitter?.emit("NATIVES_EXTRACTION_STARTED", { id: entry.id });
        await extractZipSecure({
          zipBytes,
          destRoot: dest,
          ...(entry.extractExclude ? { excludePrefixes: entry.extractExclude } : {})
        });
        opts.emitter?.emit("NATIVES_EXTRACTION_COMPLETE", { id: entry.id });
      }
    }
  } finally {
    for (const t of temps) {
      await cleanupTemp(t);
    }
  }

  opts.emitter?.emit("RUNTIME_READY", {
    minecraftVersion: plan.minecraftVersion,
    fabricLoaderVersion: plan.fabricLoaderVersion,
    downloadedFiles
  });

  return { plan, downloadedFiles, downloadedBytes };
}

async function downloadRuntimeEntry(
  engine: DownloadEngine,
  entry: RuntimePlanEntry,
  signal?: AbortSignal
): Promise<{ tempPath: string; size: number }> {
  if (!entry.url || !entry.integrity) {
    throw new LauncherError(ErrorCode.INTERNAL_ERROR, "runtime plan entry missing url/integrity", {
      id: entry.id
    });
  }
  // undefined / omitted expectedSize → -1 (digest-only; Maven may omit size)
  const expectedSize = typeof entry.expectedSize === "number" ? entry.expectedSize : -1;
  const result = await engine.download(
    {
      id: entry.id,
      url: entry.url,
      integrity: entry.integrity,
      expectedSize,
      maxBytes: Math.max(expectedSize > 0 ? expectedSize : 0, 64 * 1024 * 1024),
      timeoutMs: 120_000,
      targetPath: entry.relativePath
    },
    signal
  );
  return { tempPath: result.tempPath, size: result.size };
}
