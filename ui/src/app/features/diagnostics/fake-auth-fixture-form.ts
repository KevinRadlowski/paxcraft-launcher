/**
 * Authoritative Diagnostics fake-auth fixture selection (renderer-only).
 * Dropdown display and Apply payload MUST share this single selected value.
 */

export const FAKE_AUTH_FIXTURE_IDS = [
  'SUCCESS',
  'REAUTH_REQUIRED',
  'APPID_BLOCKED',
  'NOT_OWNED',
  'ERROR',
] as const;

export type FakeAuthFixtureId = (typeof FAKE_AUTH_FIXTURE_IDS)[number];

export const DEFAULT_FAKE_AUTH_FIXTURE: FakeAuthFixtureId = 'SUCCESS';

export function isFakeAuthFixtureId(value: string): value is FakeAuthFixtureId {
  return (FAKE_AUTH_FIXTURE_IDS as readonly string[]).includes(value);
}

export interface FakeAuthFixtureFormState {
  /** Authoritative — drives dropdown + Apply payload. */
  selectedFixture: FakeAuthFixtureId;
  /** Last fixture successfully sent to Main (informational). */
  lastAppliedFixture: FakeAuthFixtureId | null;
}

export function createFakeAuthFixtureFormState(
  initial: FakeAuthFixtureId = DEFAULT_FAKE_AUTH_FIXTURE,
): FakeAuthFixtureFormState {
  return {
    selectedFixture: initial,
    lastAppliedFixture: null,
  };
}

/** Value Apply must send — always selectedFixture, never DOM. */
export function fixturePayloadToApply(state: FakeAuthFixtureFormState): FakeAuthFixtureId {
  return state.selectedFixture;
}

export function selectFakeAuthFixture(
  state: FakeAuthFixtureFormState,
  raw: string,
): FakeAuthFixtureFormState {
  if (!isFakeAuthFixtureId(raw)) {
    return state;
  }
  return { ...state, selectedFixture: raw };
}

export function markFakeAuthFixtureApplied(
  state: FakeAuthFixtureFormState,
  applied: FakeAuthFixtureId,
): FakeAuthFixtureFormState {
  return {
    selectedFixture: state.selectedFixture,
    lastAppliedFixture: applied,
  };
}

export function fakeAuthFixtureAppliedMessageKey(): string {
  return 'diagnostics.fake_auth.applied_with_id';
}

export function fakeAuthFixtureAppliedParams(fixture: FakeAuthFixtureId): { fixture: string } {
  return { fixture };
}
