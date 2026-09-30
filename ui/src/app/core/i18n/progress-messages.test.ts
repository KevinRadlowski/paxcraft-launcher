import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from './messages.js';
import {
  resolveAuthProgressMessageKey,
  resolvePlayPhaseMessageKey,
} from './progress-messages.js';

test('resolveAuthProgressMessageKey maps known auth phases', () => {
  assert.equal(
    resolveAuthProgressMessageKey(undefined, 'WAITING_FOR_CALLBACK'),
    'auth.progress.waiting_for_callback',
  );
  assert.equal(
    resolveAuthProgressMessageKey(undefined, 'CHECKING_ENTITLEMENT'),
    'auth.progress.checking_entitlement',
  );
  assert.equal(
    resolveAuthProgressMessageKey(undefined, 'LOADING_PROFILE'),
    'auth.progress.loading_profile',
  );
});

test('resolveAuthProgressMessageKey prefers explicit messageKey when translated', () => {
  assert.equal(
    resolveAuthProgressMessageKey('auth.progress.restoring', 'STARTING'),
    'auth.progress.restoring',
  );
});

test('resolveAuthProgressMessageKey falls back to generic for unknown phases', () => {
  assert.equal(
    resolveAuthProgressMessageKey(undefined, 'UNKNOWN_PHASE_XYZ'),
    'auth.progress.generic',
  );
});

test('translate never surfaces raw auth.progress keys in production UI', () => {
  const text = translate('auth.progress.waiting_for_callback');
  assert.ok(!text.includes('auth.progress.'));
  assert.ok(text.length > 0);
});

test('resolvePlayPhaseMessageKey maps backend phase keys', () => {
  assert.equal(
    resolvePlayPhaseMessageKey('play.phase.preparing', 'LAUNCHING'),
    'play.phase.preparing',
  );
  assert.equal(
    resolvePlayPhaseMessageKey('play.phase.checking_java', 'LAUNCHING'),
    'play.phase.checking_java',
  );
});

test('resolvePlayPhaseMessageKey falls back by play state', () => {
  assert.equal(resolvePlayPhaseMessageKey(undefined, 'LAUNCHING'), 'play.phase.launching');
  assert.equal(resolvePlayPhaseMessageKey(undefined, 'RUNNING'), 'play.phase.running');
});

test('translate never surfaces raw play.phase keys in production UI', () => {
  const preparing = translate('play.phase.preparing');
  const checking = translate('play.phase.checking_java');
  assert.ok(!preparing.includes('play.phase.'));
  assert.ok(!checking.includes('play.phase.'));
});

test('translate uses generic fallback for unknown play.phase keys', () => {
  const text = translate('play.phase.unknown_future_phase');
  assert.equal(text, translate('play.phase.generic'));
  assert.ok(!text.includes('play.phase.unknown'));
});
