import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { ReleaseChannelName } from "../../core/channel/index.js";

export const DEFAULT_PRODUCT_BASE = "https://cdn.xnosweet.fr/sweetcraft";

/** Normalize and validate a product CDN base URL (HTTPS, no credentials/query/fragment). */
export function normalizeProductBase(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new LauncherError(ErrorCode.NETWORK_ERROR, `invalid product base URL: ${origin}`);
  }
  if (url.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "product base must be HTTPS");
  }
  if (url.username || url.password) {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "product base must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "product base must not contain query/fragment");
  }
  return url.toString().replace(/\/+$/, "");
}

export function channelUrl(productBase: string, channel: ReleaseChannelName): string {
  const base = normalizeProductBase(productBase);
  return `${base}/channels/${channel}.json`;
}

/** Build absolute HTTPS URL from product base + relative POSIX path (no traversal). */
export function joinProductUrl(productBase: string, relativePath: string): string {
  const base = normalizeProductBase(productBase);
  const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel.includes("..") || rel.includes("\0") || rel.includes("\\")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `unsafe relative URL path: ${relativePath}`, {
      path: relativePath
    });
  }
  return `${base}/${rel}`;
}

export function releaseDirectoryUrl(productBase: string, packVersion: string): string {
  if (!packVersion || packVersion.includes("/") || packVersion.includes("..") || packVersion.includes("\\")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `unsafe packVersion for URL: ${packVersion}`);
  }
  return joinProductUrl(productBase, `releases/${packVersion}`);
}

export function clientManifestUrl(productBase: string, packVersion: string): string {
  return `${releaseDirectoryUrl(productBase, packVersion)}/client-manifest.json`;
}
