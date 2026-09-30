/**
 * Fabric / Maven-style library URL + coordinate helpers (0.3A runtime).
 * Coordinates: group:artifact:version[:classifier]
 */

import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { assertSafeLibraryPath } from "../metadata/types.js";

const MAVEN_SEGMENT = /^[A-Za-z0-9._+-]+$/;

export interface MavenCoordinate {
  readonly group: string;
  readonly artifact: string;
  readonly version: string;
  readonly classifier?: string;
}

/** Parse group:artifact:version[:classifier] with strict segment validation. */
export function parseMavenCoordinate(name: string): MavenCoordinate {
  const parts = name.split(":");
  if (parts.length < 3 || parts.length > 4) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `invalid maven name: ${name}`);
  }
  const [group, artifact, version, classifier] = parts as [string, string, string, string?];
  for (const [label, seg] of [
    ["group", group],
    ["artifact", artifact],
    ["version", version],
    ...(classifier ? [["classifier", classifier] as const] : [])
  ] as const) {
    if (!seg || !MAVEN_SEGMENT.test(seg) || seg.includes("..")) {
      throw new LauncherError(ErrorCode.UNSAFE_PATH, `unsafe maven ${label}: ${seg ?? ""}`);
    }
  }
  const out: MavenCoordinate =
    classifier !== undefined
      ? { group: group!, artifact: artifact!, version: version!, classifier }
      : { group: group!, artifact: artifact!, version: version! };
  return out;
}

/** group:artifact:version[:classifier] → group/artifact/version/artifact-version[-classifier].jar */
export function mavenNameToPath(name: string, classifier?: string): string {
  const coord = parseMavenCoordinate(name);
  const cls = classifier ?? coord.classifier;
  if (cls && (!MAVEN_SEGMENT.test(cls) || cls.includes(".."))) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `unsafe maven classifier: ${cls}`);
  }
  const groupPath = coord.group.replace(/\./g, "/");
  const file = cls
    ? `${coord.artifact}-${coord.version}-${cls}.jar`
    : `${coord.artifact}-${coord.version}.jar`;
  const path = `${groupPath}/${coord.artifact}/${coord.version}/${file}`;
  assertSafeLibraryPath(path);
  return path;
}

/**
 * Join HTTPS Maven repository base + relative artifact path.
 * Rejects non-HTTPS, traversal, and absolute/relative escapes.
 */
export function joinMavenArtifactUrl(repositoryBase: string, relativePath: string): string {
  assertSafeLibraryPath(relativePath);
  let base: URL;
  try {
    base = new URL(repositoryBase);
  } catch {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `invalid maven repository URL`, {
      url: repositoryBase
    });
  }
  if (base.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "Maven repository URL must be HTTPS", {
      url: repositoryBase
    });
  }
  if (base.username || base.password) {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "Maven repository URL must not include credentials", {
      url: repositoryBase
    });
  }
  // Normalize base with trailing slash for URL resolution.
  const baseHref = base.href.endsWith("/") ? base.href : `${base.href}/`;
  let resolved: URL;
  try {
    resolved = new URL(relativePath, baseHref);
  } catch {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "invalid maven artifact URL join", {
      repositoryBase,
      relativePath
    });
  }
  if (resolved.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "Maven artifact URL must be HTTPS", {
      url: resolved.href
    });
  }
  // Ensure resolved path stays under repository origin + base path (no .. escape).
  if (resolved.origin !== base.origin) {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "Maven artifact URL escaped repository origin", {
      url: resolved.href
    });
  }
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (!resolved.pathname.startsWith(basePath) && resolved.pathname !== base.pathname.replace(/\/$/, "")) {
    // Allow when base path is "/" 
    if (basePath !== "/" && !resolved.pathname.startsWith(basePath)) {
      throw new LauncherError(ErrorCode.UNSAFE_PATH, "Maven artifact path escaped repository base", {
        url: resolved.href
      });
    }
  }
  if (resolved.pathname.includes("..")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "Maven artifact URL contains traversal", {
      url: resolved.href
    });
  }
  return resolved.href;
}

/** Sidecar digest URL for an artifact (e.g. .sha256 / .sha1). */
export function mavenDigestSidecarUrl(artifactUrl: string, algo: "sha256" | "sha1"): string {
  let u: URL;
  try {
    u = new URL(artifactUrl);
  } catch {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "invalid artifact URL for sidecar", {
      url: artifactUrl
    });
  }
  if (u.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "Maven sidecar URL must be HTTPS", {
      url: artifactUrl
    });
  }
  return `${artifactUrl}.${algo}`;
}

/**
 * Parse Maven checksum sidecar body (hex digest, optionally followed by filename).
 * Fail closed on empty / malformed.
 */
export function parseMavenChecksumSidecar(body: string, algo: "sha256" | "sha1"): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new LauncherError(ErrorCode.DOWNLOAD_HASH_MISMATCH, "empty maven checksum sidecar", { algo });
  }
  const token = trimmed.split(/\s+/)[0] ?? "";
  const re = algo === "sha256" ? /^[a-fA-F0-9]{64}$/ : /^[a-fA-F0-9]{40}$/;
  if (!re.test(token)) {
    throw new LauncherError(ErrorCode.DOWNLOAD_HASH_MISMATCH, "malformed maven checksum sidecar", {
      algo,
      token: token.slice(0, 16)
    });
  }
  return token.toLowerCase();
}
