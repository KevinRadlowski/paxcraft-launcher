import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InstallProgressDto } from '../../desktop/shared/contract.js';
import { createInstallProgressAggregator } from '../../desktop/main/install/install-progress-aggregator.js';
import { tryNormalizeInstallProgressEvent } from '../../desktop/main/install/install-progress.js';

describe('InstallProgressAggregator', () => {
  it('known byte total -> correct percentage', () => {
    const out: InstallProgressDto[] = [];
    let t = 0;
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      now: () => t,
      minEmitIntervalMs: 0,
    });

    agg.handleEvent({
      type: 'PLAN_READY',
      data: {
        dryRun: false,
        plannedDownloadBytes: 1000,
        hasUnknownDownloadSize: false,
        plannedDownloadFiles: 1,
      },
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'a', expectedSize: 1000, targetPath: 'pack.jar' },
    });
    t = 100;
    agg.handleEvent({
      type: 'DOWNLOAD_PROGRESS',
      data: { id: 'a', bytesReceived: 430, expectedSize: 1000 },
    });
    agg.flush();

    const last = out[out.length - 1]!;
    assert.equal(last.metricScope, 'download');
    assert.equal(last.percent, 43);
    assert.equal(last.indeterminate, false);
    assert.equal(last.completedBytes, 430);
    assert.equal(last.totalBytes, 1000);
  });

  it('unknown total -> no percentage', () => {
    const out: InstallProgressDto[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'PLANNING' },
    });
    agg.flush();
    const last = out[out.length - 1]!;
    assert.equal(last.percent, undefined);
    assert.equal(last.indeterminate, true);
  });

  it('cumulative download events -> no double count', () => {
    const out: InstallProgressDto[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'a', expectedSize: 100, targetPath: 'f.jar' },
    });
    agg.handleEvent({ type: 'DOWNLOAD_PROGRESS', data: { id: 'a', bytesReceived: 40 } });
    agg.handleEvent({ type: 'DOWNLOAD_PROGRESS', data: { id: 'a', bytesReceived: 80 } });
    agg.flush();
    assert.equal(out[out.length - 1]!.completedBytes, 80);
  });

  it('phase transitions are not swallowed by 250ms throttle', () => {
    const out: InstallProgressDto[] = [];
    let t = 0;
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      fallbackOperation: 'repair',
      now: () => {
        const cur = t;
        return cur;
      },
      minEmitIntervalMs: 250,
    });
    for (const phase of ['INSPECTING', 'RESOLVING', 'PLANNING', 'VERIFYING', 'DONE'] as const) {
      agg.handleEvent({
        type: 'OPERATION_PROGRESS',
        data: { operation: 'repair', phase },
      });
      t += 5;
    }
    agg.flush();
    const phases = out.map((p) => p.phase);
    assert.ok(phases.includes('INSPECTING'));
    assert.ok(phases.includes('PLANNING'));
    assert.ok(phases.includes('VERIFYING'));
    assert.ok(phases.includes('COMPLETED'));
    assert.ok(phases.length >= 4);
  });

  it('throttles high-frequency events', () => {
    const out: InstallProgressDto[] = [];
    let t = 0;
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      now: () => t,
      minEmitIntervalMs: 250,
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'a', expectedSize: 1000, targetPath: 'f.jar' },
    });
    for (let i = 1; i <= 20; i++) {
      t += 10;
      agg.handleEvent({
        type: 'DOWNLOAD_PROGRESS',
        data: { id: 'a', bytesReceived: i * 10 },
      });
    }
    agg.flush();
    const stats = agg.getStats();
    assert.ok(stats.rawEvents >= 22);
    assert.ok(stats.forwardedEvents < stats.rawEvents);
  });

  it('operation success -> final 100%', () => {
    const out: InstallProgressDto[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DONE' },
    });
    agg.flush();
    const last = out[out.length - 1]!;
    assert.equal(last.phase, 'COMPLETED');
    assert.equal(last.percent, 100);
    assert.equal(last.indeterminate, false);
  });

  it('operation failure -> no false 100', () => {
    const out: InstallProgressDto[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({ type: 'OPERATION_FAILED', data: { errorCode: 'NETWORK_ERROR' } });
    agg.flush();
    const last = out[out.length - 1]!;
    assert.equal(last.phase, 'FAILED');
    assert.notEqual(last.percent, 100);
  });

  it('IPC normalization rejects path leakage', () => {
    const dto = tryNormalizeInstallProgressEvent({
      phase: 'DOWNLOADING',
      operation: 'install',
      completedBytes: 10,
      totalBytes: 100,
      currentItemLabel: 'C:\\Users\\secret\\file.jar',
      indeterminate: false,
      percent: 10,
    });
    assert.ok(dto);
    assert.equal(dto!.currentItemLabel, undefined);
  });

  it('fixed download denominator from PLAN_READY stays stable across files', () => {
    const MIB = 1024 * 1024;
    const out: InstallProgressDto[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 0,
    });

    agg.handleEvent({
      type: 'PLAN_READY',
      data: {
        dryRun: false,
        entryCount: 3,
        summary: { download: 3, replace: 0, deleteManaged: 0 },
        plannedDownloadBytes: 100 * MIB,
        hasUnknownDownloadSize: false,
        plannedDownloadFiles: 3,
      },
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'a', expectedSize: 20 * MIB, targetPath: 'a.jar' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_PROGRESS',
      data: { id: 'a', bytesReceived: 10 * MIB },
    });
    agg.flush();
    assert.equal(out[out.length - 1]!.totalBytes, 100 * MIB);

    agg.handleEvent({
      type: 'DOWNLOAD_VERIFIED',
      data: { id: 'a', size: 20 * MIB },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'b', expectedSize: 30 * MIB, targetPath: 'b.jar' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_PROGRESS',
      data: { id: 'b', bytesReceived: 15 * MIB },
    });
    agg.flush();

    for (const dto of out.filter((p) => p.metricScope === 'download' && p.totalBytes !== undefined)) {
      assert.equal(dto.totalBytes, 100 * MIB);
    }
  });

  it('already-valid files excluded from planned download denominator', () => {
    const MIB = 1024 * 1024;
    const out: InstallProgressDto[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'PLAN_READY',
      data: {
        dryRun: false,
        plannedDownloadBytes: 80 * MIB,
        hasUnknownDownloadSize: false,
        plannedDownloadFiles: 2,
      },
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'b', expectedSize: 30 * MIB, targetPath: 'b.jar' },
    });
    agg.flush();
    assert.equal(out[out.length - 1]!.totalBytes, 80 * MIB);
  });

  it('unknown download size -> no bounded byte denominator; ETA absent', () => {
    const MIB = 1024 * 1024;
    const out: InstallProgressDto[] = [];
    let t = 0;
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      now: () => t,
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'PLAN_READY',
      data: {
        dryRun: false,
        plannedDownloadBytes: 20 * MIB,
        hasUnknownDownloadSize: true,
        plannedDownloadFiles: 2,
      },
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'a', expectedSize: 20 * MIB, targetPath: 'a.jar' },
    });
    t = 500;
    agg.handleEvent({
      type: 'DOWNLOAD_PROGRESS',
      data: { id: 'a', bytesReceived: 5 * MIB },
    });
    agg.flush();
    const last = out[out.length - 1]!;
    assert.equal(last.totalBytes, undefined);
    assert.equal(last.etaSeconds, undefined);
    assert.equal(last.metricScope, 'download');
    assert.equal(last.completedBytes, 5 * MIB);
    assert.equal(last.completedFiles, 0);
    assert.equal(last.totalFiles, 2);
  });

  it('bounded download with speed allows ETA', () => {
    const MIB = 1024 * 1024;
    const out: InstallProgressDto[] = [];
    let t = 0;
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      now: () => t,
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'PLAN_READY',
      data: {
        dryRun: false,
        plannedDownloadBytes: 100 * MIB,
        hasUnknownDownloadSize: false,
        plannedDownloadFiles: 1,
      },
    });
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'install', phase: 'DOWNLOADING' },
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'a', expectedSize: 100 * MIB, targetPath: 'a.jar' },
    });
    t = 1000;
    agg.handleEvent({
      type: 'DOWNLOAD_PROGRESS',
      data: { id: 'a', bytesReceived: 50 * MIB },
    });
    agg.flush();
    const last = out[out.length - 1]!;
    assert.equal(last.totalBytes, 100 * MIB);
    assert.ok(last.bytesPerSecond !== undefined && last.bytesPerSecond > 0);
    assert.ok(last.etaSeconds !== undefined && last.etaSeconds > 0);
  });

  it('new operation resets metrics via reset()', () => {
    const out: InstallProgressDto[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 0,
    });
    agg.handleEvent({
      type: 'DOWNLOAD_STARTED',
      data: { id: 'a', expectedSize: 100, targetPath: 'f.jar' },
    });
    agg.reset();
    agg.handleEvent({
      type: 'OPERATION_PROGRESS',
      data: { operation: 'repair', phase: 'VERIFYING' },
    });
    agg.flush();
    assert.equal(out[out.length - 1]!.operation, 'repair');
    assert.equal(out[out.length - 1]!.completedBytes, undefined);
  });
});
