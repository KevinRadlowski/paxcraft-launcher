import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InstallByteSpeedTracker,
  computeEtaSeconds,
} from '../../desktop/main/install/install-progress-speed.js';

describe('InstallByteSpeedTracker', () => {
  it('no samples -> no speed', () => {
    const t = new InstallByteSpeedTracker();
    assert.equal(t.observe(0, 1000), undefined);
  });

  it('valid samples -> bounded speed', () => {
    const t = new InstallByteSpeedTracker({ minSpanMs: 500 });
    assert.equal(t.observe(0, 0), undefined);
    const speed = t.observe(850_000, 1000);
    assert.ok(speed !== undefined);
    assert.ok(Math.abs(speed! - 850_000) < 50_000);
  });

  it('zero time delta -> no Infinity', () => {
    const t = new InstallByteSpeedTracker({ minSpanMs: 500 });
    t.observe(100, 1000);
    assert.equal(t.observe(200, 1000), undefined);
  });

  it('counter regression -> reset/rebase', () => {
    const t = new InstallByteSpeedTracker({ minSpanMs: 100 });
    t.observe(1000, 0);
    t.observe(2000, 1000);
    assert.equal(t.observe(500, 1500), undefined);
    assert.equal(t.observe(1500, 2500), undefined);
    const speed = t.observe(2500, 3600);
    assert.ok(speed !== undefined && Number.isFinite(speed));
  });
});

describe('computeEtaSeconds', () => {
  it('unknown total -> suppressed', () => {
    assert.equal(computeEtaSeconds(1000, undefined), undefined);
  });

  it('stable speed -> ETA', () => {
    assert.equal(computeEtaSeconds(1_000_000, 100_000), 10);
  });

  it('completed -> hidden', () => {
    assert.equal(computeEtaSeconds(0, 100_000), undefined);
  });
});
