/**

 * Authoritative Diagnostics fake-install fixture selection (renderer-only).

 * Dropdown display and Apply payload MUST share this single selected value.

 */



export const FAKE_INSTALL_FIXTURE_IDS = [

  'NOT_INSTALLED',

  'READY',

  'UPDATE_AVAILABLE',

  'REPAIR_REQUIRED',

  'RECOVERY_REQUIRED',

  'BUSY',

  'NETWORK_ERROR',

  'INTEGRITY_ERROR',

  'GENERIC_ERROR',

] as const;



export type FakeInstallFixtureId = (typeof FAKE_INSTALL_FIXTURE_IDS)[number];



export const DEFAULT_FAKE_INSTALL_FIXTURE: FakeInstallFixtureId = 'NOT_INSTALLED';



export function isFakeInstallFixtureId(value: string): value is FakeInstallFixtureId {

  return (FAKE_INSTALL_FIXTURE_IDS as readonly string[]).includes(value);

}



export interface FakeInstallFixtureFormState {

  /** Authoritative — drives dropdown + Apply payload. */

  selectedFixture: FakeInstallFixtureId;

  /** Last fixture successfully sent to Main (informational). */

  lastAppliedFixture: FakeInstallFixtureId | null;

}



export function createFakeInstallFixtureFormState(

  initial: FakeInstallFixtureId = DEFAULT_FAKE_INSTALL_FIXTURE,

): FakeInstallFixtureFormState {

  return {

    selectedFixture: initial,

    lastAppliedFixture: null,

  };

}



/** Value Apply must send — always selectedFixture, never DOM. */

export function fixturePayloadToApply(state: FakeInstallFixtureFormState): FakeInstallFixtureId {

  return state.selectedFixture;

}



export function selectFakeInstallFixture(

  state: FakeInstallFixtureFormState,

  raw: string,

): FakeInstallFixtureFormState {

  if (!isFakeInstallFixtureId(raw)) {

    return state;

  }

  return { ...state, selectedFixture: raw };

}



export function markFakeInstallFixtureApplied(

  state: FakeInstallFixtureFormState,

  applied: FakeInstallFixtureId,

): FakeInstallFixtureFormState {

  return {

    selectedFixture: state.selectedFixture,

    lastAppliedFixture: applied,

  };

}



export function fakeInstallFixtureAppliedMessageKey(): string {

  return 'diagnostics.fake_install.applied_with_id';

}



export function fakeInstallFixtureAppliedParams(fixture: FakeInstallFixtureId): {

  fixture: string;

} {

  return { fixture };

}


