/**
 * PACK-10.1G.6.2D — terminal progress must not leave sticky BUSY.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppStore } from './app.store.js';
import {
  isTerminalInstallProgressPhase,
  readinessAfterInstallProgress,
} from './install-progress-readiness.js';
import { mapPrimaryAction } from '../../shared/cta-mapping.js';
import type { InstallProgressDto, LauncherStatusDto } from '@sweetcraft/ipc';

const SERVER = 'sweetcraft.datho.st';

function baseStatus(partial: Partial<LauncherStatusDto>): LauncherStatusDto {
  return {
    readiness: 'READY',
    serverAddress: SERVER,
    activeOperation: 'IDLE',
    ...partial,
  };
}

function progress(
  phase: InstallProgressDto['phase'],
  operation: InstallProgressDto['operation'] = 'move',
): InstallProgressDto {
  return {
    phase,
    operation,
    indeterminate: phase !== 'COMPLETED' && phase !== 'FAILED' && phase !== 'DOWNLOADING',
    ...(phase === 'COMPLETED' ? { percent: 100 } : {}),
  };
}

test('terminal phase helper recognizes COMPLETED and FAILED only', () => {
  assert.equal(isTerminalInstallProgressPhase('COMPLETED'), true);
  assert.equal(isTerminalInstallProgressPhase('FAILED'), true);
  assert.equal(isTerminalInstallProgressPhase('DOWNLOADING'), false);
  assert.equal(isTerminalInstallProgressPhase('APPLYING'), false);
});

test('active non-terminal progress => BUSY', () => {
  assert.equal(readinessAfterInstallProgress('READY', 'IDLE', 'DOWNLOADING'), 'BUSY');
  const store = new AppStore();
  store.applyInstallStatus(baseStatus({ readiness: 'READY' }));
  store.setInstallProgress(progress('DOWNLOADING', 'install'));
  assert.equal(store.effectiveReadiness(), 'BUSY');
  assert.equal(store.isInstallMutationBusy(), true);
});

test('READY → COMPLETED => remains non-busy READY', () => {
  const store = new AppStore();
  store.applyInstallStatus(baseStatus({ readiness: 'READY' }));
  store.setInstallProgress(progress('COMPLETED'));
  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.isInstallMutationBusy(), false);
  assert.equal(store.installProgress()?.phase, 'COMPLETED');
});

test('COMPLETED → READY => READY', () => {
  const store = new AppStore();
  store.beginInstallOperation('INSTALLING');
  store.setInstallProgress(progress('COMPLETED', 'install'));
  // Mutation still marked → may stay busy until status; then READY clears.
  store.applyInstallStatus(baseStatus({ readiness: 'READY', activeOperation: 'IDLE' }));
  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.isInstallMutationBusy(), false);
});

test('REPAIR_REQUIRED → COMPLETED does not become READY', () => {
  const store = new AppStore();
  store.applyInstallStatus(baseStatus({ readiness: 'REPAIR_REQUIRED' }));
  store.setInstallProgress(progress('COMPLETED', 'repair'));
  assert.equal(store.effectiveReadiness(), 'REPAIR_REQUIRED');
  assert.notEqual(store.effectiveReadiness(), 'READY');
  assert.equal(store.isInstallMutationBusy(), false);
});

test('UPDATE_AVAILABLE → COMPLETED does not become READY', () => {
  const store = new AppStore();
  store.applyInstallStatus(baseStatus({ readiness: 'UPDATE_AVAILABLE' }));
  store.setInstallProgress(progress('COMPLETED', 'update'));
  assert.equal(store.effectiveReadiness(), 'UPDATE_AVAILABLE');
  assert.notEqual(store.effectiveReadiness(), 'READY');
  assert.equal(store.isInstallMutationBusy(), false);
});

test('FAILED => non-busy + failure phase preserved (no sticky BUSY)', () => {
  const store = new AppStore();
  store.applyInstallStatus(baseStatus({ readiness: 'READY' }));
  store.setInstallProgress(progress('PREPARING', 'move'));
  assert.equal(store.effectiveReadiness(), 'BUSY');
  store.setInstallProgress(progress('FAILED', 'move'));
  assert.equal(store.installProgress()?.phase, 'FAILED');
  assert.notEqual(store.effectiveReadiness(), 'BUSY');
  assert.equal(store.isInstallMutationBusy(), false);
  // Must not fabricate READY from progress-only BUSY clear
  assert.notEqual(store.effectiveReadiness(), 'READY');
});

test('FAILED preserves authoritative ERROR readiness', () => {
  const store = new AppStore();
  store.applyInstallStatus(
    baseStatus({ readiness: 'ERROR', messageKey: 'error.install.status_check' }),
  );
  store.setInstallProgress(progress('FAILED', 'install'));
  assert.equal(store.effectiveReadiness(), 'ERROR');
  assert.equal(store.isInstallMutationBusy(), false);
});

test('next operation after terminal can enter BUSY normally', () => {
  const store = new AppStore();
  store.applyInstallStatus(baseStatus({ readiness: 'READY' }));
  store.setInstallProgress(progress('COMPLETED'));
  assert.equal(store.isInstallMutationBusy(), false);
  store.beginInstallOperation('UPDATING');
  assert.equal(store.effectiveReadiness(), 'BUSY');
  assert.equal(store.isInstallMutationBusy(), true);
  store.setInstallProgress(progress('DOWNLOADING', 'update'));
  assert.equal(store.effectiveReadiness(), 'BUSY');
});

test('move success ordering READY then COMPLETED → CTA not IN_PROGRESS', () => {
  const store = new AppStore();
  // Mirrors instance-location-service: onLocationChanged status then COMPLETED progress
  store.applyInstallStatus(
    baseStatus({
      readiness: 'READY',
      activeOperation: 'IDLE',
      installedVersion: '0.1.4',
    }),
  );
  store.setInstallProgress(progress('COMPLETED', 'move'));
  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.isInstallMutationBusy(), false);
  const cta = mapPrimaryAction('READY', 'AUTHENTICATED', {
    activeOperation: store.activeOperation(),
    installBusy: store.isInstallMutationBusy(),
  });
  assert.notEqual(cta.kind, 'IN_PROGRESS');
});

test('pure helper: mutation still active keeps BUSY on COMPLETED until status', () => {
  assert.equal(readinessAfterInstallProgress('BUSY', 'INSTALLING', 'COMPLETED'), 'BUSY');
  assert.equal(readinessAfterInstallProgress('BUSY', 'IDLE', 'COMPLETED'), 'UNKNOWN');
  assert.equal(readinessAfterInstallProgress('READY', 'IDLE', 'COMPLETED'), 'READY');
});
