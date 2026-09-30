import assert from 'node:assert/strict';
import test from 'node:test';
import { AppStore } from './app.store.js';
import { NotificationsService } from '../services/notifications.service.js';
import { readinessBadgeKey } from '../../shared/cta-mapping.js';

test('8. auth progress cleared after success', () => {
  const store = new AppStore();
  store.setAuthRestoring();
  assert.equal(store.authProgressKey(), 'auth.progress.restoring');
  store.applyAuthStateDto({
    state: 'AUTHENTICATED',
    selectedAccountId: 'mc:demo',
    account: { accountId: 'mc:demo', minecraftUsername: 'JoueurDemo' },
  });
  assert.equal(store.authProgressKey(), null);
  assert.equal(store.effectiveAuthState(), 'AUTHENTICATED');
});

test('9. auth progress cleared after logout/terminal state', () => {
  const store = new AppStore();
  store.setAuthProgressKey('auth.progress.authenticated');
  store.applyAuthStateDto({ state: 'SIGNED_OUT' });
  assert.equal(store.authProgressKey(), null);

  store.setAuthProgressKey('auth.progress.restoring');
  store.applyAuthStateDto({
    state: 'REAUTH_REQUIRED',
    error: { code: 'AUTH_REAUTH_REQUIRED', messageKey: 'error.auth_reauth_required' },
  });
  assert.equal(store.authProgressKey(), null);

  store.setAuthProgressKey('x');
  store.applyAuthStateDto({
    state: 'ERROR',
    error: { code: 'AUTH_HTTP_TIMEOUT', messageKey: 'error.network' },
  });
  assert.equal(store.authProgressKey(), null);
});

test('10. toast success auto-dismiss behavior', async () => {
  const n = new NotificationsService();
  n.show('auth.toast.connected', 'success', 20);
  assert.equal(n.toasts().length, 1);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n.toasts().length, 0);
});

test('10b. toast error persists until dismiss', () => {
  const n = new NotificationsService();
  n.show('error.network', 'error');
  assert.equal(n.toasts().length, 1);
  assert.equal(n.toasts()[0]!.durationMs, 0);
  n.dismiss(n.toasts()[0]!.id);
  assert.equal(n.toasts().length, 0);
});

test('11/12. current account presentation — no invented active account', () => {
  const store = new AppStore();
  store.setAccounts([
    { accountId: 'mc:a', minecraftUsername: 'Alice' },
    { accountId: 'mc:b', minecraftUsername: 'Bob' },
  ]);
  assert.equal(store.activeAccountId(), null);
  assert.equal(store.activeAccount(), null);
  store.selectAccount('mc:a');
  assert.equal(store.activeAccount()?.minecraftUsername, 'Alice');
});

test('installation UNKNOWN wording', () => {
  assert.equal(readinessBadgeKey('UNKNOWN'), 'readiness.installation_unknown');
});
