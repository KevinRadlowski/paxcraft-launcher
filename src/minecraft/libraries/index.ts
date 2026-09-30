import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { PlatformInfo } from "../../platform/index.js";
import { evaluateRules } from "../rules/index.js";
import {
  assertSafeLibraryPath,
  artifactIntegrity,
  type MinecraftArtifactDownload,
  type MinecraftLibrary
} from "../metadata/types.js";
import type { IntegrityExpectation } from "../integrity/index.js";
import { sha1Integrity, sha256Integrity } from "../integrity/index.js";
import { joinMavenArtifactUrl, mavenNameToPath } from "./maven.js";

export interface ResolvedLibraryArtifact {
  name: string;
  kind: "artifact" | "native";
  classifier?: string;
  path: string;
  download: MinecraftArtifactDownload;
  integrity: IntegrityExpectation;
  extractExclude: string[];
  /**
   * When true, `integrity`/`size` are incomplete placeholders — must call
   * `ensureMavenSidecarIntegrity` before download planning.
   */
  needsMavenSidecar?: boolean;
}

/**
 * Select libraries applicable to platform, including natives classifiers.
 *
 * Supports:
 * A) Mojang-style `downloads.artifact`
 * B) Fabric Maven-style `name` + `mavenUrl` (optional inline sha1/sha256/size)
 *
 * Maven libraries without inline digests are retained with `needsMavenSidecar: true`
 * (fail-closed later via sidecar fetch — never silently skipped).
 */
export function resolveLibrariesForPlatform(
  libraries: MinecraftLibrary[],
  platform: PlatformInfo
): ResolvedLibraryArtifact[] {
  const out: ResolvedLibraryArtifact[] = [];
  for (const lib of libraries) {
    let allowed: boolean;
    try {
      allowed = evaluateRules(lib.rules, { platform });
    } catch (e) {
      if (LauncherError.isLauncherError(e) && e.code === ErrorCode.LIBRARY_RULE_UNSUPPORTED) {
        throw e;
      }
      throw e;
    }
    if (!allowed) continue;

    if (lib.downloads?.artifact) {
      const path = lib.downloads.artifact.path ?? mavenNameToPath(lib.name);
      assertSafeLibraryPath(path);
      out.push({
        name: lib.name,
        kind: "artifact",
        path,
        download: lib.downloads.artifact,
        integrity: artifactIntegrity(lib.downloads.artifact),
        extractExclude: []
      });
    } else if (lib.mavenUrl) {
      out.push(resolveMavenStyleLibrary(lib));
    }
    // else: neither Mojang artifact nor Maven url — skip (vanilla stubs / incomplete entries)

    if (lib.natives && platform.minecraftOsName) {
      const classifierTemplate = lib.natives[platform.minecraftOsName];
      if (classifierTemplate && lib.downloads?.classifiers) {
        const classifier = classifierTemplate.replace("${arch}", platformArchToken(platform));
        const nativeArt = lib.downloads.classifiers[classifier];
        if (!nativeArt) {
          throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "native classifier download missing", {
            name: lib.name,
            classifier
          });
        }
        const path = nativeArt.path ?? mavenNameToPath(lib.name, classifier);
        assertSafeLibraryPath(path);
        out.push({
          name: lib.name,
          kind: "native",
          classifier,
          path,
          download: nativeArt,
          integrity: artifactIntegrity(nativeArt),
          extractExclude: lib.extract?.exclude ?? ["META-INF/"]
        });
      }
    }
  }
  return out;
}

function resolveMavenStyleLibrary(lib: MinecraftLibrary): ResolvedLibraryArtifact {
  const repo = lib.mavenUrl;
  if (!repo) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, "maven library missing url", {
      name: lib.name
    });
  }
  const path = mavenNameToPath(lib.name);
  const url = joinMavenArtifactUrl(repo, path);
  const size = typeof lib.mavenSize === "number" ? lib.mavenSize : -1;

  if (lib.mavenSha256) {
    const integrity = sha256Integrity(lib.mavenSha256);
    return {
      name: lib.name,
      kind: "artifact",
      path,
      download: {
        url,
        size: size >= 0 ? size : -1,
        sha1: lib.mavenSha1 ?? ""
      },
      integrity,
      extractExclude: []
    };
  }
  if (lib.mavenSha1) {
    const integrity = sha1Integrity(lib.mavenSha1);
    return {
      name: lib.name,
      kind: "artifact",
      path,
      download: {
        url,
        size: size >= 0 ? size : -1,
        sha1: integrity.digest
      },
      integrity,
      extractExclude: []
    };
  }

  // No inline digest — require Maven sidecar before download (fail-closed in plan).
  return {
    name: lib.name,
    kind: "artifact",
    path,
    download: { url, size: size >= 0 ? size : -1, sha1: "" },
    // Placeholder replaced by ensureMavenSidecarIntegrity; never used for verification as-is.
    integrity: sha1Integrity("0000000000000000000000000000000000000000"),
    extractExclude: [],
    needsMavenSidecar: true
  };
}

function platformArchToken(platform: PlatformInfo): string {
  if (platform.arch === "x64") return "64";
  if (platform.arch === "x86") return "32";
  if (platform.arch === "arm64") return "arm64";
  return platform.arch;
}

export { mavenNameToPath, joinMavenArtifactUrl, parseMavenCoordinate } from "./maven.js";
