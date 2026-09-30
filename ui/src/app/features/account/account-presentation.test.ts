import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as presentation from './account-presentation';
import {
  avatarInitials,
  formatLastUsed,
  isAuthenticated,
  mcAccessRowState,
  msAuthRowState,
  sessionRowState,
} from './account-presentation';

describe('account-presentation', () => {
  it('formatLastUsed returns null for missing values', () => {
    assert.equal(formatLastUsed(undefined), null);
    assert.equal(formatLastUsed(0), null);
    assert.equal(formatLastUsed(-1), null);
  });

  it('formatLastUsed formats persisted ms only — never invents Date.now()', () => {
    const label = formatLastUsed(new Date(2026, 7, 28).getTime());
    assert.ok(label);
    assert.match(label!, /2026/);
    assert.match(label!, /août|aout|8/i);
  });

  it('isAuthenticated only for AUTHENTICATED', () => {
    assert.equal(isAuthenticated('AUTHENTICATED'), true);
    assert.equal(isAuthenticated('SIGNED_OUT'), false);
    assert.equal(isAuthenticated('REAUTH_REQUIRED'), false);
  });

  it('msAuthRowState / mcAccessRowState map tones truthfully', () => {
    assert.equal(msAuthRowState('AUTHENTICATED'), 'ok');
    assert.equal(mcAccessRowState('AUTHENTICATED'), 'ok');
    assert.equal(msAuthRowState('SIGNED_OUT'), 'neutral');
    assert.equal(mcAccessRowState('UNKNOWN'), 'neutral');
    assert.equal(msAuthRowState('ERROR'), 'error');
    assert.equal(mcAccessRowState('REAUTH_REQUIRED'), 'error');
  });

  it('sessionRowState is ok only when authenticated', () => {
    assert.equal(sessionRowState('AUTHENTICATED'), 'ok');
    assert.equal(sessionRowState('SIGNED_OUT'), 'neutral');
    assert.equal(sessionRowState('ERROR'), 'error');
  });

  it('avatarInitials uses polished fallback', () => {
    assert.equal(avatarInitials('JoueurDemo'), 'JO');
    assert.equal(avatarInitials('Builder King'), 'BK');
    assert.equal(avatarInitials(''), '?');
  });

  it('tab/section helpers removed after Account nav deletion', () => {
    assert.equal('ACCOUNT_SECTION_IDS' in presentation, false);
    assert.equal('accountSectionScrollBehavior' in presentation, false);
  });
});
