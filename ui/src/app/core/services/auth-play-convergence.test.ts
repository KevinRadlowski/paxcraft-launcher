import assert from 'node:assert/strict';
import test from 'node:test';
import { computed, signal } from '@angular/core';

import { AppStore } from '../state/app.store.js';
import { DevLauncherDesktopGateway } from '../desktop-api/dev.gateway.js';
import { mapPrimaryAction } from '../../shared/cta-mapping.js';
import { PlayActionsService } from './play-actions.service.js';
import { shouldRefreshPlayOnAuthTransition } from './auth-play-convergence.js';

function bindPlayActions(gateway: DevLauncherDesktopGateway, store: AppStore): PlayActionsService {
  const inst = Object.create(PlayActionsService.prototype) as PlayActionsService;
  Object.assign(inst, {
    gateway,
    store,
    notifications: { show: () => undefined },
    busy: signal(false),
    eventsBound: false,
  });
  let refreshCount = 0;
  inst.refreshStatus = async () => {
    refreshCount++;
    await PlayActionsService.prototype.refreshStatus.call(inst);
  };
  (inst as PlayActionsService & { refreshCount: () => number }).refreshCount = () => refreshCount;
  return inst;
}

test('shouldRefreshPlayOnAuthTransition — RESTORING → AUTHENTICATED only', () => {
  assert.equal(shouldRefreshPlayOnAuthTransition('RESTORING', 'AUTHENTICATED'), true);
  assert.equal(shouldRefreshPlayOnAuthTransition('SIGNED_OUT', 'AUTHENTICATED'), true);
  assert.equal(shouldRefreshPlayOnAuthTransition('AUTHENTICATED', 'AUTHENTICATED'), false);
  assert.equal(shouldRefreshPlayOnAuthTransition('RESTORING', 'RESTORING'), false);
  assert.equal(shouldRefreshPlayOnAuthTransition('AUTHENTICATED', 'SIGNED_OUT'), false);
});

test('READY + RESTORING → AUTHENTICATED refreshes play and enables PLAY CTA', async () => {
  const store = new AppStore();
  const gateway = new DevLauncherDesktopGateway();
  const playActions = bindPlayActions(gateway, store);

  gateway.setAuthFixture('RESTORING');
  gateway.setInstallFixture('READY');
  gateway.setPlayFixture('UNAVAILABLE');
  store.applyAuthStateDto(await gateway.auth.getState());
  store.applyInstallStatus({
    readiness: 'READY',
    serverAddress: 'sweetcraft.datho.st',
    activeOperation: 'IDLE',
  });
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  assert.equal(store.effectiveAuthState(), 'RESTORING');
  assert.equal(store.effectivePlayState(), 'UNAVAILABLE');
  assert.equal(
    mapPrimaryAction(store.effectiveReadiness(), store.effectiveAuthState(), {
      playState: store.effectivePlayState(),
    }).kind,
    'IN_PROGRESS',
  );

  const previous = store.effectiveAuthState();
  gateway.setAuthFixture('AUTHENTICATED');
  const dto = await gateway.auth.getState();
  store.applyAuthStateDto(dto);
  if (shouldRefreshPlayOnAuthTransition(previous, dto.state)) {
    await playActions.refreshStatus();
  }

  assert.equal(store.effectiveAuthState(), 'AUTHENTICATED');
  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.effectivePlayState(), 'READY');
  const action = mapPrimaryAction(store.effectiveReadiness(), store.effectiveAuthState(), {
    playState: store.effectivePlayState(),
  });
  assert.equal(action.kind, 'PLAY');
  assert.equal(action.enabled, true);
});

test('update/auth race — stale UNAVAILABLE until auth converges then play refresh', async () => {
  const store = new AppStore();
  const gateway = new DevLauncherDesktopGateway();
  const playActions = bindPlayActions(gateway, store);

  gateway.setAuthFixture('RESTORING');
  gateway.setInstallFixture('READY');
  gateway.setPlayFixture('UNAVAILABLE');
  store.applyInstallStatus({
    readiness: 'READY',
    serverAddress: 'sweetcraft.datho.st',
    activeOperation: 'IDLE',
    installedVersion: '0.1.4',
    latestVersion: '0.1.4',
  });
  store.applyPlayStatus({ state: 'UNAVAILABLE' });

  store.applyAuthStateDto(await gateway.auth.getState());
  assert.equal(store.effectiveAuthState(), 'RESTORING');
  assert.equal(store.effectivePlayState(), 'UNAVAILABLE');
  let previous = store.effectiveAuthState();

  gateway.setAuthFixture('AUTHENTICATED');
  const dto = await gateway.auth.getState();
  if (shouldRefreshPlayOnAuthTransition(previous, dto.state)) {
    store.applyAuthStateDto(dto);
    await playActions.refreshStatus();
  } else {
    store.applyAuthStateDto(dto);
  }
  previous = 'AUTHENTICATED';

  assert.equal(
    mapPrimaryAction('READY', 'AUTHENTICATED', { playState: store.effectivePlayState() }).kind,
    'PLAY',
  );

  gateway.setAuthFixture('AUTHENTICATED');
  const duplicate = await gateway.auth.getState();
  assert.equal(shouldRefreshPlayOnAuthTransition(previous, duplicate.state), false);
});
