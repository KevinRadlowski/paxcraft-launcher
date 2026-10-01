export {
  LAUNCHER_VERSION as DESKTOP_PRODUCT_VERSION,
  WINDOWS_FILE_VERSION as DESKTOP_WINDOWS_FILE_VERSION,
  WINDOWS_PRERELEASE_MAPPING_POLICY
} from "./version.generated.js";

export const DESKTOP_PRODUCT_NAME = "PaxCraft Launcher";

/** Windows AppUserModelId — keep in sync with electron-builder.yml appId. */
export const DESKTOP_APP_USER_MODEL_ID = "org.paxhorizon.paxcraft.launcher";

/**
 * Default distribution channel for packaged Desktop install/play.
 * Inherited SweetCraft CDN still publishes `dev` only — network/distribution Pax is a later lot.
 * Must stay aligned until channel UX / Pax origin ships.
 */
export const PRODUCT_DEFAULT_CHANNEL = "dev" as const;

/**
 * Official community website (not CDN).
 * PACK-PAX-05: unset until Pax endpoints are qualified — no SweetCraft fallback.
 * Keep in sync with UI product-links + EXTERNAL_URL allowlist (empty).
 */
export const SWEETCRAFT_WEBSITE_URL: string | null = null;
export const PAX_COMMUNITY_WEBSITE_URL: string | null = null;
