/**
 * Safe first-live diagnostic fields — never include code/state/verifier/tokens/bodies.
 */
export interface SafeAuthDiagnostic {
  stage?: string;
  errorCode: string;
  status?: number;
  oauthErrorCode?: string;
  /** Allowlisted Minecraft Services reason only (never remote errorMessage). */
  minecraftReason?: string;
  /** redirect_uri without query string */
  redirectUriBase?: string;
}

const ALLOWED_MINECRAFT_REASONS = new Set([
  "INVALID_APP_REGISTRATION",
  "ACCOUNT_SUSPENDED",
  "UNKNOWN"
]);

export function formatSafeAuthDiagnostic(opts: {
  errorCode: string;
  stage?: string;
  status?: number;
  oauthErrorCode?: string;
  minecraftReason?: string;
  redirectUri?: string;
}): SafeAuthDiagnostic {
  const out: SafeAuthDiagnostic = { errorCode: opts.errorCode };
  if (opts.stage) out.stage = opts.stage;
  if (typeof opts.status === "number") out.status = opts.status;
  if (opts.oauthErrorCode) out.oauthErrorCode = opts.oauthErrorCode;
  if (opts.minecraftReason && ALLOWED_MINECRAFT_REASONS.has(opts.minecraftReason)) {
    out.minecraftReason = opts.minecraftReason;
  }
  if (opts.redirectUri) {
    try {
      const u = new URL(opts.redirectUri);
      u.search = "";
      u.hash = "";
      out.redirectUriBase = u.toString();
    } catch {
      // omit unsafe/unparseable
    }
  }
  return out;
}
