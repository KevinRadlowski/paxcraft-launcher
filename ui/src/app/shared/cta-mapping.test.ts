import assert from 'node:assert/strict';

import test from 'node:test';

import {

  isPlayBlockingMutations,

  mapPrimaryAction,

  readinessBadgeKey,

  readinessBadgeVariant,

} from './cta-mapping.js';



test('NOT_INSTALLED → INSTALLER', () => {

  const action = mapPrimaryAction('NOT_INSTALLED', 'SIGNED_OUT');

  assert.equal(action.kind, 'INSTALL');

  assert.equal(action.enabled, true);

});



test('READY + signed out → SE CONNECTER Microsoft', () => {

  const action = mapPrimaryAction('READY', 'SIGNED_OUT');

  assert.equal(action.kind, 'SIGN_IN');

  assert.equal(action.labelKey, 'cta.sign_in_microsoft');

});



test('READY + REAUTH → SE RECONNECTER', () => {

  const action = mapPrimaryAction('READY', 'REAUTH_REQUIRED');

  assert.equal(action.kind, 'REAUTH');

  assert.equal(action.labelKey, 'cta.reauth');

});



test('READY + authenticated + play READY → JOUER enabled', () => {

  const action = mapPrimaryAction('READY', 'AUTHENTICATED', { playState: 'READY' });

  assert.equal(action.kind, 'PLAY');

  assert.equal(action.enabled, true);

});



test('READY + authenticated + play UNAVAILABLE → Indisponible (stale play path)', () => {

  const action = mapPrimaryAction('READY', 'AUTHENTICATED', { playState: 'UNAVAILABLE' });

  assert.equal(action.kind, 'UNAVAILABLE');

  assert.equal(action.enabled, false);

});



test('READY + authenticated + play LAUNCHING → launching label disabled', () => {

  const action = mapPrimaryAction('READY', 'AUTHENTICATED', { playState: 'LAUNCHING' });

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.labelKey, 'play.message.launching');

  assert.equal(action.enabled, false);

});



test('READY + authenticated + play RUNNING → running label disabled', () => {

  const action = mapPrimaryAction('READY', 'AUTHENTICATED', { playState: 'RUNNING' });

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.labelKey, 'play.message.running');

  assert.equal(action.enabled, false);

});



test('UPDATE_AVAILABLE beats play READY', () => {

  const action = mapPrimaryAction('UPDATE_AVAILABLE', 'AUTHENTICATED', { playState: 'READY' });

  assert.equal(action.kind, 'UPDATE');

  assert.equal(action.enabled, true);

});



test('playBusy blocks install CTA', () => {

  const action = mapPrimaryAction('NOT_INSTALLED', 'SIGNED_OUT', { playBusy: true });

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.enabled, false);

});



test('isPlayBlockingMutations', () => {

  assert.equal(isPlayBlockingMutations('LAUNCHING'), true);

  assert.equal(isPlayBlockingMutations('RUNNING'), true);

  assert.equal(isPlayBlockingMutations('READY'), false);

  assert.equal(isPlayBlockingMutations(undefined), false);

});



test('RESTORING → in progress', () => {

  const action = mapPrimaryAction('READY', 'RESTORING');

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.enabled, false);

});



test('UNKNOWN readiness → UNAVAILABLE (not INSTALL)', () => {

  const action = mapPrimaryAction('UNKNOWN', 'SIGNED_OUT');

  assert.equal(action.kind, 'UNAVAILABLE');

});



test('CHECKING → disabled Vérification label', () => {

  const action = mapPrimaryAction('CHECKING', 'SIGNED_OUT');

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.labelKey, 'readiness.checking');

  assert.equal(action.enabled, false);

});



test('ERROR → VERIFY enabled', () => {

  const action = mapPrimaryAction('ERROR', 'SIGNED_OUT');

  assert.equal(action.kind, 'VERIFY');

  assert.equal(action.labelKey, 'cta.verify_status');

  assert.equal(action.enabled, true);

});



test('activeOperation UNINSTALLING → IN_PROGRESS regardless of auth', () => {
  const cta = mapPrimaryAction('READY', 'AUTHENTICATED', {
    activeOperation: 'UNINSTALLING',
    installBusy: true,
  });
  assert.equal(cta.kind, 'IN_PROGRESS');
  assert.equal(cta.enabled, false);
});

test('activeOperation INSTALLING → IN_PROGRESS regardless of auth', () => {

  const action = mapPrimaryAction('NOT_INSTALLED', 'SIGNED_OUT', {

    activeOperation: 'INSTALLING',

  });

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.enabled, false);

});



test('RECOVERY_REQUIRED → ACTION_REQUIRED (no install CTA)', () => {

  const action = mapPrimaryAction('RECOVERY_REQUIRED', 'AUTHENTICATED');

  assert.equal(action.kind, 'ACTION_REQUIRED');

  assert.equal(action.enabled, false);

});



test('BUSY readiness → IN_PROGRESS', () => {

  const action = mapPrimaryAction('BUSY', 'AUTHENTICATED');

  assert.equal(action.kind, 'IN_PROGRESS');

  assert.equal(action.enabled, false);

});



test('readinessBadgeKey covers all readiness values', () => {

  const values = [

    'NOT_INSTALLED',

    'READY',

    'UPDATE_AVAILABLE',

    'REPAIR_REQUIRED',

    'BUSY',

    'CHECKING',

    'ERROR',

    'INCOMPATIBLE_STATE',

    'RECOVERY_REQUIRED',

    'UNKNOWN',

  ] as const;

  for (const v of values) {

    assert.ok(readinessBadgeKey(v).startsWith('readiness.'));

    assert.ok(readinessBadgeVariant(v));

  }

});


