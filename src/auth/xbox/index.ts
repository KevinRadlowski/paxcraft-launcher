import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { AuthHttpTransport } from "../http/transport.js";
import { parseJsonAuthBody } from "../http/transport.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import type { Clock } from "../clock.js";

export const XBOX_USER_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
export const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";

export interface XboxLiveToken {
  token: string;
  userHash: string;
  expiresAtMs?: number;
}

export interface XstsToken {
  token: string;
  userHash: string;
  expiresAtMs?: number;
}

/**
 * Microsoft access token → Xbox Live token (RPS ticket).
 */
export async function authenticateXboxLive(opts: {
  microsoftAccessToken: string;
  transport: AuthHttpTransport;
  clock: Clock;
  emitter?: ProgressEmitter;
  signal?: AbortSignal;
}): Promise<XboxLiveToken> {
  const payload = {
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: `d=${opts.microsoftAccessToken}`
    },
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT"
  };

  const res = await opts.transport.request({
    url: XBOX_USER_AUTH_URL,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-xbl-contract-version": "1"
    },
    body: JSON.stringify(payload),
    idempotent: false,
    ...(opts.signal ? { signal: opts.signal } : {})
  });

  if (res.status < 200 || res.status >= 300) {
    throw new LauncherError(ErrorCode.INVALID_XBOX_RESPONSE, `Xbox Live auth HTTP ${res.status}`, {
      status: res.status
    });
  }

  const token = parseXboxTokenResponse(res.body, opts.clock);
  opts.emitter?.emit("XBOX_AUTHENTICATED", { hasUserHash: true });
  return token;
}

export function parseXboxTokenResponse(body: string, clock: Clock): XboxLiveToken {
  const raw = parseJsonAuthBody(body, "xbox");
  if (!isObj(raw) || typeof raw.Token !== "string" || !raw.Token) {
    throw new LauncherError(ErrorCode.INVALID_XBOX_RESPONSE, "Xbox Token missing");
  }
  const userHash = extractUserHash(raw);
  const out: XboxLiveToken = { token: raw.Token, userHash };
  const exp = parseNotAfter(raw, clock);
  if (exp !== undefined) out.expiresAtMs = exp;
  return out;
}

/**
 * Xbox Live token → XSTS for Minecraft relying party.
 */
export async function authorizeXsts(opts: {
  xbox: XboxLiveToken;
  transport: AuthHttpTransport;
  clock: Clock;
  emitter?: ProgressEmitter;
  relyingParty?: string;
  signal?: AbortSignal;
}): Promise<XstsToken> {
  const relyingParty = opts.relyingParty ?? "rp://api.minecraftservices.com/";
  const payload = {
    Properties: {
      SandboxId: "RETAIL",
      UserTokens: [opts.xbox.token]
    },
    RelyingParty: relyingParty,
    TokenType: "JWT"
  };

  const res = await opts.transport.request({
    url: XSTS_AUTH_URL,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-xbl-contract-version": "1"
    },
    body: JSON.stringify(payload),
    idempotent: false,
    ...(opts.signal ? { signal: opts.signal } : {})
  });

  if (res.status < 200 || res.status >= 300) {
    throw mapXstsHttpError(res.status, res.body);
  }

  const raw = parseJsonAuthBody(res.body, "xsts");
  if (!isObj(raw) || typeof raw.Token !== "string" || !raw.Token) {
    throw new LauncherError(ErrorCode.INVALID_XSTS_RESPONSE, "XSTS Token missing");
  }
  const userHash = extractUserHash(raw);
  if (userHash !== opts.xbox.userHash) {
    throw new LauncherError(ErrorCode.INVALID_XSTS_RESPONSE, "XSTS userHash mismatch", {});
  }
  const out: XstsToken = { token: raw.Token, userHash };
  const exp = parseNotAfter(raw, opts.clock);
  if (exp !== undefined) out.expiresAtMs = exp;
  opts.emitter?.emit("XSTS_AUTHORIZED", { hasUserHash: true });
  return out;
}

function mapXstsHttpError(status: number, body: string): LauncherError {
  let xerr: string | undefined;
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    if (typeof raw.XErr === "number" || typeof raw.XErr === "string") {
      xerr = String(raw.XErr);
    }
  } catch {
    // ignore
  }
  // Known XErr codes (documented for UI mapping later — no raw dump to users)
  const eligibility =
    xerr === "2148916233"
      ? "no_xbox_account"
      : xerr === "2148916238"
        ? "child_account"
        : xerr === "2148916235"
          ? "banned"
          : "authorization_failed";
  return new LauncherError(ErrorCode.XSTS_AUTHORIZATION_FAILED, "XSTS authorization failed", {
    status,
    eligibility,
    xerr
  });
}

function extractUserHash(raw: Record<string, unknown>): string {
  const claims = raw.DisplayClaims;
  if (!isObj(claims)) {
    throw new LauncherError(ErrorCode.INVALID_XBOX_RESPONSE, "DisplayClaims missing");
  }
  const xui = claims.xui;
  if (!Array.isArray(xui) || xui.length === 0 || !isObj(xui[0])) {
    throw new LauncherError(ErrorCode.INVALID_XBOX_RESPONSE, "DisplayClaims.xui missing");
  }
  const uhs = xui[0].uhs;
  if (typeof uhs !== "string" || !uhs) {
    throw new LauncherError(ErrorCode.INVALID_XBOX_RESPONSE, "userHash (uhs) missing");
  }
  return uhs;
}

function parseNotAfter(raw: Record<string, unknown>, clock: Clock): number | undefined {
  if (typeof raw.NotAfter !== "string") return undefined;
  const t = Date.parse(raw.NotAfter);
  if (!Number.isFinite(t)) return undefined;
  void clock;
  return t;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
