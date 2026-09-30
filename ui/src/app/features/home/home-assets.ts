/**
 * Home visual asset slots — each region has a distinct path.
 * Final artworks are supplied externally (see assets/<slot>/README.md).
 * Until webp packs land, CSS placeholders remain visible behind optional images.
 */

export const HOME_ASSETS = {
  /** Production hero WebP (converted from validated PNG composition). */
  hero: 'assets/hero/sweetcraft-home-hero.webp',
  heroTargetWebp: 'assets/hero/sweetcraft-home-hero.webp',
  serverCard: 'assets/cards/sweetcraft-server-card.webp',
  communityCard: 'assets/cards/sweetcraft-community-card.webp',
  packArt: 'assets/cards/sweetcraft-pack-art.webp',
  installArt: 'assets/cards/sweetcraft-install-art.webp',
  ambientRight: 'assets/ambient/sweetcraft-home-ambient-right.webp',
  xnosweetMark: 'assets/branding/xnosweet-mark.svg',
  sweetcraftMark: 'assets/branding/logo.svg',
} as const;

export type HomeAssetKey = keyof typeof HOME_ASSETS;

/** Structural uniqueness — no two conceptual slots share the same URL. */
export function assertHomeAssetsUnique(
  assets: Record<string, string> = HOME_ASSETS as unknown as Record<string, string>,
): void {
  const conceptual = [
    assets['hero'] ?? assets['heroTargetWebp'],
    assets['serverCard'],
    assets['communityCard'],
    assets['packArt'],
    assets['installArt'],
    assets['ambientRight'],
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
