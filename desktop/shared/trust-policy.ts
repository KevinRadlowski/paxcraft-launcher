/**
 * Centralized renderer trust policy — used by load target, navigation, and IPC sender checks.
 * Pure / testable (no Electron imports).
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import type { UiError } from "./contract.js";

export type DesktopRuntimeMode = "development" | "production";

export type RendererLoadTarget =
  | { kind: "dev-server"; url: string; origin: string }
  | { kind: "file"; indexHtmlPath: string; entryFileUrl: string; trustedDirUrl: string };

export interface RendererTrustPolicy {
  readonly mode: DesktopRuntimeMode;
  readonly target: RendererLoadTarget;
}

export interface ExternalUrlRule {
  readonly protocol: "https:";
  readonly hostname: string;
  /** Exact port or null = default HTTPS (443). */
  readonly port: string | null;
  /** Path must equal or be under this prefix (always starts with /). */
  readonly pathPrefix: string;
}

/** Structured allowlist — not string-prefix security.
 * PACK-PAX-05: empty until Pax community/support URLs are qualified.
 * Historical SweetCraft hosts are intentionally absent (fail closed).
 */
export const EXTERNAL_URL_RULES: readonly ExternalUrlRule[] = [];

/** Historical destinations blocked for documentation / explicit deny tests (PACK-PAX-05). */
export const HISTORICAL_EXTERNAL_HOSTS: ReadonlySet<string> = Object.freeze(
  new Set([
    "cdn.xnosweet.fr",
    "www.xnosweet.fr",
    "xnosweet.fr",
    "xbase.fr",
    "www.xbase.fr",
    "sweetcraft.datho.st"
  ])
);

/**
 * Parse DESKTOP_DEV_SERVER into a trusted loopback origin.
 * hostname must be exactly 127.0.0.1 or localhost.
 */
export function parseDevServerUrl(raw: string): { url: string; origin: string } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
  if (parsed.port) {
    const n = Number(parsed.port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  }
  const normalized = new URL(parsed.href);
  normalized.hash = "";
  const origin = normalized.origin;
  const pathname = normalized.pathname.endsWith("/") ? normalized.pathname : normalized.pathname + "/";
  return { url: origin + pathname, origin };
}

export function createFileRendererTarget(indexHtmlPath: string): RendererLoadTarget {
  const resolved = path.resolve(indexHtmlPath);
  const entryFileUrl = pathToFileURL(resolved).href;
  const dirUrl = pathToFileURL(path.dirname(resolved) + path.sep).href;
  return {
    kind: "file",
    indexHtmlPath: resolved,
    entryFileUrl,
    trustedDirUrl: dirUrl
  };
}

export function createDevServerTarget(devServerRaw: string): RendererLoadTarget | null {
  const parsed = parseDevServerUrl(devServerRaw);
  if (!parsed) return null;
  return { kind: "dev-server", url: parsed.url, origin: parsed.origin };
}

export function createRendererTrustPolicy(opts: {
  mode: DesktopRuntimeMode;
  indexHtmlPath: string;
  devServerUrl?: string | undefined;
}): RendererTrustPolicy {
  if (opts.mode === "development" && opts.devServerUrl) {
    const target = createDevServerTarget(opts.devServerUrl);
    if (target) return { mode: "development", target };
  }
  return {
    mode: opts.mode,
    target: createFileRendererTarget(opts.indexHtmlPath)
  };
}

/**
 * Packaged executables are always production — env overrides cannot weaken this.
 * Unpackaged may force production (CI) or default to development.
 */
export function resolveDesktopRuntimeMode(opts: {
  isPackaged: boolean;
  envOverride?: string | undefined;
}): DesktopRuntimeMode {
  if (opts.isPackaged) return "production";
  if (opts.envOverride === "production") return "production";
  return "development";
}

/**
 * Dev-server target only when unpackaged + development mode + valid DESKTOP_DEV_SERVER.
 * Packaged builds always get a file renderer regardless of env vars.
 */
export function createRendererTrustPolicyForRuntime(opts: {
  isPackaged: boolean;
  indexHtmlPath: string;
  envOverride?: string | undefined;
  devServerUrl?: string | undefined;
}): RendererTrustPolicy {
  const mode = resolveDesktopRuntimeMode({
    isPackaged: opts.isPackaged,
    envOverride: opts.envOverride
  });
  const useDevServer =
    !opts.isPackaged && mode === "development" && typeof opts.devServerUrl === "string";
  return createRendererTrustPolicy({
    mode,
    indexHtmlPath: opts.indexHtmlPath,
    ...(useDevServer ? { devServerUrl: opts.devServerUrl } : {})
  });
}

/** CSP follows load target: only a real dev-server target gets development CSP. */
export function usesDevelopmentCsp(policy: RendererTrustPolicy): boolean {
  return policy.target.kind === "dev-server";
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") && s.length > 1 ? s.slice(0, -1) : s;
}

function normalizeFilePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname).replace(/\\/g, "/").toLowerCase();
  } catch {
    return pathname.replace(/\\/g, "/").toLowerCase();
  }
}

/**
 * True if url is under the trusted renderer root (entry or Angular assets).
 * Used for understanding renderer asset scope — NOT for top-level will-navigate.
 * Never trusts arbitrary file:/// elsewhere.
 */
export function isTrustedRendererUrl(policy: RendererTrustPolicy, url: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 8192) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;

  if (policy.target.kind === "dev-server") {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.origin === policy.target.origin;
  }

  if (parsed.protocol !== "file:") return false;
  if (parsed.hostname && parsed.hostname !== "" && parsed.hostname !== "localhost") {
    return false;
  }
  const entry = policy.target.entryFileUrl;
  if (parsed.href === entry) return true;
  if (parsed.href.startsWith(entry + "#") || parsed.href.startsWith(entry + "?")) return true;
  const dir = policy.target.trustedDirUrl.endsWith("/")
    ? policy.target.trustedDirUrl
    : policy.target.trustedDirUrl + "/";
  return parsed.href.startsWith(dir);
}

/**
 * IPC sender URL: top document must be trusted entry / configured origin.
 */
export function isTrustedIpcSenderUrl(policy: RendererTrustPolicy, url: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 8192) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;

  if (policy.target.kind === "dev-server") {
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === policy.target.origin
    );
  }

  if (parsed.protocol !== "file:") return false;
  if (parsed.hostname && parsed.hostname !== "" && parsed.hostname !== "localhost") {
    return false;
  }
  const entry = new URL(policy.target.entryFileUrl);
  const framePath = stripTrailingSlash(normalizeFilePath(parsed.pathname));
  const entryPath = stripTrailingSlash(normalizeFilePath(entry.pathname));
  if (framePath === entryPath) return true;

  // Packaged Angular with production baseHref "./" often rewrites the top-level
  // document URL to the entry directory (no "index.html" segment). That URL is
  // still the same trusted SPA document — accept exact directory match only.
  const dir = new URL(policy.target.trustedDirUrl);
  const dirPath = stripTrailingSlash(normalizeFilePath(dir.pathname));
  return framePath === dirPath;
}

/**
 * Top-level document navigation (will-navigate).
 * Production file: exact index.html entry only (+ hash/query). Assets denied.
 * Dev-server: exact configured origin only.
 */
export function isAllowedNavigation(policy: RendererTrustPolicy, url: string): boolean {
  if (policy.target.kind === "dev-server") {
    return isTrustedRendererUrl(policy, url);
  }
  return isTrustedIpcSenderUrl(policy, url);
}

/**
 * Pure IPC sender gate (testable without Electron).
 * Main process still maps event.sender / senderFrame onto these flags.
 */
export function evaluateIpcSenderTrust(opts: {
  policy: RendererTrustPolicy | null;
  senderIsMainWindow: boolean;
  isTopFrame: boolean;
  frameUrl: string;
}): boolean {
  if (!opts.policy) return false;
  if (!opts.senderIsMainWindow) return false;
  if (!opts.isTopFrame) return false;
  return isTrustedIpcSenderUrl(opts.policy, opts.frameUrl);
}

export function isAllowedExternalUrl(
  url: string,
  rules: readonly ExternalUrlRule[] = EXTERNAL_URL_RULES
): boolean {
  if (typeof url !== "string" || url.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;

  return rules.some((rule) => {
    if (parsed.protocol !== rule.protocol) return false;
    if (parsed.hostname !== rule.hostname) return false;
    const expectedPort = rule.port ?? "443";
    const actualPort = parsed.port || "443";
    if (actualPort !== expectedPort) return false;
    const pathName = parsed.pathname || "/";
    if (rule.pathPrefix === "/") return true;
    const prefix = rule.pathPrefix.endsWith("/") ? rule.pathPrefix : rule.pathPrefix + "/";
    return pathName === stripTrailingSlash(rule.pathPrefix) || pathName.startsWith(prefix);
  });
}

export function untrustedSenderError(): UiError {
  return { code: "IPC_UNTRUSTED_SENDER", messageKey: "errors.ipc.untrusted_sender" };
}
