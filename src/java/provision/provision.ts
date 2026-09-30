/**
 * Managed Java provisioning — download, verify, extract, activate.
 */

import { access, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { HttpClient } from "../../distribution/http/index.js";
import { DownloadEngine } from "../../download/engine/index.js";
import type { ByteSource } from "../../download/engine/types.js";
import { FetchByteSource } from "../../download/engine/sources.js";
import { cleanupTemp, ensureDir, replaceFile } from "../../download/fs/index.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import { isPathInside } from "../../instance/security/index.js";
import { extractZipSecure } from "../../minecraft/natives/index.js";
import { RuntimePaths } from "../../minecraft/runtime/paths.js";
import { probeJavaBinary, type DiscoveredJava, type JavaRequirement } from "../discovery/index.js";
import {
  resolveAdoptiumTemurinJdk,
  type ManagedJavaArtifact,
  type ManagedJavaArtifactRequest
} from "../provider/adoptium.js";
import {
  acquireJavaProvisionLock,
  releaseJavaProvisionLock,
  type JavaProvisionLockLease
} from "./lock.js";
import { metaFromArtifact, readManagedJavaMeta, writeManagedJavaMeta } from "./meta.js";

export type JavaProvisionPhase =
  | "CHECKING_JAVA"
  | "RESOLVING_JAVA_PROVIDER"
  | "DOWNLOADING_JAVA"
  | "VERIFYING_JAVA"
  | "EXTRACTING_JAVA"
  | "INSTALLING_JAVA"
  | "JAVA_READY";

export interface ProvisionManagedJavaOptions {
  readonly runtimeRoot: string;
  readonly requirement: JavaRequirement;
  readonly http: HttpClient;
  readonly byteSource?: ByteSource;
  readonly emitter?: ProgressEmitter;
  readonly signal?: AbortSignal;
  readonly forceStaleLock?: boolean;
  /** Inject resolved artifact (tests) — skips live provider metadata. */
  readonly artifactOverride?: ManagedJavaArtifact;
  /** Max archive bytes (default 512 MiB). */
  readonly maxArchiveBytes?: number;
}

export interface ProvisionManagedJavaResult {
  readonly artifact: ManagedJavaArtifact;
  readonly runtimeDir: string;
  readonly javaPath: string;
  readonly discovered: DiscoveredJava;
  readonly reusedExisting: boolean;
}

function emitPhase(
  emitter: ProgressEmitter | undefined,
  phase: JavaProvisionPhase,
  data: Record<string, unknown> = {}
): void {
  emitter?.emit("PLAY_PROGRESS", { phase, ...data });
  emitter?.emit("OPERATION_PROGRESS", { phase, operation: "java-provision", ...data });
}

function javaBinaryName(): string {
  return process.platform === "win32" ? "java.exe" : "java";
}

/**
 * Locate bin/java(.exe) under an extracted JDK tree (single top-level folder typical).
 */
export async function findExtractedJavaBinary(root: string): Promise<{
  javaPath: string;
  relativePath: string;
}> {
  const rootResolved = path.resolve(root);
  const want = javaBinaryName();

  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > 6) return null;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (!isPathInside(rootResolved, full)) continue;
      if (e.isFile() && e.name === want) {
        const parent = path.basename(path.dirname(full));
        if (parent === "bin") return full;
      }
      if (e.isDirectory() && !e.name.startsWith(".")) {
        const hit = await walk(full, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  const direct = path.join(rootResolved, "bin", want);
  try {
    await access(direct);
    return { javaPath: direct, relativePath: path.join("bin", want).replace(/\\/g, "/") };
  } catch {
    // continue
  }

  const found = await walk(rootResolved, 0);
  if (!found) {
    throw new LauncherError(ErrorCode.JAVA_EXECUTABLE_MISSING, "java executable missing after extraction", {
      root: path.basename(rootResolved)
    });
  }
  const relativePath = path.relative(rootResolved, found).replace(/\\/g, "/");
  if (relativePath.includes("..")) {
    throw new LauncherError(ErrorCode.JAVA_ARCHIVE_UNSAFE, "resolved java path escaped staging root", {});
  }
  return { javaPath: found, relativePath };
}

export async function readExistingManagedJava(
  runtimeRoot: string,
  requirement: JavaRequirement
): Promise<{ java: DiscoveredJava; runtimeDir: string } | null> {
  const paths = new RuntimePaths(runtimeRoot);
  const runtimesDir = paths.javaRuntimesDir();
  let entries: string[];
  try {
    entries = await readdir(runtimesDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const runtimeDir = path.join(runtimesDir, name);
    const meta = await readManagedJavaMeta(runtimeDir);
    if (!meta) continue;
    if (meta.majorVersion < requirement.majorVersion) continue;
    const javaPath = path.join(runtimeDir, ...meta.javaRelativePath.split("/"));
    if (!isPathInside(runtimeDir, javaPath)) continue;
    try {
      const probed = await probeJavaBinary(javaPath);
      if (probed.majorVersion < requirement.majorVersion) continue;
      return { java: { ...probed, source: "managed" }, runtimeDir };
    } catch {
      continue;
    }
  }
  return null;
}

async function extractZipFileSecure(archivePath: string, destRoot: string): Promise<void> {
  const st = await stat(archivePath);
  // Cap in-memory unzip (Temurin JDK zip ~200MB). Reject absurd sizes.
  const max = 512 * 1024 * 1024;
  if (st.size > max) {
    throw new LauncherError(ErrorCode.JAVA_EXTRACTION_FAILED, "Java archive too large to extract safely", {
      size: st.size
    });
  }
  const zipBytes = await readFile(archivePath);
  try {
    await extractZipSecure({ zipBytes, destRoot, excludePrefixes: ["META-INF/"] });
  } catch (e) {
    if (LauncherError.isLauncherError(e)) {
      if (e.code === ErrorCode.ZIP_SLIP_REFUSED) {
        throw new LauncherError(ErrorCode.JAVA_ARCHIVE_UNSAFE, e.message, e.details);
      }
      throw new LauncherError(ErrorCode.JAVA_EXTRACTION_FAILED, e.message, {
        causeCode: e.code
      });
    }
    throw new LauncherError(ErrorCode.JAVA_EXTRACTION_FAILED, "Java archive extraction failed", {});
  }
}

async function activateRuntimeDir(stagingDir: string, finalDir: string): Promise<void> {
  await ensureDir(path.dirname(finalDir));
  const retired = `${finalDir}.retired.${process.pid}.${Date.now()}`;
  try {
    await access(finalDir);
    // Keep previous until new is renamed into place.
    await rename(finalDir, retired);
  } catch {
    // final absent
  }
  try {
    await rename(stagingDir, finalDir);
  } catch (e) {
    // Best-effort restore previous
    try {
      await access(retired);
      await rename(retired, finalDir);
    } catch {
      // ignore
    }
    throw new LauncherError(ErrorCode.JAVA_PROVISION_FS_ERROR, "failed to activate managed Java runtime", {
      errno: (e as NodeJS.ErrnoException).code
    });
  }
  await rm(retired, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Provision (or reuse) a managed Temurin JDK satisfying requirement.majorVersion.
 */
export async function provisionManagedJava(
  opts: ProvisionManagedJavaOptions
): Promise<ProvisionManagedJavaResult> {
  const paths = new RuntimePaths(opts.runtimeRoot);
  const runtimesDir = paths.javaRuntimesDir();
  const tmpDir = path.join(paths.tmpDir(), "java");
  await ensureDir(runtimesDir);
  await ensureDir(tmpDir);

  emitPhase(opts.emitter, "CHECKING_JAVA");
  const existing = await readExistingManagedJava(opts.runtimeRoot, opts.requirement);
  if (existing) {
    emitPhase(opts.emitter, "JAVA_READY", { reused: true });
    return {
      artifact: opts.artifactOverride ?? {
        provider: "adoptium",
        distribution: "temurin",
        majorVersion: existing.java.majorVersion,
        version: existing.java.versionString,
        os: "windows",
        arch: "x64",
        downloadUrl: "https://api.adoptium.net/",
        sha256: "0".repeat(64),
        sizeBytes: 0,
        archiveName: "reused",
        archiveType: "zip",
        identity: path.basename(existing.runtimeDir)
      },
      runtimeDir: existing.runtimeDir,
      javaPath: existing.java.javaPath,
      discovered: existing.java,
      reusedExisting: true
    };
  }

  emitPhase(opts.emitter, "RESOLVING_JAVA_PROVIDER");
  const request: ManagedJavaArtifactRequest = {
    majorVersion: opts.requirement.majorVersion,
    os: "windows",
    arch: "x64",
    releaseType: "ga"
  };
  const artifact =
    opts.artifactOverride ??
    (await resolveAdoptiumTemurinJdk({
      http: opts.http,
      request,
      ...(opts.signal ? { signal: opts.signal } : {})
    }));

  let lease: JavaProvisionLockLease | null = null;
  try {
    lease = await acquireJavaProvisionLock(runtimesDir, artifact.identity, {
      forceStale: opts.forceStaleLock === true
    });

    // Re-check after lock — another process may have finished.
    const again = await readExistingManagedJava(opts.runtimeRoot, opts.requirement);
    if (again) {
      emitPhase(opts.emitter, "JAVA_READY", { reused: true });
      return {
        artifact,
        runtimeDir: again.runtimeDir,
        javaPath: again.java.javaPath,
        discovered: again.java,
        reusedExisting: true
      };
    }

    const finalDir = path.join(runtimesDir, artifact.identity);
    const stagingDir = path.join(runtimesDir, ".staging", `${artifact.identity}.${lease.leaseId}`);
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(stagingDir, { recursive: true });

    const archivePath = path.join(tmpDir, `${artifact.identity}.${lease.leaseId}.zip`);
    await cleanupTemp(archivePath).catch(() => undefined);

    emitPhase(opts.emitter, "DOWNLOADING_JAVA", {
      identity: artifact.identity,
      version: artifact.version,
      expectedBytes: artifact.sizeBytes
    });

    const source = opts.byteSource ?? new FetchByteSource();
    const engine = new DownloadEngine({
      source,
      tmpDir,
      ...(opts.emitter ? { emitter: opts.emitter } : {}),
      maxRetries: 2
    });

    try {
      const downloaded = await engine.download(
        {
          id: `java-${artifact.identity}`,
          url: artifact.downloadUrl,
          targetPath: archivePath,
          expectedSha256: artifact.sha256,
          expectedSize: artifact.sizeBytes,
          maxBytes: opts.maxArchiveBytes ?? 512 * 1024 * 1024,
          timeoutMs: 600_000
        },
        opts.signal
      );
      await ensureDir(path.dirname(archivePath));
      await replaceFile(downloaded.tempPath, archivePath);
    } catch (e) {
      if (LauncherError.isLauncherError(e)) {
        if (e.code === ErrorCode.DOWNLOAD_HASH_MISMATCH) {
          throw new LauncherError(ErrorCode.JAVA_HASH_MISMATCH, "managed Java archive hash mismatch", e.details);
        }
        if (
          e.code === ErrorCode.DOWNLOAD_FAILED ||
          e.code === ErrorCode.NETWORK_ERROR ||
          e.code === ErrorCode.HTTP_ERROR ||
          e.code === ErrorCode.HTTP_TIMEOUT ||
          e.code === ErrorCode.DOWNLOAD_SIZE_MISMATCH
        ) {
          throw new LauncherError(ErrorCode.JAVA_DOWNLOAD_FAILED, "managed Java download failed", {
            causeCode: e.code
          });
        }
        throw e;
      }
      throw new LauncherError(ErrorCode.JAVA_DOWNLOAD_FAILED, "managed Java download failed", {});
    }

    emitPhase(opts.emitter, "VERIFYING_JAVA", { sha256: artifact.sha256 });
    // DownloadEngine already verified hash before exposing targetPath.

    emitPhase(opts.emitter, "EXTRACTING_JAVA", { identity: artifact.identity });
    await extractZipFileSecure(archivePath, stagingDir);

    const located = await findExtractedJavaBinary(stagingDir);
    let discovered: DiscoveredJava;
    try {
      discovered = await probeJavaBinary(located.javaPath);
    } catch (e) {
      throw new LauncherError(
        ErrorCode.JAVA_PROVISIONED_INCOMPATIBLE,
        "provisioned Java failed version probe",
        { cause: e instanceof Error ? e.message : String(e) }
      );
    }
    if (discovered.majorVersion < opts.requirement.majorVersion) {
      throw new LauncherError(
        ErrorCode.JAVA_PROVISIONED_INCOMPATIBLE,
        "provisioned Java major below requirement",
        {
          required: opts.requirement.majorVersion,
          found: discovered.majorVersion
        }
      );
    }

    await writeManagedJavaMeta(stagingDir, metaFromArtifact(artifact, located.relativePath));

    emitPhase(opts.emitter, "INSTALLING_JAVA", { identity: artifact.identity });
    await activateRuntimeDir(stagingDir, finalDir);

    const activeJava = path.join(finalDir, ...located.relativePath.split("/"));
    const finalProbe = await probeJavaBinary(activeJava);
    await cleanupTemp(archivePath).catch(() => undefined);
    await rm(path.join(runtimesDir, ".staging"), { recursive: true, force: true }).catch(() => undefined);

    emitPhase(opts.emitter, "JAVA_READY", {
      identity: artifact.identity,
      majorVersion: finalProbe.majorVersion,
      version: finalProbe.versionString
    });

    return {
      artifact,
      runtimeDir: finalDir,
      javaPath: activeJava,
      discovered: { ...finalProbe, source: "managed" },
      reusedExisting: false
    };
  } finally {
    if (lease) {
      await releaseJavaProvisionLock(lease).catch(() => undefined);
    }
  }
}
