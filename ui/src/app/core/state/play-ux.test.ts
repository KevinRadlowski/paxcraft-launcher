import assert from 'node:assert/strict';
import test from 'node:test';
import { AppStore } from './app.store.js';
import { DevLauncherDesktopGateway } from '../desktop-api/dev.gateway.js';
import { mapPrimaryAction, isPlayBlockingMutations } from '../../shared/cta-mapping.js';

test('applyPlayStatus tracks lifecycle and isPlayBusy', () => {
  const store = new AppStore();
  store.applyPlayStatus({ state: 'READY', messageKey: 'play.message.ready' });
  assert.equal(store.effectivePlayState(), 'READY');
  assert.equal(store.isPlayBusy(), false);

  store.applyPlayStatus({ state: 'LAUNCHING', phaseKey: 'play.phase.launching' });
  assert.equal(store.isPlayBusy(), true);

  store.applyPlayStatus({ state: 'RUNNING', phaseKey: 'play.phase.running' });
  assert.equal(store.isPlayBusy(), true);
  assert.equal(store.playError(), null);
});

test('applyPlayStatus sets playError on ERROR state', () => {
  const store = new AppStore();
  store.applyPlayStatus({
    state: 'ERROR',
    error: { code: 'SPAWN_FAILURE', messageKey: 'error.play.spawn_failure' },
  });
  assert.equal(store.playError()?.messageKey, 'error.play.spawn_failure');
});

test('clearPlayError clears stale error', () => {
  const store = new AppStore();
  store.setPlayError({ code: 'INTERNAL_ERROR', messageKey: 'error.play.generic' });
  store.clearPlayError();
  assert.equal(store.playError(), null);
});

test('play status distinct from install readiness', () => {
  const store = new AppStore();
  store.applyInstallStatus({
    readiness: 'READY',
    serverAddress: 'sweetcraft.datho.st',
    activeOperation: 'IDLE',
  });
  store.applyPlayStatus({ state: 'LAUNCHING' });
  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.effectivePlayState(), 'LAUNCHING');
});

test('dev gateway play SUCCESS lifecycle', async () => {
  const g = new DevLauncherDesktopGateway();
  g.setInstallFixture('READY');
  g.setAuthFixture('AUTHENTICATED');
  g.setPlayFixture('SUCCESS');

  const ready = await g.play.getStatus();
  assert.equal(ready.state, 'READY');

  const running = await g.play.start();
  assert.equal(running.state, 'RUNNING');

  const exited = await g.dev!.simulatePlayExit!({ exitCode: 0 });
  assert.equal(exited.state, 'EXITED');
});

test('isPlayBlockingMutations blocks install CTA when RUNNING', () => {
  assert.equal(isPlayBlockingMutations('RUNNING'), true);
  assert.equal(isPlayBlockingMutations('READY'), false);

  const action = mapPrimaryAction('NOT_INSTALLED', 'AUTHENTICATED', {
    playState: 'RUNNING',
  });
  assert.equal(action.kind, 'IN_PROGRESS');
  assert.equal(action.labelKey, 'play.message.running');
  assert.equal(action.enabled, false);
});
