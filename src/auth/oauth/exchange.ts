import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { MicrosoftOAuthConfig } from "../config.js";
import type { Clock } from "../clock.js";
import { computeExpiresAtMs } from "../expiry.js";
import type { AuthHttpTransport } from "../http/transport.js";
import { assertAuthHttpOk, parseJsonAuthBody } from "../http/transport.js";
import { assertFlowUsable, consumeFlow, type OAuthFlowState } from "../pkce.js";
import { normalizeOAuthErrorCode, safeAuthErrorDetails } from "../redaction.js";
import type { ProgressEmitter } from "../../instance/events/index.js";

export interface MicrosoftTokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  /** Absolute expiry epoch ms (from expires_in + clock). */
  expiresAtMs: number;
}

/**
 * Exchange authorization code — public client, PKCE, NO client_secret.
 * Non-idempotent: transport must not auto-retry.
 * Flow is consumed before the token POST so a failed exchange cannot be replayed.
 */
export async function exchangeAuthorizationCode(opts: {
  config: MicrosoftOAuthConfig;
  flow: OAuthFlowState;
  code: string;
  state: string;
  transport: AuthHttpTransport;
  clock: Clock;
  emitter?: ProgressEmitter;
}): Promise<MicrosoftTokenSet> {
  assertFlowUsable(opts.flow, opts.clock, opts.state);
  if (!opts.code || typeof opts.code !== "string") {
    throw new LauncherError(ErrorCode.OAUTH_ERROR, "authorization code missing");
  }
  consumeFlow(opts.flow);

  const body = new URLSearchParams({
    client_id: opts.config.clientId,
    code: opts.code,
    redirect_uri: opts.flow.redirectUri,
    grant_type: "authorization_code",
    code_verifier: opts.flow.codeVerifier
  });

  const res = await opts.transport.request({
    url: opts.config.tokenEndpoint,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: body.toString(),
    idempotent: false
  });

  if (res.status < 200 || res.status >= 300) {
    throw sanitizeOAuthErrorResponse(res.body, res.status);
  }

  const tokens = parseMicrosoftTokenResponse(res.body, opts.clock);
  opts.emitter?.emit("MICROSOFT_AUTHENTICATED", {
    expiresAtMs: tokens.expiresAtMs,
    hasRefreshToken: !!tokens.refreshToken
  });
  return tokens;
}

export async function refreshMicrosoftToken(opts: {
  config: MicrosoftOAuthConfig;
  refreshToken: string;
  transport: AuthHttpTransport;
  clock: Clock;
  emitter?: ProgressEmitter;
  signal?: AbortSignal;
}): Promise<MicrosoftTokenSet> {
  if (!opts.refreshToken) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_RESPONSE, "refresh_token required");
  }
  const body = new URLSearchParams({
    client_id: opts.config.clientId,
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    // Same Xbox scopes as authorize — never reintroduce openid/profile/Graph
    scope: opts.config.scopes.join(" ")
  });

  const res = await opts.transport.request({
    url: opts.config.tokenEndpoint,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: body.toString(),
    idempotent: false,
    ...(opts.signal ? { signal: opts.signal } : {})
  });

  if (res.status < 200 || res.status >= 300) {
    throw sanitizeOAuthErrorResponse(res.body, res.status);
  }

  const tokens = parseMicrosoftTokenResponse(res.body, opts.clock, opts.refreshToken);
  opts.emitter?.emit("AUTH_REFRESHED", {
    expiresAtMs: tokens.expiresAtMs,
    refreshRotated: tokens.refreshToken !== opts.refreshToken
  });
  return tokens;
}

export function parseMicrosoftTokenResponse(
  body: string,
  clock: Clock,
  previousRefreshToken?: string
): MicrosoftTokenSet {
  const raw = parseJsonAuthBody(body, "token response");
  if (!isObj(raw)) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_RESPONSE, "token response not object");
  }
  if (typeof raw.error === "string") {
    throw new LauncherError(
      ErrorCode.OAUTH_ERROR,
      "oauth token error",
      safeAuthErrorDetails({
        oauthErrorCode: normalizeOAuthErrorCode(raw.error)
      })
    );
  }
  if (typeof raw.access_token !== "string" || !raw.access_token) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_RESPONSE, "access_token missing");
  }
  if (typeof raw.token_type !== "string" || !raw.token_type) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_RESPONSE, "token_type missing");
  }
  const expiresIn = assertPositiveSafeInt(raw.expires_in, "expires_in");
  const out: MicrosoftTokenSet = {
    accessToken: raw.access_token,
    tokenType: raw.token_type,
    expiresAtMs: computeExpiresAtMs(clock, expiresIn)
  };
  if (typeof raw.scope === "string") out.scope = raw.scope;
  if (typeof raw.refresh_token === "string" && raw.refresh_token) {
    out.refreshToken = raw.refresh_token;
  } else if (previousRefreshToken) {
    out.refreshToken = previousRefreshToken;
  }
  return out;
}

/** Remote error_description is hostile — never copy into LauncherError. */
export function sanitizeOAuthErrorResponse(body: string, status: number): LauncherError {
  let oauthErrorCode = "unknown";
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    if (typeof raw.error === "string") {
      oauthErrorCode = normalizeOAuthErrorCode(raw.error);
    }
  } catch {
    // ignore body — never attach raw body to error
  }

  // 5xx / 429 are never proof the credential is revoked
  const reauthRequired =
    status < 500 && status !== 429 && isOAuthReauthErrorCode(oauthErrorCode);

  if (reauthRequired) {
    return new LauncherError(ErrorCode.AUTH_REAUTH_REQUIRED, "oauth reauthentication required", {
      status,
      oauthErrorCode,
      reauthRequired: true
    });
  }

  return new LauncherError(ErrorCode.OAUTH_ERROR, `oauth http ${status}`, {
    status,
    oauthErrorCode,
    reauthRequired: false
  });
}

/**
 * OAuth error codes that invalidate a stored refresh grant — require interactive reauth.
 * Explicit allowlist only. Never treat server_error / temporarily_unavailable as reauth.
 */
export const OAUTH_REAUTH_ERROR_CODES = Object.freeze(
  new Set([
    "invalid_grant",
    "invalid_token",
    "expired_token",
    "interaction_required",
    "login_required"
  ])
);

export function isOAuthReauthErrorCode(code: string): boolean {
  return OAUTH_REAUTH_ERROR_CODES.has(code);
}

function assertPositiveSafeInt(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_RESPONSE, `invalid ${field}`, { field });
  }
  return value;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

void assertAuthHttpOk;
