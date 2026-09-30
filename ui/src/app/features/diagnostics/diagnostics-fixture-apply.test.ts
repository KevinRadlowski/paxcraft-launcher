import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationsService } from '../../core/services/notifications.service.js';
import { translate } from '../../core/i18n/messages.js';
import {
  DEFAULT_FAKE_AUTH_FIXTURE,
  createFakeAuthFixtureFormState,
  fakeAuthFixtureAppliedMessageKey,
  fakeAuthFixtureAppliedParams,
  fixturePayloadToApply,
  markFakeAuthFixtureApplied,
  selectFakeAuthFixture,
} from './fake-auth-fixture-form.js';

/**
 * Simulates Diagnostics applyFakeFixture using component-state authority
 * (same code path as DiagnosticsPageComponent.applyFakeFixture).
 */
async function applyFromState(
  getState: () => ReturnType<typeof createFakeAuthFixtureFormState>,
  setState: (s: ReturnType<typeof createFakeAuthFixtureFormState>) => void,
  gateway: { setAuthFixture: (f: string) => Promise<void> },
  notifications: NotificationsService,
): Promise<void> {
  const fixture = fixturePayloadToApply(getState());
  try {
    await gateway.setAuthFixture(fixture);
    setState(markFakeAuthFixtureApplied(getState(), fixture));
    notifications.show(
      fakeAuthFixtureAppliedMessageKey(),
      'info',
      4000,
      fakeAuthFixtureAppliedParams(fixture),
    );
  } catch {
    notifications.show('error.ipc_invalid', 'error');
  }
}

test('Apply without dropdown change submits SUCCESS from model', async () => {
  let state = createFakeAuthFixtureFormState(DEFAULT_FAKE_AUTH_FIXTURE);
  const received: string[] = [];
  const notifications = new NotificationsService();
  await applyFromState(
    () => state,
    (s) => {
      state = s;
    },
    {
      setAuthFixture: async (f) => {
        received.push(f);
      },
    },
    notifications,
  );
  assert.deepEqual(received, ['SUCCESS']);
  assert.equal(state.lastAppliedFixture, 'SUCCESS');
  const toast = notifications.toasts()[0]!;
  assert.equal(toast.messageKey, 'diagnostics.fake_auth.applied_with_id');
  assert.equal(toast.params?.['fixture'], 'SUCCESS');
  assert.ok(translate(toast.messageKey, toast.params as Record<string, string>).includes('SUCCESS'));
});

test('gateway failure does not claim fixture applied', async () => {
  let state = createFakeAuthFixtureFormState();
  state = selectFakeAuthFixture(state, 'APPID_BLOCKED');
  const notifications = new NotificationsService();
  await applyFromState(
    () => state,
    (s) => {
      state = s;
    },
    {
      setAuthFixture: async () => {
        throw { code: 'IPC_INVALID_PAYLOAD', messageKey: 'error.ipc_invalid' };
      },
    },
    notifications,
  );
  assert.equal(state.lastAppliedFixture, null);
  assert.equal(notifications.toasts()[0]?.messageKey, 'error.ipc_invalid');
  assert.ok(!notifications.toasts().some((t) => t.messageKey.includes('applied')));
});
