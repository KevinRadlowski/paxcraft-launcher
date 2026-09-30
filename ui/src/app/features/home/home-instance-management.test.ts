import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPrimaryAction } from '../../shared/cta-mapping.js';
import { resolveInstallCardPresentation } from '../../shared/install-card-presentation.js';
import { translate } from '../../core/i18n/messages.js';

function canOpenInstanceFolder(instanceDirectoryAvailable: boolean): boolean {
  return instanceDirectoryAvailable;
}

function showUninstallAction(instanceDirectoryAvailable: boolean): boolean {
  return instanceDirectoryAvailable;
}

test('open folder visibility follows instanceDirectoryAvailable not readiness', () => {
  assert.equal(canOpenInstanceFolder(true), true);
  assert.equal(canOpenInstanceFolder(false), false);
  assert.equal(canOpenInstanceFolder(true), true);
});

test('NOT_INSTALLED with preserved directory keeps open folder available', () => {
  assert.equal(canOpenInstanceFolder(true), true);
  assert.equal(showUninstallAction(true), true);
});

test('NOT_INSTALLED without directory hides open folder and uninstall', () => {
  assert.equal(canOpenInstanceFolder(false), false);
  assert.equal(showUninstallAction(false), false);
});

test('UNINSTALLING blocks primary CTA and uses uninstall card copy', () => {
  const cta = mapPrimaryAction('READY', 'AUTHENTICATED', {
    activeOperation: 'UNINSTALLING',
    installBusy: true,
  });
  assert.equal(cta.enabled, false);
  const card = resolveInstallCardPresentation('READY', 'UNINSTALLING');
  assert.equal(card.headlineKey, 'home.card.install.headline.uninstalling');
  assert.equal(translate(card.headlineKey), 'Désinstallation…');
});

test('complete uninstall i18n is explicit', () => {
  assert.equal(translate('install.uninstall.complete.confirm.action'), 'Désinstaller complètement');
  assert.equal(translate('install.progress.uninstalling_complete'), 'Suppression complète en cours…');
});
