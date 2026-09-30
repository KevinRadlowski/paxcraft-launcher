/**
 * 0.6F.3 V3 Account micro-polish — presentation/asset contracts (no node:fs).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCOUNT_ASSETS,
  assertAccountAssetsDistinctFromHome,
  accountAssetUrlsAreUnique,
  HOME_HERO_ASSET,
} from './account-assets';
import * as presentation from './account-presentation';
import { formatLastUsed, isAuthenticated } from './account-presentation';
import { SWEETCRAFT_WEBSITE_URL } from '../../core/product-links';

describe('0.6F.3 V3 Account micro-polish contracts', () => {
  it('CONNECTED semantics: AUTHENTICATED only', () => {
    assert.equal(isAuthenticated('AUTHENTICATED'), true);
    assert.equal(isAuthenticated('SIGNED_OUT'), false);
  });

  it('last-used helper never invents a timestamp', () => {
    assert.equal(formatLastUsed(undefined), null);
    assert.equal(formatLastUsed(0), null);
  });

  it('no ACCOUNT_SECTION_IDS / accountSectionScrollBehavior after tab removal', () => {
    assert.equal('ACCOUNT_SECTION_IDS' in presentation, false);
    assert.equal('accountSectionScrollBehavior' in presentation, false);
  });

  it('community website constant is official site (not CDN)', () => {
    assert.equal(SWEETCRAFT_WEBSITE_URL, 'https://www.xnosweet.fr/sweetcraft');
    assert.doesNotMatch(SWEETCRAFT_WEBSITE_URL, /cdn\.xnosweet/);
  });

  it('dedicated Account assets distinct from Home hero', () => {
    assert.equal(accountAssetUrlsAreUnique(), true);
    assert.doesNotThrow(() => assertAccountAssetsDistinctFromHome());
    assert.notEqual(ACCOUNT_ASSETS.hero, HOME_HERO_ASSET);
  });
});
