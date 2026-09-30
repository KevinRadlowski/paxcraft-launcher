import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installProgressFallbackLabelKey,
  resolveInstallCardPresentation,
} from './install-card-presentation.js';
import { mapPrimaryAction } from './cta-mapping.js';

test('READY + REPAIRING: card does not claim ready to play', () => {
  const card = resolveInstallCardPresentation('READY', 'REPAIRING');
  assert.equal(card.headlineKey, 'home.card.install.headline.maintenance');
  assert.notEqual(card.supportKey, 'home.card.install.support.ready');
});

test('READY + CHECKING: card shows verification in progress', () => {
  const card = resolveInstallCardPresentation('READY', 'CHECKING');
  assert.equal(card.headlineKey, 'home.card.install.headline.verifying');
  assert.notEqual(card.supportKey, 'home.card.install.support.ready');
});

test('READY + IDLE: card returns to ready presentation', () => {
  const card = resolveInstallCardPresentation('READY', 'IDLE');
  assert.equal(card.headlineKey, 'home.card.install.headline.ready');
  assert.equal(card.supportKey, 'home.card.install.support.ready');
});

test('REPAIRING busy CTA disabled with operation-specific progress fallback', () => {
  const cta = mapPrimaryAction('READY', 'AUTHENTICATED', {
    activeOperation: 'REPAIRING',
    installBusy: true,
  });
  assert.equal(cta.enabled, false);
  assert.equal(installProgressFallbackLabelKey('REPAIRING'), 'install.progress.inspecting');
});

test('UNINSTALLING uses dedicated card and progress fallback', () => {
  const card = resolveInstallCardPresentation('READY', 'UNINSTALLING');
  assert.equal(card.headlineKey, 'home.card.install.headline.uninstalling');
  assert.equal(installProgressFallbackLabelKey('UNINSTALLING'), 'install.progress.uninstalling');
});
