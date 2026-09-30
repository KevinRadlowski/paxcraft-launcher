/**
 * AppStore footer clear rules for pack/auth network sticky keys (0.6F.4 V3).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppStore } from './app.store.js';

test('clearPackNetworkFooterError clears pack_check always', () => {
  const store = new AppStore();
  store.setError('error.network.pack_check');
  store.clearPackNetworkFooterError();
  assert.equal(store.error(), null);
});

test('clearPackNetworkFooterError clears legacy error.network only when status non-null', () => {
  const store = new AppStore();
  store.setError('error.network');
  store.setLauncherStatus(null);
  store.clearPackNetworkFooterError();
  assert.equal(store.error(), 'error.network');

  store.setLauncherStatus({
    readiness: 'READY',
    serverAddress: 'sweetcraft.datho.st',
  });
  store.clearPackNetworkFooterError();
  assert.equal(store.error(), null);
});

test('clearPackNetworkFooterError does not clear auth or bridge keys', () => {
  const store = new AppStore();
  store.setLauncherStatus({
    readiness: 'READY',
    serverAddress: 'sweetcraft.datho.st',
  });
  store.setError('error.network.auth');
  store.clearPackNetworkFooterError();
  assert.equal(store.error(), 'error.network.auth');

  store.setError('error.desktop_bridge_unavailable');
  store.clearPackNetworkFooterError();
  assert.equal(store.error(), 'error.desktop_bridge_unavailable');
});

test('MC server ONLINE does not clear pack_check; successful refreshStatus clear does', () => {
  const store = new AppStore();
  store.setError('error.network.pack_check');
  // HomeServerStatusService ONLINE path never touches AppStore.error / clearPackNetworkFooterError.
  assert.equal(store.error(), 'error.network.pack_check');
  // InstallActionsService.refreshStatus success calls clearPackNetworkFooterError.
  store.clearPackNetworkFooterError();
  assert.equal(store.error(), null);
});

test('applyAuthStateDto AUTHENTICATED clears error.network.auth only', () => {
  const store = new AppStore();
  store.setError('error.network.auth');
  store.applyAuthStateDto({
    state: 'AUTHENTICATED',
    selectedAccountId: 'mc:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    account: {
      accountId: 'mc:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      minecraftUsername: 'Steve',
    },
  });
  assert.equal(store.error(), null);

  store.setError('error.network.pack_check');
  store.applyAuthStateDto({ state: 'AUTHENTICATED' });
  assert.equal(store.error(), 'error.network.pack_check');
});
