import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from '../../core/i18n/messages.js';
import {
  DEFAULT_FAKE_PLAY_FIXTURE,
  FAKE_PLAY_FIXTURE_IDS,
  createFakePlayFixtureFormState,
  fakePlayFixtureAppliedMessageKey,
  fakePlayFixtureAppliedParams,
  fixturePayloadToApply,
  isFakePlayFixtureId,
  markFakePlayFixtureApplied,
  selectFakePlayFixture,
} from './fake-play-fixture-form.js';

test('1. initial Diagnostics model is SUCCESS', () => {
  const state = createFakePlayFixtureFormState();
  assert.equal(state.selectedFixture, 'SUCCESS');
  assert.equal(state.selectedFixture, DEFAULT_FAKE_PLAY_FIXTURE);
});

test('2. initial dropdown displays SUCCESS from model authority', () => {
  const state = createFakePlayFixtureFormState();
  assert.equal(FAKE_PLAY_FIXTURE_IDS[0], 'SUCCESS');
  assert.equal(fixturePayloadToApply(state), state.selectedFixture);
  assert.equal(fixturePayloadToApply(state), 'SUCCESS');
});

test('3. without changing dropdown: Apply → SUCCESS', () => {
  const state = createFakePlayFixtureFormState();
  assert.equal(fixturePayloadToApply(state), 'SUCCESS');
});

test('4. select SPAWN_FAILURE → Apply → SPAWN_FAILURE', () => {
  let state = createFakePlayFixtureFormState();
  state = selectFakePlayFixture(state, 'SPAWN_FAILURE');
  assert.equal(fixturePayloadToApply(state), 'SPAWN_FAILURE');
});

test('5. reinitialize Diagnostics → SUCCESS → Apply without change', () => {
  let state = createFakePlayFixtureFormState();
  state = selectFakePlayFixture(state, 'JAVA_UNAVAILABLE');
  state = markFakePlayFixtureApplied(state, 'JAVA_UNAVAILABLE');
  state = createFakePlayFixtureFormState();
  assert.equal(fixturePayloadToApply(state), 'SUCCESS');
});

test('6. confirmation contains exact fixture SUCCESS', () => {
  const key = fakePlayFixtureAppliedMessageKey();
  const params = fakePlayFixtureAppliedParams('SUCCESS');
  const text = translate(key, params);
  assert.ok(text.includes('SUCCESS'), text);
});

test('7. strict fixture enum enforced', () => {
  assert.equal(isFakePlayFixtureId('SUCCESS'), true);
  assert.equal(isFakePlayFixtureId('EVIL'), false);
  let state = createFakePlayFixtureFormState();
  state = selectFakePlayFixture(state, 'NOPE');
  assert.equal(state.selectedFixture, 'SUCCESS');
});
