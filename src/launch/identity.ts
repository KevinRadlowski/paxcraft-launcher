import { ErrorCode, LauncherError } from "../core/errors/index.js";

/**
 * Identity data required by Minecraft launch placeholders.
 * Tokens are sensitive — never log / emit / put in diagnostic LaunchSpec.
 *
 * ## UUID contract (internal)
 *
 * `uuid` MUST be an RFC 4122 UUID string **with hyphens**, case-insensitive hex:
 * `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
 *
 * Future Microsoft auth MUST normalize the Minecraft profile id to this hyphenated
 * form before constructing LaunchIdentity. Undashed / malformed IDs are refused
 * (never accepted silently).
 */
export interface LaunchIdentity {
  username: string;
  /**
   * Hyphenated RFC UUID. See module contract above.
   * Do not pass undashed Mojang-style hex without normalizing first.
   */
  uuid: string;
  accessToken: string;
  userType: string;
  /** Optional MSA fields when available (not required for offline/test identity). */
  xuid?: string;
  clientId?: string;
  /** Deterministic JSON object for ${user_properties} / ${profile_properties}. */
  userProperties?: Record<string, unknown>;
  profileProperties?: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateLaunchIdentity(identity: LaunchIdentity): LaunchIdentity {
  if (!identity || typeof identity !== "object") {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_IDENTITY, "identity required");
  }
  if (typeof identity.username !== "string" || !identity.username.trim()) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_IDENTITY, "username required");
  }
  if (typeof identity.uuid !== "string" || !UUID_RE.test(identity.uuid)) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_IDENTITY, "uuid must be RFC UUID");
  }
  if (typeof identity.accessToken !== "string" || identity.accessToken.length === 0) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_IDENTITY, "accessToken required");
  }
  if (typeof identity.userType !== "string" || !identity.userType.trim()) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_IDENTITY, "userType required");
  }
  if (/[\x00-\x1f]/.test(identity.username) || /[\x00-\x1f]/.test(identity.accessToken)) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_IDENTITY, "control characters forbidden");
  }
  return identity;
}

/** Offline/test identity for hermetic tests and launch-plan dry-run. */
export function createTestLaunchIdentity(overrides: Partial<LaunchIdentity> = {}): LaunchIdentity {
  return validateLaunchIdentity({
    username: "SweetCraftTest",
    uuid: "00000000-0000-4000-8000-000000000001",
    accessToken: "test-access-token-NOT-A-REAL-SECRET",
    userType: "msa",
    userProperties: {},
    profileProperties: {},
    ...overrides
  });
}
