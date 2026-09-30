import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeOperationElapsedMs,
  createInstallElapsedTickerController,
  resolveInstallDisplayElapsedMs,
  shouldShowInstallElapsed,
} from './install-elapsed-display.js';
import { buildInstallProgressDetails } from './install-progress-format.js';

test('human discrepancy: stale backend elapsed advances via renderer clock', () => {
  const startedAt = 1_000;
  const backendSnapshotMs = 200;
  const nowMs = 9_000;

  const display = resolveInstallDisplayElapsedMs({
    operationStartedAt: startedAt,
    nowMs,
    activeOperation: 'CHECKING',
    backendElapsedMs: backendSnapshotMs,
  });
  assert.equal(display, 8_000);

  const details = buildInstallProgressDetails(
    {
      phase: 'INSPECTING',
      operation: 'status',
      indeterminate: true,
      elapsedMs: backendSnapshotMs,
    },
    {
      downloadScope: 'Téléchargement',
      filesScope: 'Fichiers',
      elapsed: (d) => `Temps écoulé : ${d}`,
    },
    { displayElapsedMs: display },
  );
  assert.equal(details.elapsedLine, 'Temps écoulé : 8 s');
});

test('elapsed hidden below 1 second', () => {
  assert.equal(shouldShowInstallElapsed(999), false);
  assert.equal(
    buildInstallProgressDetails(
      { phase: 'INSPECTING', operation: 'status', indeterminate: true },
      { downloadScope: '', filesScope: '', elapsed: (d) => d },
      { displayElapsedMs: 900 },
    ).elapsedLine,
    undefined,
  );
});

test('elapsed visible from 1 second', () => {
  const line = buildInstallProgressDetails(
    { phase: 'INSPECTING', operation: 'status', indeterminate: true },
    { downloadScope: '', filesScope: '', elapsed: (d) => `Temps écoulé : ${d}` },
    { displayElapsedMs: 1_000 },
  ).elapsedLine;
  assert.equal(line, 'Temps écoulé : 1 s');
});

test('phase transition does not reset operation elapsed', () => {
  const startedAt = 5_000;
  const afterPhaseChange = resolveInstallDisplayElapsedMs({
    operationStartedAt: startedAt,
    nowMs: 12_000,
    activeOperation: 'REPAIRING',
  });
  assert.equal(afterPhaseChange, 7_000);
});

test('idle operation yields no display elapsed', () => {
  assert.equal(
    resolveInstallDisplayElapsedMs({
      operationStartedAt: 1_000,
      nowMs: 10_000,
      activeOperation: 'IDLE',
    }),
    undefined,
  );
});

test('ticker starts once, stops on completion, resets on new operation', () => {
  let active = true;
  let ticks = 0;
  const intervals: Array<() => void> = [];
  const controller = createInstallElapsedTickerController({
    isActive: () => active,
    onTick: () => {
      ticks += 1;
    },
    setIntervalFn: (handler) => {
      intervals.push(handler);
      return intervals.length as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => undefined,
  });

  controller.sync();
  assert.equal(controller.isRunning(), true);
  controller.sync();
  assert.equal(intervals.length, 1, 'single interval');

  intervals[0]!();
  intervals[0]!();
  assert.equal(ticks, 2);

  active = false;
  controller.sync();
  assert.equal(controller.isRunning(), false);

  active = true;
  controller.sync();
  assert.equal(intervals.length, 2, 'new operation starts fresh interval');

  controller.dispose();
  assert.equal(controller.isRunning(), false);
});

test('computeOperationElapsedMs is whole-operation duration', () => {
  assert.equal(computeOperationElapsedMs(100, 5_600), 5_500);
});
