/**
 * PACK-PAX-09 Diagnostics presentation contracts (no node:fs).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  authLabelKey,
  authTone,
  playLabelKey,
  playTone,
  readinessLabelKey,
  readinessTone,
} from './diagnostics-presentation';
import fr from '../../../assets/i18n/fr.json';

describe('PACK-PAX-09 Diagnostics presentation', () => {
  it('maps readiness / auth / play to FR label keys without inventing DTO codes', () => {
    assert.equal(readinessLabelKey('READY'), 'readiness.ready');
    assert.equal(authLabelKey('SIGNED_OUT'), 'account.state.signed_out');
    assert.equal(playLabelKey('UNAVAILABLE'), 'diagnostics.play.unavailable');
    assert.equal(playLabelKey('READY'), 'diagnostics.play.ready');
  });

  it('tones stay semantic', () => {
    assert.equal(readinessTone('READY'), 'ok');
    assert.equal(authTone('ERROR'), 'error');
    assert.equal(playTone('LAUNCHING'), 'warn');
  });

  it('assistance and technical i18n keys present', () => {
    const m = fr as Record<string, string>;
    assert.match(m['diagnostics.subtitle'] ?? '', /assistance|support/i);
    assert.equal(m['diagnostics.technical.title'], 'Informations techniques');
    assert.equal(m['diagnostics.dev_tools.title'], 'Outils de développement');
    assert.ok(m['diagnostics.play.running']);
  });
});
