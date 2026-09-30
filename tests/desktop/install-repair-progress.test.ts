/**
 * PACK-10.1D.1 — healthy repair / verify progress propagation (no downloads).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InstallProgressDto } from '../../desktop/shared/contract.js';
import {
  FakeInstallBackend,
  InstallDesktopService,
  createInstallProgressAggregator,
} from '../../desktop/main/install/index.js';

/** Realistic healthy repair noop sequence from frozen 0.5A execute.ts (skipRuntimePrep). */
const HEALTHY_REPAIR_NOOP_SEQUENCE = [
  { type: 'OPERATION_PROGRESS', data: { operation: 'repair', phase: 'INSPECTING' } },
  { type: 'OPERATION_PROGRESS', data: { operation: 'repair', phase: 'RESOLVING' } },
  { type: 'OPERATION_PROGRESS', data: { operation: 'repair', phase: 'PLANNING' } },
  { type: 'PLAN_READY', data: { dryRun: true, entryCount: 117, summary: { download: 0, replace: 0, deleteManaged: 0 } } },
  { type: 'OPERATION_PROGRESS', data: { operation: 'repair', phase: 'DONE' } },
] as const;

/** Status check sequence from inspectInstanceStatus on a healthy install. */
const HEALTHY_STATUS_CHECK_SEQUENCE = [
  { type: 'OPERATION_PROGRESS', data: { operation: 'status', phase: 'RESOLVING' } },
  { type: 'OPERATION_PROGRESS', data: { operation: 'status', phase: 'INSPECTING' } },
  { type: 'OPERATION_PROGRESS', data: { operation: 'status', phase: 'DONE' } },
] as const;

function feedSequence(
  agg: ReturnType<typeof createInstallProgressAggregator>,
  sequence: readonly { type: string; data: Record<string, unknown> }[],
  advanceMs: number,
  clock: { t: number },
): void {
  for (const event of sequence) {
    agg.handleEvent({ type: event.type, data: event.data });
    clock.t += advanceMs;
  }
  agg.flush();
}

describe('healthy repair progress propagation', () => {
  it('forwards semantic phases to renderer DTOs without download metrics', () => {
    const out: InstallProgressDto[] = [];
    const clock = { t: 0 };
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      fallbackOperation: 'repair',
      now: () => clock.t,
      minEmitIntervalMs: 250,
    });

    feedSequence(agg, HEALTHY_REPAIR_NOOP_SEQUENCE, 300, clock);

    const phases = out.map((p) => p.phase);
    assert.ok(phases.includes('INSPECTING'), 'inspection phase reaches renderer');
    assert.ok(phases.includes('PLANNING'), 'planning phase reaches renderer');
    assert.ok(phases.includes('COMPLETED'), 'terminal phase reaches renderer');

    const last = out[out.length - 1]!;
    assert.equal(last.operation, 'repair');
    assert.equal(last.completedBytes, undefined);
    assert.equal(last.totalBytes, undefined);
    assert.equal(last.bytesPerSecond, undefined);
    assert.equal(last.etaSeconds, undefined);
    assert.ok(last.elapsedMs !== undefined && last.elapsedMs >= 0);
  });

  it('status check sequence reaches specific phases (verify / CHECKING path)', () => {
    const out: InstallProgressDto[] = [];
    const clock = { t: 0 };
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      fallbackOperation: 'status',
      now: () => clock.t,
      minEmitIntervalMs: 250,
    });

    feedSequence(agg, HEALTHY_STATUS_CHECK_SEQUENCE, 300, clock);

    const phases = out.map((p) => p.phase);
    assert.ok(phases.includes('RESOLVING_RELEASE'));
    assert.ok(phases.includes('INSPECTING'));
    assert.ok(phases.includes('COMPLETED'));
  });

  it('InstallDesktopService.getStatus forwards progress during CHECKING', async () => {
    const backend = new FakeInstallBackend({ stepDelayMs: 0 });
    backend.applyFixture('READY');
    const phases: InstallProgressDto['phase'][] = [];
    const svc = new InstallDesktopService(backend, {
      onStatus() {},
      onProgress(p) {
        phases.push(p.phase);
      },
    });
    const st = await svc.getStatus();
    assert.equal(st.readiness, 'READY');
    assert.equal(st.activeOperation, 'IDLE');
    assert.ok(phases.includes('INSPECTING'));
    assert.ok(phases.includes('COMPLETED'));
  });
});
