import { ErrorCode, LauncherError } from "../core/errors/index.js";

/**
 * Public-client Microsoft OAuth configuration.
 * clientId is PUBLIC (not a secret). Never embed client_secret.
 */
export interface MicrosoftOAuthConfig {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes: readonly string[];
}

/**
 * Authority: `/consumers/` — personal Microsoft accounts (Xbox / Minecraft path).
 * Do not use `/common/` for this pipeline (live invalid_scope with Xbox scopes).
 * Entra Supported account types are unchanged; launcher targets MSA for Xbox/MC.
 */
export const DEFAULT_MS_AUTHORITY = "https://login.microsoftonline.com/consumers";

export const DEFAULT_MS_AUTHORIZATION_ENDPOINT =
  `${DEFAULT_MS_AUTHORITY}/oauth2/v2.0/authorize`;
export const DEFAULT_MS_TOKEN_ENDPOINT = `${DEFAULT_MS_AUTHORITY}/oauth2/v2.0/token`;

/**
 * Scopes — exactly the Xbox/Minecraft grant (no OIDC / Graph):
 * - XboxLive.signin — Microsoft token usable for Xbox Live user auth
 * - offline_access — durable refresh token for session restore
 *
 * Intentionally omitted: openid (no ID token needed), profile, email, User.Read, Graph.
 */
export const DEFAULT_MS_OAUTH_SCOPES = Object.freeze([
  "XboxLive.signin",
  "offline_access"
] as const);

/** Explicitly fake client id for hermetic tests — NOT a real app. Valid UUID shape. */
export const FIXTURE_MS_CLIENT_ID = "00000000-0000-4000-8000-0000000000f1";

/**
 * Fixture / legacy fixed loopback URI for offline unit tests.
 * Live login uses dynamic `http://localhost:{port}/` (see redirectStrategy).
 */
export const DEFAULT_LOOPBACK_REDIRECT_URI = "http://127.0.0.1:13245/callback";

/** UUID v1–v5 shape (Microsoft Entra application client ids). */
const CLIENT_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertMicrosoftClientIdUuid(clientId: string): string {
  const trimmed = clientId.trim();
  if (!CLIENT_ID_UUID_RE.test(trimmed)) {
    throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, "clientId must be a UUID", {});
  }
  return trimmed;
}

export function createMicrosoftOAuthConfig(partial: {
  clientId: string;
  redirectUri?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  scopes?: readonly string[];
  /** When true, skip UUID check (tests only). */
  allowNonUuidClientId?: boolean;
}): MicrosoftOAuthConfig {
  const raw = partial.clientId?.trim();
  if (!raw) {
    throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, "clientId required (public, not secret)");
  }
  const clientId = partial.allowNonUuidClientId ? raw : assertMicrosoftClientIdUuid(raw);
  const redirectUri = partial.redirectUri ?? DEFAULT_LOOPBACK_REDIRECT_URI;
  const authorizationEndpoint = partial.authorizationEndpoint ?? DEFAULT_MS_AUTHORIZATION_ENDPOINT;
  const tokenEndpoint = partial.tokenEndpoint ?? DEFAULT_MS_TOKEN_ENDPOINT;
  assertHttpsOrLoopback(authorizationEndpoint, "authorizationEndpoint");
  assertHttpsOrLoopback(tokenEndpoint, "tokenEndpoint");
  assertLoopbackOrHttpsRedirect(redirectUri);
  const scopes = partial.scopes ?? DEFAULT_MS_OAUTH_SCOPES;
  if (scopes.length === 0) {
    throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, "scopes required");
  }
  return Object.freeze({
    clientId,
    authorizationEndpoint,
    tokenEndpoint,
    redirectUri,
    scopes: Object.freeze([...scopes])
  });
}

/** Fixture config for offline tests only. */
export function createFixtureOAuthConfig(
  overrides: Partial<Parameters<typeof createMicrosoftOAuthConfig>[0]> = {}
): MicrosoftOAuthConfig {
  return createMicrosoftOAuthConfig({
    clientId: FIXTURE_MS_CLIENT_ID,
    redirectUri: DEFAULT_LOOPBACK_REDIRECT_URI,
    allowNonUuidClientId: false,
    ...overrides
  });
}

function assertHttpsOrLoopback(url: string, field: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, `invalid ${field}`, { field });
  }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return;
  throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, `${field} must be HTTPS (or loopback HTTP)`, {
    field
  });
}

function assertLoopbackOrHttpsRedirect(redirectUri: string): void {
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, "invalid redirectUri");
  }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "::1")) return;
  if (u.protocol === "http:" && u.hostname === "localhost") return;
  throw new LauncherError(
    ErrorCode.INVALID_OAUTH_CONFIG,
    "redirectUri must be HTTPS or loopback http://127.0.0.1|localhost|::1",
    {}
  );
}
