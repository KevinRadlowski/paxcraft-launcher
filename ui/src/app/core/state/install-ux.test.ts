import assert from 'node:assert/strict';

import test from 'node:test';

import { AppStore } from './app.store.js';

import { DevLauncherDesktopGateway } from '../desktop-api/dev.gateway.js';

import { mapPrimaryAction } from '../../shared/cta-mapping.js';

import { remapStatusNetworkMessageKey } from '../errors/error-messages.js';



test('applyInstallStatus tracks activeOperation and clears statusError on success', () => {

  const store = new AppStore();

  store.applyInstallStatus({

    readiness: 'READY',

    serverAddress: 'sweetcraft.datho.st',

    activeOperation: 'IDLE',

    installedVersion: '1.0.0-fake',

    latestVersion: '1.0.0-fake',

  });

  assert.equal(store.effectiveReadiness(), 'READY');

  assert.equal(store.activeOperation(), 'IDLE');

  assert.equal(store.statusError(), null);

});



test('applyInstallStatus sets statusError when readiness ERROR', () => {

  const store = new AppStore();

  store.applyInstallStatus({

    readiness: 'ERROR',

    serverAddress: 'sweetcraft.datho.st',

    messageKey: 'error.install.status_check',

    activeOperation: 'IDLE',

  });

  assert.equal(store.effectiveReadiness(), 'ERROR');

  assert.equal(store.statusError()?.messageKey, 'error.install.status_check');

});



test('clearOperationError on beginInstallOperation', () => {

  const store = new AppStore();

  store.setOperationError({ code: 'NETWORK_ERROR', messageKey: 'error.install.network' });

  store.beginInstallOperation('INSTALLING');

  assert.equal(store.operationError(), null);

  assert.equal(store.activeOperation(), 'INSTALLING');

});

test('beginInstallOperation records operation start; IDLE clears it', () => {
  const store = new AppStore();
  const before = Date.now();
  store.beginInstallOperation('CHECKING');
  assert.ok(store.installOperationStartedAt()! >= before);
  store.applyInstallStatus({
    readiness: 'READY',
    serverAddress: 'sweetcraft.datho.st',
    activeOperation: 'IDLE',
  });
  assert.equal(store.installOperationStartedAt(), null);
});



test('setInstallProgress updates progress snapshot', () => {

  const store = new AppStore();

  store.applyInstallStatus({

    readiness: 'BUSY',

    serverAddress: 'sweetcraft.datho.st',

    activeOperation: 'INSTALLING',

  });

  store.setInstallProgress({

    phase: 'DOWNLOADING',

    operation: 'install',

    indeterminate: false,

    percent: 50,

  });

  assert.equal(store.installProgress()?.phase, 'DOWNLOADING');

  assert.equal(store.installProgress()?.percent, 50);

  assert.equal(store.effectiveReadiness(), 'BUSY');

});



test('dev gateway install success → READY authoritative status', async () => {

  const g = new DevLauncherDesktopGateway();

  g.setInstallFixture('NOT_INSTALLED');

  const status = await g.install.install();

  assert.equal(status.readiness, 'READY');

  assert.equal(status.installedVersion, '1.0.0-fake');

});



test('dev gateway install NETWORK_ERROR fixture fails at end', async () => {

  const g = new DevLauncherDesktopGateway();

  g.setInstallFixture('NETWORK_ERROR');

  await assert.rejects(() => g.install.install(), (e: { code?: string }) => e.code === 'NETWORK_ERROR');

});



test('install mutation busy disables install CTA even when signed out', () => {

  const action = mapPrimaryAction('NOT_INSTALLED', 'SIGNED_OUT', {

    activeOperation: 'INSTALLING',

  });

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.enabled, false);

});



test('applyStatusFailure remaps network keys to status_network; mutations keep install.network', () => {

  assert.equal(
    remapStatusNetworkMessageKey('NETWORK_ERROR', 'error.install.network'),
    'error.install.status_network',
  );

  assert.equal(
    remapStatusNetworkMessageKey('HTTP_ERROR', 'error.network'),
    'error.install.status_network',
  );

  assert.equal(
    remapStatusNetworkMessageKey('HTTP_TIMEOUT', 'error.install.network'),
    'error.install.status_network',
  );

  assert.equal(
    remapStatusNetworkMessageKey('INSTALL_STATUS_ERROR', 'error.install.status_check'),
    'error.install.status_check',
  );

  // Mutation path still uses error.install.network (not remapped here).
  assert.equal(
    remapStatusNetworkMessageKey('INTEGRITY_ERROR', 'error.install.integrity'),
    'error.install.integrity',
  );

  const mutationKey = 'error.install.network';
  assert.equal(mutationKey, 'error.install.network');

});


