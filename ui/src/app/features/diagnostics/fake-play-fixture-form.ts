/**
 * Authoritative Diagnostics fake-play fixture selection (renderer-only).
 * Dropdown display and Apply payload MUST share this single selected value.
 */

export const FAKE_PLAY_FIXTURE_IDS = [
  'SUCCESS',
  'GAME_ALREADY_RUNNING',
  'ACCOUNT_MISMATCH',
  'JAVA_UNAVAILABLE',
  'SPAWN_FAILURE',
  'BIND_FAILURE',
  'NONZERO_EXIT',
  'MALFORMED_LOCK',
  'GENERIC_ERROR',
] as const;

export type FakePlayFixtureId = (typeof FAKE_PLAY_FIXTURE_IDS)[number];

export const DEFAULT_FAKE_PLAY_FIXTURE: FakePlayFixtureId = 'SUCCESS';

export function isFakePlayFixtureId(value: string): value is FakePlayFixtureId {
  return (FAKE_PLAY_FIXTURE_IDS as readonly string[]).includes(value);
}

export interface FakePlayFixtureFormState {
  /** Authoritative — drives dropdown + Apply payload. */
  selectedFixture: FakePlayFixtureId;
  /** Last fixture successfully sent to Main (informational). */
  lastAppliedFixture: FakePlayFixtureId | null;
}

export function createFakePlayFixtureFormState(
  initial: FakePlayFixtureId = DEFAULT_FAKE_PLAY_FIXTURE,
): FakePlayFixtureFormState {
  return {
    selectedFixture: initial,
    lastAppliedFixture: null,
  };
}

/** Value Apply must send — always selectedFixture, never DOM. */
export function fixturePayloadToApply(state: FakePlayFixtureFormState): FakePlayFixtureId {
  return state.selectedFixture;
}

export function selectFakePlayFixture(
  state: FakePlayFixtureFormState,
  raw: string,
): FakePlayFixtureFormState {
  if (!isFakePlayFixtureId(raw)) {
    return state;
  }
  return { ...state, selectedFixture: raw };
}

export function markFakePlayFixtureApplied(
  state: FakePlayFixtureFormState,
  applied: FakePlayFixtureId,
): FakePlayFixtureFormState {
  return {
    selectedFixture: state.selectedFixture,
    lastAppliedFixture: applied,
  };
}

export function fakePlayFixtureAppliedMessageKey(): string {
  return 'diagnostics.fake_play.applied_with_id';
}

export function fakePlayFixtureAppliedParams(fixture: FakePlayFixtureId): { fixture: string } {
  return { fixture };
}
