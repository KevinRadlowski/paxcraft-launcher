import assert from 'node:assert/strict';

import test from 'node:test';

import { translate } from '../../core/i18n/messages.js';

import {

  DEFAULT_FAKE_INSTALL_FIXTURE,

  FAKE_INSTALL_FIXTURE_IDS,

  createFakeInstallFixtureFormState,

  fakeInstallFixtureAppliedMessageKey,

  fakeInstallFixtureAppliedParams,

  fixturePayloadToApply,

  isFakeInstallFixtureId,

  markFakeInstallFixtureApplied,

  selectFakeInstallFixture,

} from './fake-install-fixture-form.js';



test('1. initial Diagnostics model is NOT_INSTALLED', () => {

  const state = createFakeInstallFixtureFormState();

  assert.equal(state.selectedFixture, 'NOT_INSTALLED');

  assert.equal(state.selectedFixture, DEFAULT_FAKE_INSTALL_FIXTURE);

});



test('2. initial dropdown displays NOT_INSTALLED from model authority', () => {

  const state = createFakeInstallFixtureFormState();

  assert.equal(FAKE_INSTALL_FIXTURE_IDS[0], 'NOT_INSTALLED');

  assert.equal(fixturePayloadToApply(state), state.selectedFixture);

  assert.equal(fixturePayloadToApply(state), 'NOT_INSTALLED');

});



test('3. without changing dropdown: Apply → NOT_INSTALLED', () => {

  const state = createFakeInstallFixtureFormState();

  assert.equal(fixturePayloadToApply(state), 'NOT_INSTALLED');

});



test('4. select UPDATE_AVAILABLE → Apply → UPDATE_AVAILABLE', () => {

  let state = createFakeInstallFixtureFormState();

  state = selectFakeInstallFixture(state, 'UPDATE_AVAILABLE');

  assert.equal(fixturePayloadToApply(state), 'UPDATE_AVAILABLE');

});



test('5. reinitialize Diagnostics → NOT_INSTALLED → Apply without change', () => {

  let state = createFakeInstallFixtureFormState();

  state = selectFakeInstallFixture(state, 'NETWORK_ERROR');

  state = markFakeInstallFixtureApplied(state, 'NETWORK_ERROR');

  state = createFakeInstallFixtureFormState();

  assert.equal(fixturePayloadToApply(state), 'NOT_INSTALLED');

});



test('6. NETWORK_ERROR last applied + selected reset → Apply sends NOT_INSTALLED', () => {

  let state = createFakeInstallFixtureFormState();

  state = selectFakeInstallFixture(state, 'NETWORK_ERROR');

  state = markFakeInstallFixtureApplied(state, 'NETWORK_ERROR');

  state = {

    selectedFixture: DEFAULT_FAKE_INSTALL_FIXTURE,

    lastAppliedFixture: state.lastAppliedFixture,

  };

  assert.equal(fixturePayloadToApply(state), 'NOT_INSTALLED');

});



test('7. confirmation contains exact fixture NOT_INSTALLED', () => {

  const key = fakeInstallFixtureAppliedMessageKey();

  const params = fakeInstallFixtureAppliedParams('NOT_INSTALLED');

  const text = translate(key, params);

  assert.ok(text.includes('NOT_INSTALLED'), text);

});



test('8. strict fixture enum enforced', () => {

  assert.equal(isFakeInstallFixtureId('NOT_INSTALLED'), true);

  assert.equal(isFakeInstallFixtureId('EVIL'), false);

  let state = createFakeInstallFixtureFormState();

  state = selectFakeInstallFixture(state, 'NOPE');

  assert.equal(state.selectedFixture, 'NOT_INSTALLED');

});


