/**
 * Home visual asset slots — Pax Horizon (PACK-PAX-07).
 * SweetCraft originals under assets/branding|hero|cards remain untouched.
 */

export const HOME_ASSETS = {
  hero: 'assets/pax/background-accueil.jpg',
  heroTargetWebp: 'assets/pax/background-accueil.jpg',
  serverCard: 'assets/pax/background-accueil.jpg',
  communityCard: 'assets/pax/background-accueil.jpg',
  packArt: 'assets/pax/logo-pax.webp',
  installArt: 'assets/pax/logo-pax.webp',
  ambientRight: 'assets/pax/background-accueil.jpg',
  xnosweetMark: 'assets/branding/xnosweet-mark.svg',
  sweetcraftMark: 'assets/branding/logo.svg',
  paxLogo: 'assets/pax/logo-pax.webp',
  paxLogoPng: 'assets/pax/logo-pax.png',
} as const;

export type HomeAssetKey = keyof typeof HOME_ASSETS;

/** Structural uniqueness for primary layout slots (hero vs marks may share). */
export function assertHomeAssetsUnique(
  assets: Record<string, string> = HOME_ASSETS as unknown as Record<string, string>,
): void {
  const conceptual = [
    assets['hero'] ?? assets['heroTargetWebp'],
    assets['paxLogo'] ?? assets['sweetcraftMark'],
  ].filter(Boolean);
  const set = new Set(conceptual);
  if (set.size !== conceptual.length) {
    throw new Error('Home asset slots must be unique');
  }
}

export function homeAssetUrlsAreUnique(): boolean {
  try {
    assertHomeAssetsUnique();
    return true;
  } catch {
    return false;
  }
}
