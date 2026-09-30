/**
 * Fail-closed Maven sidecar integrity for Fabric libraries lacking inline digests.
 */

import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { FetchedMetadata } from "../metadata/bytes.js";
import { sha1Integrity, sha256Integrity } from "../integrity/index.js";
import type { ResolvedLibraryArtifact } from "./index.js";
import { mavenDigestSidecarUrl, parseMavenChecksumSidecar } from "./maven.js";

export type MavenSidecarFetch = (url: string) => Promise<FetchedMetadata>;

/**
 * For each library with `needsMavenSidecar`, fetch `.sha256` then `.sha1` from the
 * same HTTPS artifact URL. Prefer SHA-256. Fail closed on missing/malformed sidecars.
 */
export async function ensureMavenSidecarIntegrity(
  libraries: readonly ResolvedLibraryArtifact[],
  fetchBytes: MavenSidecarFetch
): Promise<ResolvedLibraryArtifact[]> {
  const out: ResolvedLibraryArtifact[] = [];
  for (const lib of libraries) {
    if (!lib.needsMavenSidecar) {
      out.push(lib);
      continue;
    }
    const enriched = await fetchSidecarForArtifact(lib, fetchBytes);
    out.push(enriched);
  }
  return out;
}

async function fetchSidecarForArtifact(
  lib: ResolvedLibraryArtifact,
  fetchBytes: MavenSidecarFetch
): Promise<ResolvedLibraryArtifact> {
  const artifactUrl = lib.download.url;

  // Prefer SHA-256 sidecar.
  try {
    const sha256Url = mavenDigestSidecarUrl(artifactUrl, "sha256");
    const fetched = await fetchBytes(sha256Url);
    const digest = parseMavenChecksumSidecar(bytesToUtf8(fetched.bytes), "sha256");
    return {
      name: lib.name,
      kind: lib.kind,
      ...(lib.classifier ? { classifier: lib.classifier } : {}),
      path: lib.path,
      download: {
        url: artifactUrl,
        size: lib.download.size,
        sha1: lib.download.sha1 || ""
      },
      integrity: sha256Integrity(digest),
      extractExclude: lib.extractExclude
    };
  } catch (e) {
    if (!isRetriableSidecarMiss(e)) throw e;
  }

  // Fall back to SHA-1 sidecar.
  try {
    const sha1Url = mavenDigestSidecarUrl(artifactUrl, "sha1");
    const fetched = await fetchBytes(sha1Url);
    const digest = parseMavenChecksumSidecar(bytesToUtf8(fetched.bytes), "sha1");
    return {
      name: lib.name,
      kind: lib.kind,
      ...(lib.classifier ? { classifier: lib.classifier } : {}),
      path: lib.path,
      download: {
        url: artifactUrl,
        size: lib.download.size,
        sha1: digest
      },
      integrity: sha1Integrity(digest),
      extractExclude: lib.extractExclude
    };
  } catch (e) {
    if (LauncherError.isLauncherError(e)) {
      throw new LauncherError(
        ErrorCode.DOWNLOAD_HASH_MISMATCH,
        "Maven library missing usable checksum sidecar (sha256/sha1)",
        { name: lib.name, url: artifactUrl, cause: e.code }
      );
    }
    throw new LauncherError(
      ErrorCode.DOWNLOAD_HASH_MISMATCH,
      "Maven library missing usable checksum sidecar (sha256/sha1)",
      { name: lib.name, url: artifactUrl }
    );
  }
}

function isRetriableSidecarMiss(e: unknown): boolean {
  if (!LauncherError.isLauncherError(e)) return true;
  // HTTP/network miss → try next algo; malformed digest is fail-closed immediately.
  return (
    e.code === ErrorCode.HTTP_ERROR ||
    e.code === ErrorCode.NETWORK_ERROR ||
    e.code === ErrorCode.HTTP_TIMEOUT ||
    e.code === ErrorCode.DOWNLOAD_FAILED
  );
}

function bytesToUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}
