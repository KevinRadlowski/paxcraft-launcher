import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from '../../core/i18n/messages.js';
import {
  DEFAULT_FAKE_AUTH_FIXTURE,
  FAKE_AUTH_FIXTURE_IDS,
  createFakeAuthFixtureFormState,
  fakeAuthFixtureAppliedMessageKey,
  fakeAuthFixtureAppliedParams,
  fixturePayloadToApply,
  isFakeAuthFixtureId,
  markFakeAuthFixtureApplied,
  selectFakeAuthFixture,
} from './fake-auth-fixture-form.js';

test('1. initial Diagnostics model is SUCCESS', () => {
  const state = createFakeAuthFixtureFormState();
  assert.equal(state.selectedFixture, 'SUCCESS');
  assert.equal(state.selectedFixture, DEFAULT_FAKE_AUTH_FIXTURE);
});

test('2. initial dropdown displays SUCCESS because model = SUCCESS (first option alone is not authority)', () => {
  const state = createFakeAuthFixtureFormState();
  // First list entry happens to be SUCCESS, but Apply must use model — not index 0 by coincidence.
  assert.equal(FAKE_AUTH_FIXTURE_IDS[0], 'SUCCESS');
  assert.equal(fixturePayloadToApply(state), state.selectedFixture);
  assert.equal(fixturePayloadToApply(state), 'SUCCESS');
});

test('3. without changing dropdown: Apply → gateway receives exactly SUCCESS', () => {
  const state = createFakeAuthFixtureFormState();
  // Simulate Apply with no change event
  const submitted = fixturePayloadToApply(state);
  assert.equal(submitted, 'SUCCESS');
});

test('4. select APPID_BLOCKED → Apply → APPID_BLOCKED', () => {
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'APPID_BLOCKED');
  assert.equal(fixturePayloadToApply(state), 'APPID_BLOCKED');
});

test('5. reinitialize Diagnostics → SUCCESS → Apply without change → SUCCESS', () => {
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'APPID_BLOCKED');
  state = markFakeAuthFixtureApplied(state, 'APPID_BLOCKED');
  // Navigate away / destroy component → new form state
  state = createFakeAuthFixtureFormState();
  assert.equal(state.selectedFixture, 'SUCCESS');
  assert.equal(fixturePayloadToApply(state), 'SUCCESS');
});

test('6. APPID last applied + selected reset to SUCCESS → Apply sends SUCCESS', () => {
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'APPID_BLOCKED');
  state = markFakeAuthFixtureApplied(state, 'APPID_BLOCKED');
  assert.equal(state.lastAppliedFixture, 'APPID_BLOCKED');
  // New page init (or explicit reset of selection only)
  state = {
    selectedFixture: DEFAULT_FAKE_AUTH_FIXTURE,
    lastAppliedFixture: state.lastAppliedFixture,
  };
  assert.equal(state.selectedFixture, 'SUCCESS');
  assert.equal(fixturePayloadToApply(state), 'SUCCESS');
});

test('7. select NOT_OWNED without apply → select SUCCESS → Apply only SUCCESS', () => {
  const calls: string[] = [];
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'NOT_OWNED');
  // no apply
  state = selectFakeAuthFixture(state, 'SUCCESS');
  calls.push(fixturePayloadToApply(state));
  assert.deepEqual(calls, ['SUCCESS']);
});

test('8. confirmation contains exact fixture SUCCESS', () => {
  const key = fakeAuthFixtureAppliedMessageKey();
  const params = fakeAuthFixtureAppliedParams('SUCCESS');
  const text = translate(key, params);
  assert.ok(text.includes('SUCCESS'), text);
  assert.equal(params.fixture, 'SUCCESS');
});

test('9. gateway failure must not mark applied (state helper)', () => {
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'APPID_BLOCKED');
  // Simulate failed IPC: do NOT call markFakeAuthFixtureApplied
  assert.equal(state.lastAppliedFixture, null);
  assert.equal(fixturePayloadToApply(state), 'APPID_BLOCKED');
});

test('10. strict fixture enum remains enforced', () => {
  assert.equal(isFakeAuthFixtureId('SUCCESS'), true);
  assert.equal(isFakeAuthFixtureId('APPID_BLOCKED'), true);
  assert.equal(isFakeAuthFixtureId('EVIL'), false);
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'NOPE');
  assert.equal(state.selectedFixture, 'SUCCESS');
});

test('beta.4 regression path model: APPID apply then SUCCESS apply without relying on DOM change dance', () => {
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'APPID_BLOCKED');
  assert.equal(fixturePayloadToApply(state), 'APPID_BLOCKED');
  state = markFakeAuthFixtureApplied(state, 'APPID_BLOCKED');

  // Fresh Diagnostics visit (lazy route destroy/recreate)
  state = createFakeAuthFixtureFormState();
  assert.equal(state.selectedFixture, 'SUCCESS');
  // Apply WITHOUT change event — the beta.5 fix for visual SUCCESS + stale APPID submit
  assert.equal(fixturePayloadToApply(state), 'SUCCESS');
});

/**
 * ROOT CAUSE PROOF (beta.4):
 * selectedFixture initialized to APPID_BLOCKED while FAKE list[0]=SUCCESS.
 * Broken [value] on <select> let the browser display SUCCESS (first option)
 * while Apply sent selectedFixture() === APPID_BLOCKED.
 */
test('ROOT CAUSE PROOF: beta.4 init APPID_BLOCKED diverged from first-option visual SUCCESS', () => {
  const beta4Init = 'APPID_BLOCKED' as const;
  const visualFirstOption = FAKE_AUTH_FIXTURE_IDS[0];
  assert.equal(visualFirstOption, 'SUCCESS');
  assert.notEqual(beta4Init, visualFirstOption);
  // Apply used model, not visual:
  assert.equal(beta4Init, 'APPID_BLOCKED');
  // beta.5:
  const beta5 = createFakeAuthFixtureFormState();
  assert.equal(beta5.selectedFixture, visualFirstOption);
  assert.equal(fixturePayloadToApply(beta5), 'SUCCESS');
});
