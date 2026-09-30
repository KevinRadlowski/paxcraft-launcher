/** SweetCraft desktop UI default loopback port (avoid clash with sibling projects on 4200). */
export const DESKTOP_DEV_UI_PORT = 4201;

/** Exact origin for DESKTOP_DEV_SERVER / trust policy. Trailing slash required by convention. */
export const DESKTOP_DEV_SERVER_DEFAULT = `http://127.0.0.1:${DESKTOP_DEV_UI_PORT}/`;
