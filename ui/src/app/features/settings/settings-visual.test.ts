/**
 * PACK-PAX-08/09 Settings visual / presentation contracts (no node:fs).
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

describe('PACK-PAX-08/09 Settings visual / presentation contracts', () => {
  it('website constant unset until Pax links are qualified (not CDN)', () => {
    assert.equal(SWEETCRAFT_WEBSITE_URL, null);
  });

  /**
   * Inventaire résiduel (assets toujours livrés sous assets/settings/, page sans hero) :
   * garantit unicité des URLs et distinction Home/Account — évite une fusion accidentelle
   * des chemins branding SweetCraft historiques encore présents sur disque.
   * Ne prouve pas que la page monte ces images.
   */
  it('residual Settings asset URLs stay unique and distinct from Home/Account heroes', () => {
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

  it('Pax presentation labels replace SweetCraft Premium / drive copy', () => {
    const messages = fr as Record<string, string>;
    assert.equal(messages['settings.hero.body'], 'Les réglages utiles, sans détour.');
    assert.notEqual(messages['settings.interface.mode_value'], 'SweetCraft Premium');
    assert.equal(messages['settings.system.storage'], 'STOCKAGE');
    assert.equal(messages['settings.system.ram_used'], 'RAM utilisée');
    assert.equal(messages['settings.system.sweetcraft_drive'], 'Disque PaxCraft');
    assert.equal(messages['settings.system.sweetcraft_pill'], 'PAXCRAFT');
    assert.match(messages['settings.system.used_pct'] ?? '', /\{pct\}/);
    assert.equal(messages['settings.about.brand_value'], 'PaxCraft / Pax Horizon');
    assert.equal(messages['error.network'], 'Erreur réseau.');
    assert.equal(messages['error.network.pack_check'], 'Vérification du pack impossible.');
    assert.equal(messages['error.install.status_network'], 'Impossible de vérifier la version du pack.');
    assert.equal(messages['error.install.network'], "Erreur réseau pendant l'installation.");
  });
});
