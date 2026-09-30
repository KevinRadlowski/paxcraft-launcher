/**
 * Central auth secret redaction — fail-closed for known structures.
 * AuthHttpRequest.body is ALWAYS secret (never heuristically guessed).
 */

export const AUTH_REDACTED = "<redacted>";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie"
]);

const SENSITIVE_KEY_RE =
  /^(access_token|refresh_token|id_token|code|code_verifier|authorization_code|token|XboxToken|xsts|xbl|Password|password|secret|client_secret|accessToken|refreshToken|codeVerifier|error_description|error_uri)$/i;

/** OAuth error codes from network: only [A-Za-z0-9_.-] max 64, else "unknown". */
export function normalizeOAuthErrorCode(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return "unknown";
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) return "unknown";
  return trimmed;
}

export function sanitizeAuthHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(k.toLowerCase()) || /token|secret|auth/i.test(k)) {
      out[k] = AUTH_REDACTED;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Safe diagnostic view of an AuthHttpRequest.
 * body is ALWAYS <redacted> — never try to guess if it "looks" secret.
 */
export function sanitizeAuthHttpRequest(req: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  idempotent?: boolean;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    method: req.method,
    url: req.url
  };
  const headers = sanitizeAuthHeaders(req.headers);
  if (headers) out.headers = headers;
  if (req.body !== undefined) out.body = AUTH_REDACTED;
  if (req.idempotent !== undefined) out.idempotent = req.idempotent;
  return out;
}

export function sanitizeMicrosoftTokenSet(): Record<string, unknown> {
  return {
    accessToken: AUTH_REDACTED,
    refreshToken: AUTH_REDACTED,
    tokenType: "Bearer",
    expiresAtMs: 0
  };
}

export function sanitizeXboxLiveToken(): Record<string, unknown> {
  return { token: AUTH_REDACTED, userHash: AUTH_REDACTED };
}

export function sanitizeXstsToken(): Record<string, unknown> {
  return { token: AUTH_REDACTED, userHash: AUTH_REDACTED };
}

export function sanitizeMinecraftAccessToken(): Record<string, unknown> {
  return { accessToken: AUTH_REDACTED, expiresAtMs: 0 };
}

export function sanitizeOAuthFlowState(flow: {
  flowId: string;
  createdAtMs: number;
  redirectUri: string;
  expiresAtMs: number;
  consumed: boolean;
}): Record<string, unknown> {
  return {
    flowId: flow.flowId,
    state: AUTH_REDACTED,
    codeVerifier: AUTH_REDACTED,
    createdAtMs: flow.createdAtMs,
    redirectUri: flow.redirectUri,
    expiresAtMs: flow.expiresAtMs,
    consumed: flow.consumed
  };
}

export function redactAuthValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return value.map(redactAuthValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        SENSITIVE_KEY_RE.test(k) ||
        /token|secret|verifier|password|authorization.?code|error_description/i.test(k)
      ) {
        out[k] = AUTH_REDACTED;
      } else if (k.toLowerCase() === "body") {
        out[k] = AUTH_REDACTED;
      } else if (SENSITIVE_HEADER_NAMES.has(k.toLowerCase())) {
        out[k] = AUTH_REDACTED;
      } else {
        out[k] = redactAuthValue(v);
      }
    }
    return out;
  }
  return value;
}

export function redactAuthString(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && out.includes(s)) out = out.split(s).join(AUTH_REDACTED);
  }
  return out;
}

/**
 * Safe structured error details for known auth fields.
 *
 * CONTRACT:
 * - Strips / normalizes known hostile remote fields (error_description, body, callbackUrl, …).
 * - Does NOT make an arbitrary string safe. If `details` contains an unknown secret inside
 *   a free-form string value, this helper cannot detect it.
 * - Never use token-format regex to "clean" external Error.message / String(e) / stack.
 * - Correct strategy: DO NOT PROPAGATE EXTERNAL STRINGS into LauncherError at all.
 *   Prefer controlled enums/labels only (`phase`, `stage`, `status`, `oauthErrorCode`, `context`).
 */
export function safeAuthErrorDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...details };
  delete cleaned.error_description;
  delete cleaned.error_uri;
  delete cleaned.description;
  delete cleaned.body;
  delete cleaned.response;
  delete cleaned.callbackUrl;
  delete cleaned.cause;
  delete cleaned.message;
  delete cleaned.stack;
  if (typeof cleaned.error === "string") {
    cleaned.oauthErrorCode = normalizeOAuthErrorCode(cleaned.error);
    delete cleaned.error;
  }
  if (typeof cleaned.oauthErrorCode === "string") {
    cleaned.oauthErrorCode = normalizeOAuthErrorCode(cleaned.oauthErrorCode);
  }
  return redactAuthValue(cleaned) as Record<string, unknown>;
}
