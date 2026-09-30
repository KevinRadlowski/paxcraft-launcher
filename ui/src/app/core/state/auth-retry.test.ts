import assert from 'node:assert/strict';
import test from 'node:test';
import { AppStore } from './app.store.js';

test('beta.4: setAuthRestoring clears stale UiError before next op', () => {
  const store = new AppStore();
  store.setAuthError({
    code: 'MINECRAFT_APP_NOT_AUTHORIZED',
    messageKey: 'error.minecraft_app_not_authorized',
  });
  assert.equal(store.authError()?.code, 'MINECRAFT_APP_NOT_AUTHORIZED');
  store.setAuthRestoring();
  assert.equal(store.authError(), null);
  assert.equal(store.effectiveAuthState(), 'RESTORING');
});

test('beta.4: AUTHENTICATED clears previous APPID error', () => {
  const store = new AppStore();
  store.setAuthError({
    code: 'MINECRAFT_APP_NOT_AUTHORIZED',
    messageKey: 'error.minecraft_app_not_authorized',
  });
  const account = {
    accountId: 'mc:11111111-1111-1111-1111-111111111111',
    minecraftUsername: 'JoueurDemo',
  };
  store.applyAuthStateDto(
    {
      state: 'AUTHENTICATED',
      selectedAccountId: account.accountId,
      account,
    },
    [account],
  );
  assert.equal(store.effectiveAuthState(), 'AUTHENTICATED');
  assert.equal(store.authError(), null);
  assert.equal(store.activeAccount()?.minecraftUsername, 'JoueurDemo');
});
