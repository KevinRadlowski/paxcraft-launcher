/**
 * PACK-PAX-08 Account presentation contracts (no node:fs).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as presentation from './account-presentation';
import { formatLastUsed, isAuthenticated } from './account-presentation';
import { SWEETCRAFT_WEBSITE_URL } from '../../core/product-links';
import fr from '../../../assets/i18n/fr.json';

describe('PACK-PAX-08 Account presentation contracts', () => {
  it('CONNECTED semantics: AUTHENTICATED only', () => {
    assert.equal(isAuthenticated('AUTHENTICATED'), true);
    assert.equal(isAuthenticated('SIGNED_OUT'), false);
  });

  it('last-used helper never invents epoch / invalid dates', () => {
    assert.equal(formatLastUsed(undefined), null);
    assert.equal(formatLastUsed(0), null);
    assert.equal(formatLastUsed(1), null);
    assert.equal(formatLastUsed(86_400_000), null);
  });

  it('no ACCOUNT_SECTION_IDS / accountSectionScrollBehavior after tab removal', () => {
    assert.equal('ACCOUNT_SECTION_IDS' in presentation, false);
    assert.equal('accountSectionScrollBehavior' in presentation, false);
  });

  it('community website constant unset until Pax links are qualified (not CDN)', () => {
    assert.equal(SWEETCRAFT_WEBSITE_URL, null);
  });

  it('unknown last-used label present for presentation', () => {
    const messages = fr as Record<string, string>;
    assert.equal(messages['account.last_used.unknown'], 'Inconnue');
  });
});
