/**
 * Eclipse Temurin (Adoptium) provider metadata resolver.
 * HTTPS + machine-readable API only — no HTML scraping.
 */

import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { HttpClient } from "../../distribution/http/index.js";

export const ADOPTIUM_PROVIDER_ID = "adoptium" as const;
export const ADOPTIUM_DISTRIBUTION = "temurin" as const;
export const ADOPTIUM_API_BASE = "https://api.adoptium.net";

export type ManagedJavaOs = "windows";
export type ManagedJavaArch = "x64";

export interface ManagedJavaArtifactRequest {
  readonly majorVersion: number;
  readonly os: ManagedJavaOs;
  readonly arch: ManagedJavaArch;
  /** GA release type (production). */
  readonly releaseType?: "ga";
}

export interface ManagedJavaArtifact {
  readonly provider: typeof ADOPTIUM_PROVIDER_ID;
  readonly distribution: typeof ADOPTIUM_DISTRIBUTION;
  readonly majorVersion: number;
  readonly version: string;
  readonly os: ManagedJavaOs;
  readonly arch: ManagedJavaArch;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly archiveName: string;
  readonly archiveType: "zip";
  /** Stable install identity under java/runtimes/<identity>/ */
  readonly identity: string;
}

interface AdoptiumPackage {
  readonly link?: string;
  readonly name?: string;
  readonly checksum?: string;
  readonly size?: number;
}

interface AdoptiumBinary {
  readonly os?: string;
  readonly architecture?: string;
  readonly image_type?: string;
  readonly package?: AdoptiumPackage;
}

interface AdoptiumAsset {
  readonly version_data?: { readonly semver?: string; readonly openjdk_version?: string };
  readonly binaries?: readonly AdoptiumBinary[];
}

function assertHttpsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_METADATA_INVALID, "provider URL is not absolute", {
      url: url.slice(0, 200)
    });
  }
  if (parsed.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "provider download URL must be HTTPS", {
      protocol: parsed.protocol
    });
  }
  return parsed.toString();
}

function normalizeSha256(raw: string): string {
  const hex = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_METADATA_INVALID, "provider checksum is not sha256 hex", {
      checksumPrefix: hex.slice(0, 16)
    });
  }
  return hex;
}

export function managedJavaIdentity(opts: {
  distribution: string;
  majorVersion: number;
  os: string;
  arch: string;
}): string {
  return `${opts.distribution}-${opts.majorVersion}-${opts.os}-${opts.arch}`;
}

/**
 * Resolve the newest GA Temurin JDK ZIP for Windows x64 at the requested major.
 */
export async function resolveAdoptiumTemurinJdk(opts: {
  http: HttpClient;
  request: ManagedJavaArtifactRequest;
  signal?: AbortSignal;
}): Promise<ManagedJavaArtifact> {
  const major = opts.request.majorVersion;
  if (!Number.isInteger(major) || major < 8 || major > 99) {
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_METADATA_INVALID, "invalid Java major for provider", {
      majorVersion: major
    });
  }
  const os = opts.request.os;
  const arch = opts.request.arch;
  if (os !== "windows" || arch !== "x64") {
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_ARTIFACT_MISSING, "unsupported managed Java platform", {
      os,
      arch
    });
  }

  const url =
    `${ADOPTIUM_API_BASE}/v3/assets/feature_releases/${major}/ga` +
    `?architecture=${arch}&heap_size=normal&image_type=jdk&jvm_impl=hotspot` +
    `&os=${os}&project=jdk&vendor=eclipse&page_size=5&sort_order=DESC`;

  let response;
  try {
    response = await opts.http.request({
      url,
      method: "GET",
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 30_000,
      ...(opts.signal ? { signal: opts.signal } : {})
    });
  } catch (e) {
    if (LauncherError.isLauncherError(e)) {
      if (
        e.code === ErrorCode.NETWORK_ERROR ||
        e.code === ErrorCode.HTTP_TIMEOUT ||
        e.code === ErrorCode.HTTP_ERROR
      ) {
        throw new LauncherError(ErrorCode.JAVA_PROVIDER_UNAVAILABLE, "Adoptium metadata unavailable", {
          causeCode: e.code
        });
      }
      throw e;
    }
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_UNAVAILABLE, "Adoptium metadata request failed", {});
  }

  if (response.status !== 200) {
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_UNAVAILABLE, "Adoptium metadata HTTP error", {
      status: response.status
    });
  }

  let assets: unknown;
  try {
    assets = JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_METADATA_INVALID, "Adoptium metadata is not JSON", {});
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new LauncherError(ErrorCode.JAVA_PROVIDER_ARTIFACT_MISSING, "no Adoptium GA assets for major", {
      majorVersion: major
    });
  }

  for (const raw of assets as AdoptiumAsset[]) {
    const version =
      (typeof raw.version_data?.semver === "string" && raw.version_data.semver) ||
      (typeof raw.version_data?.openjdk_version === "string" && raw.version_data.openjdk_version) ||
      "";
    const binaries = Array.isArray(raw.binaries) ? raw.binaries : [];
    for (const bin of binaries) {
      if (bin.os !== os || bin.architecture !== arch || bin.image_type !== "jdk") continue;
      const pkg = bin.package;
      if (!pkg?.link || !pkg.checksum || typeof pkg.size !== "number" || !pkg.name) continue;
      if (!pkg.name.toLowerCase().endsWith(".zip")) continue;
      const downloadUrl = assertHttpsUrl(pkg.link);
      const sha256 = normalizeSha256(pkg.checksum);
      if (!Number.isSafeInteger(pkg.size) || pkg.size <= 0) {
        throw new LauncherError(ErrorCode.JAVA_PROVIDER_METADATA_INVALID, "invalid package size", {});
      }
      return {
        provider: ADOPTIUM_PROVIDER_ID,
        distribution: ADOPTIUM_DISTRIBUTION,
        majorVersion: major,
        version: version || `major-${major}`,
        os,
        arch,
        downloadUrl,
        sha256,
        sizeBytes: pkg.size,
        archiveName: pkg.name,
        archiveType: "zip",
        identity: managedJavaIdentity({
          distribution: ADOPTIUM_DISTRIBUTION,
          majorVersion: major,
          os,
          arch
        })
      };
    }
  }

  throw new LauncherError(
    ErrorCode.JAVA_PROVIDER_ARTIFACT_MISSING,
    "no Windows x64 Temurin JDK ZIP in Adoptium response",
    { majorVersion: major }
  );
}
