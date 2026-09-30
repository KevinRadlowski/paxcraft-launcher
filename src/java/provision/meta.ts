/**
 * Persisted metadata for an activated managed Java runtime.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../../download/fs/index.js";
import type { ManagedJavaArtifact } from "../provider/adoptium.js";

export const MANAGED_JAVA_META_FILENAME = ".sweetcraft-managed-java.json";

export interface ManagedJavaRuntimeMeta {
  readonly schemaVersion: 1;
  readonly provider: string;
  readonly distribution: string;
  readonly majorVersion: number;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly identity: string;
  /** Relative to runtime identity root, POSIX separators. */
  readonly javaRelativePath: string;
  readonly archiveSha256: string;
  readonly archiveSizeBytes: number;
  readonly activatedAt: string;
}

export function managedJavaMetaPath(runtimeDir: string): string {
  return path.join(runtimeDir, MANAGED_JAVA_META_FILENAME);
}

export async function writeManagedJavaMeta(
  runtimeDir: string,
  meta: ManagedJavaRuntimeMeta
): Promise<void> {
  await writeFileAtomic(managedJavaMetaPath(runtimeDir), JSON.stringify(meta, null, 2) + "\n");
}

export async function readManagedJavaMeta(
  runtimeDir: string
): Promise<ManagedJavaRuntimeMeta | null> {
  try {
    const raw = JSON.parse(await readFile(managedJavaMetaPath(runtimeDir), "utf8")) as ManagedJavaRuntimeMeta;
    if (raw?.schemaVersion !== 1 || typeof raw.identity !== "string") return null;
    if (typeof raw.majorVersion !== "number" || typeof raw.javaRelativePath !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

export function metaFromArtifact(
  artifact: ManagedJavaArtifact,
  javaRelativePath: string
): ManagedJavaRuntimeMeta {
  return {
    schemaVersion: 1,
    provider: artifact.provider,
    distribution: artifact.distribution,
    majorVersion: artifact.majorVersion,
    version: artifact.version,
    os: artifact.os,
    arch: artifact.arch,
    identity: artifact.identity,
    javaRelativePath: javaRelativePath.replace(/\\/g, "/"),
    archiveSha256: artifact.sha256,
    archiveSizeBytes: artifact.sizeBytes,
    activatedAt: new Date().toISOString()
  };
}
