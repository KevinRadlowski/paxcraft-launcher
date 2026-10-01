/**
 * Home V3.2 micro-polish — hero status composition + asset uniqueness.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapPrimaryAction, readinessBadgeKey } from '../../shared/cta-mapping';
import { HOME_ASSETS, assertHomeAssetsUnique, homeAssetUrlsAreUnique } from './home-assets';
import { heroStatusPresentation } from './home-hero-status';

describe('0.6F.2 V3.2 Home micro-polish', () => {
  it('READY + idle play shows Prêt à jouer key', () => {
    const pill = heroStatusPresentation('READY', 'READY');
    assert.equal(pill.labelKey, 'readiness.ready');
    assert.equal(pill.labelKey, readinessBadgeKey('READY'));
    assert.notEqual(pill.labelKey, 'home.hero.status.running');
  });

  it('LAUNCHING overrides READY install pill', () => {
    const pill = heroStatusPresentation('READY', 'LAUNCHING');
    assert.equal(pill.labelKey, 'home.hero.status.launching');
    assert.notEqual(pill.labelKey, 'readiness.ready');
    assert.equal(pill.variant, 'info');
  });

  it('RUNNING overrides READY install pill — never Prêt à jouer', () => {
    const pill = heroStatusPresentation('READY', 'RUNNING');
    assert.equal(pill.labelKey, 'home.hero.status.running');
    assert.notEqual(pill.labelKey, 'readiness.ready');
    assert.notEqual(pill.labelKey, 'NOT_INSTALLED');
  });

  it('RUNNING does not invent install enums', () => {
    const pill = heroStatusPresentation('READY', 'RUNNING');
    assert.ok(pill.labelKey.startsWith('home.hero.status.'));
  });

  it('non-READY install badges are unchanged by idle play', () => {
    assert.equal(heroStatusPresentation('NOT_INSTALLED', 'READY').labelKey, 'readiness.not_installed');
    assert.equal(
      heroStatusPresentation('UPDATE_AVAILABLE', 'EXITED').labelKey,
      'readiness.update_available',
    );
  });

  it('CTA mapping remains authoritative while pill is presentation-only', () => {
    const cta = mapPrimaryAction('READY', 'AUTHENTICATED', { playState: 'RUNNING' });
    assert.equal(cta.kind, 'IN_PROGRESS');
    assert.equal(cta.labelKey, 'play.message.running');
    assert.equal(heroStatusPresentation('READY', 'RUNNING').labelKey, 'home.hero.status.running');
  });

  it('hero and mark assets remain distinct', () => {
    assert.ok(HOME_ASSETS.hero.includes('pax'));
    assert.ok(HOME_ASSETS.paxLogo.includes('logo-pax'));
    assert.notEqual(HOME_ASSETS.hero, HOME_ASSETS.paxLogo);
  });

  it('Home asset slots remain unique', () => {
    assert.equal(homeAssetUrlsAreUnique(), true);
    assert.doesNotThrow(() => assertHomeAssetsUnique());
  });
});
