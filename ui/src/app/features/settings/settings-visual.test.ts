/**
 * 0.6F.4 V2 Settings premium — asset / website contracts (no node:fs).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCOUNT_HERO_ASSET,
  HOME_HERO_ASSET,
  SETTINGS_ASSETS,
  settingsAssetUrlsAreUnique,
} from './settings-assets';
import { SWEETCRAFT_WEBSITE_URL } from '../../core/product-links';
import { diskUsedPercent, memoryUsedPercent } from './settings-memory';
import fr from '../../../assets/i18n/fr.json';

describe('0.6F.4 Settings visual / asset contracts', () => {
  it('website constant is official site (not CDN)', () => {
    assert.equal(SWEETCRAFT_WEBSITE_URL, 'https://www.xnosweet.fr/sweetcraft');
    assert.doesNotMatch(SWEETCRAFT_WEBSITE_URL, /cdn\.xnosweet/);
  });

  it('dedicated Settings assets distinct from Home/Account heroes', () => {
    assert.equal(settingsAssetUrlsAreUnique(), true);
    assert.notEqual(SETTINGS_ASSETS.hero, HOME_HERO_ASSET);
    assert.notEqual(SETTINGS_ASSETS.hero, ACCOUNT_HERO_ASSET);
    assert.match(SETTINGS_ASSETS.hero, /sweetcraft-settings-hero\.webp/);
    assert.match(SETTINGS_ASSETS.about, /sweetcraft-settings-about\.webp/);
    assert.match(SETTINGS_ASSETS.banner, /sweetcraft-settings-banner\.webp/);
  });

  it('RAM/disk percent helpers stay truthful (no fake CPU)', () => {
    assert.equal(memoryUsedPercent(8192, 2048), 75);
    assert.equal(diskUsedPercent(200, 50), 75);
    assert.equal(typeof diskUsedPercent, 'function');
  });

  it('V3 multi-disk i18n keys present', () => {
    const messages = fr as Record<string, string>;
    assert.equal(messages['settings.system.storage'], 'STOCKAGE');
    assert.equal(messages['settings.system.ram_used'], 'RAM utilisée');
    assert.equal(messages['settings.system.sweetcraft_drive'], 'Disque SweetCraft');
    assert.match(messages['settings.system.used_pct'] ?? '', /\{pct\}/);
    assert.equal(messages['error.network'], 'Erreur réseau.');
    assert.equal(messages['error.network.pack_check'], 'Vérification du pack impossible.');
    assert.equal(messages['error.install.status_network'], 'Impossible de vérifier la version du pack.');
    assert.equal(messages['error.install.network'], "Erreur réseau pendant l'installation.");
  });
});
