/** Settings page production asset URLs (renderer-relative). */
export const SETTINGS_ASSETS = {
  hero: 'assets/settings/sweetcraft-settings-hero.webp',
  about: 'assets/settings/sweetcraft-settings-about.webp',
  banner: 'assets/settings/sweetcraft-settings-banner.webp',
} as const;

export const HOME_HERO_ASSET = 'assets/hero/sweetcraft-home-hero.webp';
export const ACCOUNT_HERO_ASSET = 'assets/account/sweetcraft-account-hero.webp';

export function settingsAssetUrlsAreUnique(): boolean {
  const urls = Object.values(SETTINGS_ASSETS) as string[];
  return (
    new Set(urls).size === urls.length &&
    !urls.includes(HOME_HERO_ASSET) &&
    !urls.includes(ACCOUNT_HERO_ASSET)
  );
}
