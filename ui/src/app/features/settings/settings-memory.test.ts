/**
 * Settings memory UX helpers (0.6F.4 V2) — presentation only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEMORY_DEFAULT,
  MEMORY_MAX,
  MEMORY_MIN,
  METRIC_RING_CIRCUMFERENCE,
  clampMemory,
  diskUsedPercent,
  formatDiskCapacityGiB,
  formatDiskFreeSurTotal,
  formatMemoryLabel,
  memoryUsedPercent,
  ringStrokeDasharray,
} from './settings-memory';

describe('0.6F.4 settings memory UX helpers', () => {
  it('clamps below min and above max', () => {
    assert.equal(clampMemory(0), MEMORY_MIN);
    assert.equal(clampMemory(999999), MEMORY_MAX);
  });

  it('formats Mo/Go clearly', () => {
    assert.equal(formatMemoryLabel(4096), '4096 Mo (4 Go)');
    assert.equal(formatMemoryLabel(1536), '1536 Mo (1.5 Go)');
    assert.equal(formatMemoryLabel(MEMORY_DEFAULT), '2048 Mo (2 Go)');
  });

  it('steps to 512 MiB increments', () => {
    assert.equal(clampMemory(4000), 4096);
    assert.equal(clampMemory(2300), 2048);
  });

  it('ram percent only when total+free known', () => {
    assert.equal(memoryUsedPercent(8192, 4096), 50);
    assert.equal(memoryUsedPercent(null, 4096), null);
    assert.equal(memoryUsedPercent(8192, null), null);
    assert.equal(memoryUsedPercent(0, 0), null);
  });

  it('diskUsedPercent mirrors RAM formula (used = total − free)', () => {
    assert.equal(diskUsedPercent(100, 40), 60);
    assert.equal(diskUsedPercent(512, 256), 50);
    assert.equal(diskUsedPercent(null, 40), null);
    assert.equal(diskUsedPercent(100, null), null);
    assert.equal(diskUsedPercent(0, 0), null);
    assert.equal(diskUsedPercent(10, 15), 0);
  });

  it('ringStrokeDasharray scales circumference', () => {
    assert.equal(ringStrokeDasharray(null), `0 ${METRIC_RING_CIRCUMFERENCE}`);
    assert.equal(ringStrokeDasharray(0), `0 ${METRIC_RING_CIRCUMFERENCE}`);
    assert.equal(ringStrokeDasharray(100), `${METRIC_RING_CIRCUMFERENCE} ${METRIC_RING_CIRCUMFERENCE}`);
    assert.equal(ringStrokeDasharray(50), `${METRIC_RING_CIRCUMFERENCE / 2} ${METRIC_RING_CIRCUMFERENCE}`);
  });

  it('formatDiskCapacityGiB uses Go below 1024 and To at/above with French comma', () => {
    assert.equal(formatDiskCapacityGiB(59.1), '59,1 Go');
    assert.equal(formatDiskCapacityGiB(930.5), '930,5 Go');
    assert.equal(formatDiskCapacityGiB(1023.9), '1023,9 Go');
    assert.equal(formatDiskCapacityGiB(1024), '1 To');
    assert.equal(formatDiskCapacityGiB(1.27 * 1024), '1,27 To');
    assert.equal(formatDiskCapacityGiB(1.82 * 1024), '1,82 To');
  });

  it('formatDiskFreeSurTotal builds FR free-sur-total line', () => {
    assert.equal(formatDiskFreeSurTotal(59.1, 930.5), '59,1 Go libres sur 930,5 Go');
    assert.equal(
      formatDiskFreeSurTotal(1.27 * 1024, 1.82 * 1024),
      '1,27 To libres sur 1,82 To',
    );
  });
});
