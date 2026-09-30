import assert from 'node:assert/strict';
import test from 'node:test';
import { computed, signal } from '@angular/core';
import type { StorageSummaryDto } from '@sweetcraft/ipc';

import { AppStore } from '../state/app.store.js';
import { DevLauncherDesktopGateway } from '../desktop-api/dev.gateway.js';
import { mapPrimaryAction } from '../../shared/cta-mapping.js';
import { InstallActionsService } from './install-actions.service.js';
import { PlayActionsService } from './play-actions.service.js';

function bindService<T extends object>(
  prototype: T,
  deps: Record<string, unknown>,
): T {
  const inst = Object.create(prototype) as T;
  Object.assign(inst, deps);
  return inst;
}

async function syncAuth(store: AppStore, gateway: DevLauncherDesktopGateway): Promise<void> {
  const dto = await gateway.auth.getState();
  store.applyAuthStateDto(dto);
}

function createHarness() {
  const store = new AppStore();
  const gateway = new DevLauncherDesktopGateway();
  const notifications = { show: () => undefined };

  const playActions = bindService(PlayActionsService.prototype, {
    gateway,
    store,
    notifications,
    busy: signal(false),
    eventsBound: false,
  });
  playActions.refreshStatus = PlayActionsService.prototype.refreshStatus.bind(playActions);

  const storageSummarySignal = signal<StorageSummaryDto | null>(null);
  const installActions = bindService(InstallActionsService.prototype, {
    gateway,
    store,
    notifications,
    playActions,
    busy: signal(false),
    storageSummarySignal,
    eventsBound: false,
  });
  installActions.storageSummary = storageSummarySignal.asReadonly();
  installActions.instanceDirectoryAvailable = computed(
    () => storageSummarySignal()?.instanceAvailable === true,
  );
  installActions.subscribeEvents = InstallActionsService.prototype.subscribeEvents.bind(
    installActions,
  );
  installActions.refreshStorageSummary =
    InstallActionsService.prototype.refreshStorageSummary.bind(installActions);
  installActions.install = InstallActionsService.prototype.install.bind(installActions);
  installActions.update = InstallActionsService.prototype.update.bind(installActions);
  installActions.repair = InstallActionsService.prototype.repair.bind(installActions);

  return { store, gateway, playActions, installActions };
}

function primaryCta(store: AppStore) {
  return mapPrimaryAction(store.effectiveReadiness(), store.effectiveAuthState(), {
    activeOperation: store.activeOperation(),
    installBusy: false,
    playState: store.effectivePlayState(),
    playBusy: false,
  });
}

test('stale play UNAVAILABLE blocks PLAY until install success refreshes play status', async () => {
  const { store, gateway, installActions } = createHarness();

  gateway.setAuthFixture('AUTHENTICATED');
  gateway.setInstallFixture('NOT_INSTALLED');
  await syncAuth(store, gateway);

  store.applyInstallStatus({
    readiness: 'NOT_INSTALLED',
    serverAddress: 'sweetcraft.datho.st',
    activeOperation: 'IDLE',
  });
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  assert.equal(primaryCta(store).kind, 'INSTALL');

  await installActions.install();

  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.effectivePlayState(), 'READY');
  assert.equal(primaryCta(store).kind, 'PLAY');
  assert.equal(primaryCta(store).enabled, true);
});

test('successful update refreshes play status after readiness convergence', async () => {
  const { store, gateway, installActions } = createHarness();

  gateway.setAuthFixture('AUTHENTICATED');
  gateway.setInstallFixture('UPDATE_AVAILABLE');
  await syncAuth(store, gateway);
  store.applyInstallStatus({
    readiness: 'UPDATE_AVAILABLE',
    serverAddress: 'sweetcraft.datho.st',
    activeOperation: 'IDLE',
    installedVersion: '1.0.0-fake',
    latestVersion: '1.0.1-fake',
  });
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  await installActions.update();

  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.effectivePlayState(), 'READY');
  assert.equal(primaryCta(store).kind, 'PLAY');
});

test('successful repair refreshes play status after readiness convergence', async () => {
  const { store, gateway, installActions } = createHarness();

  gateway.setAuthFixture('AUTHENTICATED');
  gateway.setInstallFixture('REPAIR_REQUIRED');
  await syncAuth(store, gateway);
  store.applyInstallStatus({
    readiness: 'REPAIR_REQUIRED',
    serverAddress: 'sweetcraft.datho.st',
    activeOperation: 'IDLE',
  });
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  await installActions.repair();

  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.effectivePlayState(), 'READY');
  assert.equal(primaryCta(store).kind, 'PLAY');
});

test('failed install does not converge to PLAY', async () => {
  const { store, gateway, installActions } = createHarness();

  gateway.setAuthFixture('AUTHENTICATED');
  gateway.setInstallFixture('NETWORK_ERROR');
  await syncAuth(store, gateway);
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  await installActions.install();

  assert.notEqual(store.effectiveReadiness(), 'READY');
  assert.notEqual(primaryCta(store).kind, 'PLAY');
  assert.ok(store.operationError());
});

test('READY + authenticated + stale UNAVAILABLE → UNAVAILABLE CTA before refresh', () => {
  const action = mapPrimaryAction('READY', 'AUTHENTICATED', { playState: 'UNAVAILABLE' });
  assert.equal(action.kind, 'UNAVAILABLE');
  assert.equal(action.enabled, false);
});

test('unauthenticated user does not get PLAY after install convergence', async () => {
  const { store, gateway, installActions } = createHarness();

  gateway.setAuthFixture('SIGNED_OUT');
  gateway.setInstallFixture('NOT_INSTALLED');
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  await installActions.install();

  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(primaryCta(store).kind, 'SIGN_IN');
});

test('install success with play refresh failure does not enable PLAY', async () => {
  const { store, gateway, installActions } = createHarness();

  gateway.setAuthFixture('AUTHENTICATED');
  gateway.setInstallFixture('NOT_INSTALLED');
  await syncAuth(store, gateway);
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  gateway.play.getStatus = async () => {
    throw { code: 'NETWORK_ERROR', messageKey: 'error.network' };
  };

  await installActions.install();

  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.effectivePlayState(), 'ERROR');
  assert.notEqual(primaryCta(store).kind, 'PLAY');
  assert.ok(store.playError());
});

test('game already running remains blocked after install', async () => {
  const { store, gateway, installActions } = createHarness();

  gateway.setAuthFixture('AUTHENTICATED');
  gateway.setInstallFixture('NOT_INSTALLED');
  gateway.setPlayFixture('GAME_ALREADY_RUNNING');
  await syncAuth(store, gateway);
  store.applyPlayStatus({ state: 'RUNNING' });

  await installActions.install();

  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.effectivePlayState(), 'RUNNING');
  const action = primaryCta(store);
  assert.equal(action.kind, 'IN_PROGRESS');
  assert.equal(action.enabled, false);
});
