import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { ManifestMod } from "../../core/manifest/index.js";
import { RELEASE_FILES_BASE } from "../../core/release/index.js";
import { joinProductUrl, normalizeProductBase } from "../../distribution/urls/index.js";
import type { DownloadRequest } from "../engine/types.js";

export const DEFAULT_MOD_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_CDN_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Resolve exact download URLs from a trusted manifest — never "latest".
 * Providers: modrinth | curseforge | github-releases (and author_* types with url).
 */
export class ProviderResolver {
  resolveModDownload(mod: ManifestMod): DownloadRequest {
    const url = mod.provider.url;
    if (typeof url !== "string" || !url) {
      throw new LauncherError(ErrorCode.PROVIDER_URL_MISSING, `mod ${mod.id} missing provider.url`, {
        modId: mod.id,
        providerType: mod.provider.type
      });
    }
    assertHttps(url);
    const type = mod.provider.type;
    if (
      type !== "modrinth" &&
      type !== "curseforge" &&
      type !== "github-releases" &&
      type !== "pending" &&
      !type.startsWith("github")
    ) {
      // Allow other author providers that still carry an explicit URL — URL is truth.
      // pending with null url already rejected above.
    }
    if (type === "pending") {
      throw new LauncherError(ErrorCode.PROVIDER_UNSUPPORTED, `pending provider cannot download`, {
        modId: mod.id
      });
    }

    return {
      id: `mod:${mod.id}`,
      url,
      expectedSha256: mod.sha256,
      expectedSize: mod.size,
      maxBytes: Math.max(mod.size, DEFAULT_MOD_MAX_BYTES),
      timeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
      targetPath: `mods/${mod.file}`
    };
  }

  /**
   * CDN release file URL: productBase/releases/<packVersion>/files/<relativePosix>
   * relativePosix already validated (config/... or resourcepacks/...).
   */
  resolveCdnFile(opts: {
    productBase: string;
    packVersion: string;
    relativeUnderFiles: string;
    expectedSha256: string;
    expectedSize: number;
    id: string;
    targetPath: string;
  }): DownloadRequest {
    const base = normalizeProductBase(opts.productBase);
    const rel = opts.relativeUnderFiles.replace(/\\/g, "/").replace(/^\/+/, "");
    if (rel.includes("..") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) {
      throw new LauncherError(ErrorCode.UNSAFE_PATH, "unsafe CDN relative path", { path: rel });
    }
    const configBase = RELEASE_FILES_BASE.replace(/\/?$/, "/");
    const url = joinProductUrl(base, `releases/${opts.packVersion}/${configBase}${rel}`);
    assertHttps(url);
    return {
      id: opts.id,
      url,
      expectedSha256: opts.expectedSha256,
      expectedSize: opts.expectedSize,
      maxBytes: Math.max(opts.expectedSize, DEFAULT_CDN_FILE_MAX_BYTES),
      timeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
      targetPath: opts.targetPath
    };
  }
}

function assertHttps(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.PROVIDER_URL_MISSING, `invalid URL: ${url}`);
  }
  if (u.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "provider URL must be HTTPS", { url });
  }
}
