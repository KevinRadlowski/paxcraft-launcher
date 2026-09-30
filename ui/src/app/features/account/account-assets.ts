/** Account page production asset URLs (renderer-relative). */
export const ACCOUNT_ASSETS = {
  hero: 'assets/account/sweetcraft-account-hero.webp',
  community: 'assets/account/sweetcraft-account-community.webp',
} as const;

/** Home hero must stay distinct — Account must not reuse it. */
export const HOME_HERO_ASSET = 'assets/hero/sweetcraft-home-hero.webp';

export function accountAssetUrlsAreUnique(): boolean {
  const urls = Object.values(ACCOUNT_ASSETS) as string[];
  return new Set(urls).size === urls.length && !urls.includes(HOME_HERO_ASSET);
}

export function assertAccountAssetsDistinctFromHome(): void {
  const hero = ACCOUNT_ASSETS.hero as string;
  if (hero === HOME_HERO_ASSET) {
    throw new Error('Account hero must not reuse Home hero asset');
  }
  if (!accountAssetUrlsAreUnique()) {
    throw new Error('Account asset URLs must be unique and distinct from Home hero');
  }
}
