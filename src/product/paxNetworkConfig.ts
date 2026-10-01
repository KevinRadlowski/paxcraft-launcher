/**
 * PACK-PAX-05 / 05.1 — Pax product network configuration (fail-closed).
 *
 * Default: network disabled; no distribution origin, server, community links, or live auth.
 * No operational fallback to historical SweetCraft CDN / site / game server.
 *
 * Harness (tests): only an opaque permit + explicit runtime kind "test-harness"
 * may resolve a non-historical origin for injected Mock* transports.
 * Harness NEVER authorizes real FetchHttpClient / live browser / real sockets.
 *
 * Test-only writers live in paxNetworkTestHooks.ts — product entrypoints must not import them.
 */

import { ErrorCode, LauncherError } from "../core/errors/index.js";
import {
  HISTORICAL_SWEETCRAFT_PRODUCT_BASE,
  normalizeProductBase
} from "../distribution/urls/index.js";

export { HISTORICAL_SWEETCRAFT_PRODUCT_BASE };

export interface PaxNetworkConfig {
  /** Master switch for product network capabilities (not sufficient alone for auth/outbound). */
  readonly networkEnabled: boolean;
  /** Official Pax distribution origin (HTTPS product base). Null = unset. */
  readonly distributionOrigin: string | null;
  /** Official Minecraft server host for status ping. Null = unset. */
  readonly serverAddress: string | null;
  /** Community / marketing site. Null = unset. */
  readonly communityWebsiteUrl: string | null;
  /** Support URL. Null = unset. */
  readonly supportUrl: string | null;
  /**
   * Live interactive OAuth (browser + live auth HTTP).
   * Independent of distribution — default false. networkEnabled alone never enables this.
   */
  readonly liveAuthEnabled: boolean;
}

/** Product default until Pax endpoints/trust are qualified. */
export const DEFAULT_PAX_NETWORK_CONFIG: PaxNetworkConfig = Object.freeze({
  networkEnabled: false,
  distributionOrigin: null,
  serverAddress: null,
  communityWebsiteUrl: null,
  supportUrl: null,
  liveAuthEnabled: false
});

/** Stable DTO echo when no Pax server is configured (not a ping target). */
export const PAX_SERVER_ADDRESS_UNCONFIGURED = "not-configured";

/**
 * Trusted runtime classification for network policy.
 * Omission of runtime in resolvers is treated as packaged-production (fail closed).
 */
export type PaxNetworkRuntimeKind = "packaged-production" | "development" | "test-harness";

export interface PaxNetworkRuntimeContext {
  readonly kind: PaxNetworkRuntimeKind;
}

/** Opaque harness permit — only creatable via paxNetworkTestHooks. */
export type NetworkHarnessPermit = {
  readonly __brand: "PaxNetworkHarnessPermit";
};

const harnessPermitRegistry = new WeakSet<object>();

/** @internal — called only from paxNetworkTestHooks.createNetworkHarnessPermit */
export function registerNetworkHarnessPermit(permit: object): NetworkHarnessPermit {
  harnessPermitRegistry.add(permit);
  return permit as NetworkHarnessPermit;
}

export function isNetworkHarnessPermit(value: unknown): value is NetworkHarnessPermit {
  return typeof value === "object" && value !== null && harnessPermitRegistry.has(value);
}

/** Private immutable hostname list — not exported as a mutable Set. */
const HISTORICAL_BLOCKED_HOSTS = Object.freeze([
  "cdn.xnosweet.fr",
  "www.xnosweet.fr",
  "xnosweet.fr",
  "xbase.fr",
  "www.xbase.fr",
  "sweetcraft.datho.st"
] as const);

/** Read-only snapshot for diagnostics/docs (frozen copy). */
export function listHistoricalBlockedHosts(): readonly string[] {
  return Object.freeze(HISTORICAL_BLOCKED_HOSTS.slice());
}

let activeConfig: PaxNetworkConfig = DEFAULT_PAX_NETWORK_CONFIG;

/** Read current product network config (immutable snapshot). */
export function getPaxNetworkConfig(): PaxNetworkConfig {
  return activeConfig;
}

/** @internal — only paxNetworkTestHooks may call. */
export function replacePaxNetworkConfigForTests(config: PaxNetworkConfig): void {
  activeConfig = Object.freeze({
    networkEnabled: config.networkEnabled === true,
    distributionOrigin: config.distributionOrigin ?? null,
    serverAddress: config.serverAddress ?? null,
    communityWebsiteUrl: config.communityWebsiteUrl ?? null,
    supportUrl: config.supportUrl ?? null,
    liveAuthEnabled: config.liveAuthEnabled === true
  });
}

/** @internal — only paxNetworkTestHooks may call. */
export function resetPaxNetworkConfigStateForTests(): void {
  activeConfig = DEFAULT_PAX_NETWORK_CONFIG;
}

export function isHistoricalBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (HISTORICAL_BLOCKED_HOSTS as readonly string[]).includes(host);
}

/** Redact credentials from URL strings for errors (never echo userinfo). */
export function redactUrlForError(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return `${u.protocol}//***@${u.host}${u.pathname}`;
    }
    return u.toString();
  } catch {
    return "<invalid-url>";
  }
}

export function assertNotHistoricalDestinationUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.NETWORK_ERROR, "invalid URL", {});
  }
  if (parsed.username || parsed.password) {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "URL must not contain credentials", {});
  }
  if (isHistoricalBlockedHost(parsed.hostname)) {
    throw new LauncherError(
      ErrorCode.HISTORICAL_DESTINATION_BLOCKED,
      "historical SweetCraft destination refused",
      { hostname: parsed.hostname.toLowerCase() }
    );
  }
  return parsed;
}

/**
 * DNS hostname + optional numeric port (no IPv6, no credentials).
 * Supported: `host`, `host:25565`. Rejected: bare IPv6, `[::1]`, ambiguous multi-colon.
 */
export function parseProductServerAddress(raw: string): { host: string; port: number | null } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 253) {
    throw new LauncherError(ErrorCode.NETWORK_ERROR, "invalid server address", {});
  }
  if (trimmed.includes("/") || trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("@")) {
    throw new LauncherError(ErrorCode.NETWORK_ERROR, "invalid server address", {});
  }
  if (trimmed.includes("[") || trimmed.includes("]")) {
    throw new LauncherError(
      ErrorCode.NETWORK_ERROR,
      "IPv6 server addresses are not supported",
      {}
    );
  }
  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount > 1) {
    throw new LauncherError(ErrorCode.NETWORK_ERROR, "ambiguous server address", {});
  }
  let host: string;
  let port: number | null = null;
  if (colonCount === 1) {
    const idx = trimmed.indexOf(":");
    host = trimmed.slice(0, idx);
    const portRaw = trimmed.slice(idx + 1);
    if (!/^\d{1,5}$/.test(portRaw)) {
      throw new LauncherError(ErrorCode.NETWORK_ERROR, "invalid server port", {});
    }
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new LauncherError(ErrorCode.NETWORK_ERROR, "invalid server port", {});
    }
    port = n;
  } else {
    host = trimmed;
  }
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(host) &&
      host !== "localhost") {
    // Allow dotted hostnames and localhost; reject empty labels / odd forms.
    if (host !== "127.0.0.1" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      throw new LauncherError(ErrorCode.NETWORK_ERROR, "invalid server hostname", {});
    }
  }
  if (isHistoricalBlockedHost(host)) {
    throw new LauncherError(
      ErrorCode.HISTORICAL_DESTINATION_BLOCKED,
      "historical SweetCraft server address refused",
      { hostname: host.toLowerCase() }
    );
  }
  return { host: host.toLowerCase(), port };
}

function resolveRuntime(opts?: {
  runtime?: PaxNetworkRuntimeContext | null | undefined;
}): PaxNetworkRuntimeContext {
  const kind = opts?.runtime?.kind;
  if (kind === "test-harness" || kind === "development" || kind === "packaged-production") {
    return { kind };
  }
  return { kind: "packaged-production" };
}

function hasActiveHarness(opts?: ResolveDistributionOriginOptions): boolean {
  return (
    resolveRuntime(opts).kind === "test-harness" && isNetworkHarnessPermit(opts?.harness)
  );
}

export type ResolveDistributionOriginOptions = {
  /** Explicit CLI / request override (never from renderer). */
  explicit?: string | null | undefined;
  /**
   * Opaque harness permit from paxNetworkTestHooks.
   * Insufficient alone — runtime.kind must be "test-harness".
   */
  harness?: NetworkHarnessPermit | null | undefined;
  /**
   * Trusted runtime context. Omission ⇒ packaged-production (no harness).
   * Do not infer non-production from a missing packagedProduction boolean.
   */
  runtime?: PaxNetworkRuntimeContext | null | undefined;
};

/**
 * Resolve a usable distribution origin or throw.
 * Never falls back to HISTORICAL_SWEETCRAFT_PRODUCT_BASE / DEFAULT_PRODUCT_BASE.
 *
 * When network is disabled: only valid test-harness + permit may return an origin
 * (for Mock* URL construction). Real transports remain gated separately.
 */
export function requireConfiguredDistributionOrigin(
  opts?: ResolveDistributionOriginOptions
): string {
  const cfg = getPaxNetworkConfig();
  const explicit = typeof opts?.explicit === "string" ? opts.explicit.trim() : "";
  const fromConfig =
    typeof cfg.distributionOrigin === "string" ? cfg.distributionOrigin.trim() : "";
  const harnessActive = hasActiveHarness(opts);

  if (harnessActive) {
    const candidate = explicit || fromConfig;
    if (!candidate) {
      throw new LauncherError(
        ErrorCode.DISTRIBUTION_NOT_CONFIGURED,
        "harness active but distribution origin missing",
        {}
      );
    }
    const forParse = candidate.startsWith("http") ? candidate : `https://${candidate}`;
    assertNotHistoricalDestinationUrl(forParse);
    return normalizeProductBase(candidate);
  }

  // Product / CLI / desktop path — no hostname-based soft enablement.
  if (!cfg.networkEnabled) {
    throw new LauncherError(
      ErrorCode.NETWORK_NOT_CONFIGURED,
      "Pax network is disabled and no test harness is active",
      {}
    );
  }

  if (!fromConfig) {
    // Partial activation: network on without origin — refuse (no SweetCraft / explicit soft path).
    throw new LauncherError(
      ErrorCode.DISTRIBUTION_NOT_CONFIGURED,
      "Pax network enabled but distribution origin is not configured",
      {}
    );
  }

  assertNotHistoricalDestinationUrl(
    fromConfig.startsWith("http") ? fromConfig : `https://${fromConfig}`
  );
  const configured = normalizeProductBase(fromConfig);

  if (explicit) {
    assertNotHistoricalDestinationUrl(
      explicit.startsWith("http") ? explicit : `https://${explicit}`
    );
    const normalizedExplicit = normalizeProductBase(explicit);
    if (normalizedExplicit !== configured) {
      throw new LauncherError(
        ErrorCode.DISTRIBUTION_NOT_CONFIGURED,
        "explicit origin does not match configured Pax distribution origin",
        {}
      );
    }
  }

  return configured;
}

/** Observational paths: null when distribution/network unavailable (no throw). */
export function tryResolveDistributionOrigin(
  opts?: ResolveDistributionOriginOptions
): string | null {
  try {
    return requireConfiguredDistributionOrigin(opts);
  } catch (e) {
    if (
      LauncherError.isLauncherError(e) &&
      (e.code === ErrorCode.DISTRIBUTION_NOT_CONFIGURED ||
        e.code === ErrorCode.NETWORK_NOT_CONFIGURED ||
        e.code === ErrorCode.HISTORICAL_DESTINATION_BLOCKED)
    ) {
      return null;
    }
    throw e;
  }
}

/**
 * Real outbound HTTP (FetchHttpClient / live auth fetch).
 * Harness permits do NOT transfer authorization here.
 * This cycle: never authorize real product sockets until a dedicated activation lot.
 */
export function assertRealOutboundTransportAllowed(): void {
  throw new LauncherError(
    ErrorCode.NETWORK_NOT_CONFIGURED,
    "Pax real outbound HTTP transport is not authorized",
    {}
  );
}

/** Configured game-server host for ping, or null when capability unavailable. */
export function resolveConfiguredServerAddress(): string | null {
  const cfg = getPaxNetworkConfig();
  if (!cfg.networkEnabled) return null;
  const addr = cfg.serverAddress?.trim() ?? "";
  if (!addr) return null;
  const parsed = parseProductServerAddress(addr);
  return parsed.port !== null ? `${parsed.host}:${parsed.port}` : parsed.host;
}

/** Community / support https URL for openExternal, or null. */
export function resolveConfiguredExternalLink(
  kind: "community" | "support"
): string | null {
  const cfg = getPaxNetworkConfig();
  const raw = kind === "community" ? cfg.communityWebsiteUrl : cfg.supportUrl;
  if (!cfg.networkEnabled || !raw?.trim()) return null;
  const parsed = assertNotHistoricalDestinationUrl(raw.trim());
  if (parsed.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "external link must be HTTPS", {});
  }
  return parsed.toString();
}

/**
 * Live interactive auth (real browser + live auth HTTP).
 * Requires liveAuthEnabled — networkEnabled alone is never sufficient.
 * Hermetic FakeSystemBrowser / MockAuthHttpTransport / injected fetch must not call this.
 */
export function assertPaxLiveAuthNetworkAllowed(_opts?: {
  packagedProduction?: boolean;
}): void {
  const cfg = getPaxNetworkConfig();
  if (!cfg.liveAuthEnabled) {
    throw new LauncherError(
      ErrorCode.NETWORK_NOT_CONFIGURED,
      "Pax live auth is not enabled — interactive OAuth disabled",
      {}
    );
  }
  // Future: additional trust/client-id qualification. Do not invent criteria here.
  // liveAuthEnabled without a future qualified client remains a test-only knobs path;
  // product DEFAULT keeps liveAuthEnabled=false.
}
