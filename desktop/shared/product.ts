export {
  LAUNCHER_VERSION as DESKTOP_PRODUCT_VERSION,
  WINDOWS_FILE_VERSION as DESKTOP_WINDOWS_FILE_VERSION,
  WINDOWS_PRERELEASE_MAPPING_POLICY
} from "./version.generated.js";

export const DESKTOP_PRODUCT_NAME = "SweetCraft Launcher";

/**
 * Default SweetCraft distribution channel for packaged Desktop install/play.
 * Production CDN currently publishes `dev` (0.1.3 / seq 4); `stable`/`beta` are absent.
 * Must stay aligned with live E2E / PACK-05 expectations until channel UX ships.
 */
export const PRODUCT_DEFAULT_CHANNEL = "dev" as const;

/** Official community website (not CDN). Keep in sync with UI product-links + EXTERNAL_URL allowlist. */
export const SWEETCRAFT_WEBSITE_URL = "https://www.xnosweet.fr/sweetcraft";
