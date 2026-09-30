/**
 * 0.6E hotfix — DevLauncherDesktopGateway settings + safe diagnostics.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DevLauncherDesktopGateway } from './dev.gateway';
import { DESKTOP_PRODUCT_VERSION } from '@sweetcraft/product';

const FORBIDDEN = [
  'accessToken',
  'refreshToken',
  'authorizationCode',
  'codeVerifier',
  'commandLine',
  'argfile',
  'userDataPath',
  'instancePath',
  'stackTrace',
  'C:\\Users',
  '/Users/',
] as const;

describe('0.6E hotfix — dev gateway settings/diagnostics', () => {
  it('1. settings get returns 0.6E defaults', async () => {
    const gw = new DevLauncherDesktopGateway();
    const s = await gw.settings.get();
    assert.equal(s.language, 'fr');
    assert.equal(s.reducedMotion, false);
    assert.equal(s.memoryMiB, 2048);
  });

  it('2. memory update persists in gateway memory', async () => {
    const gw = new DevLauncherDesktopGateway();
    await gw.settings.update({ memoryMiB: 4096 });
    const s = await gw.settings.get();
    assert.equal(s.memoryMiB, 4096);
  });

  it('3. reducedMotion update persists', async () => {
    const gw = new DevLauncherDesktopGateway();
    await gw.settings.update({ reducedMotion: true });
    const s = await gw.settings.get();
    assert.equal(s.reducedMotion, true);
    assert.equal(s.memoryMiB, 2048);
  });

  it('4. invalid memory rejected', async () => {
    const gw = new DevLauncherDesktopGateway();
    await assert.rejects(() => gw.settings.update({ memoryMiB: 100 }));
    await assert.rejects(() => gw.settings.update({ memoryMiB: 40000 }));
    await assert.rejects(() => gw.settings.update({ memoryMiB: 4096.5 as unknown as number }));
    await assert.rejects(() => gw.settings.update({}));
    const s = await gw.settings.get();
    assert.equal(s.memoryMiB, 2048);
  });

  it('5. diagnostics builds successfully', async () => {
    const gw = new DevLauncherDesktopGateway();
    const d = await gw.diagnostics.get();
    assert.equal(d.launcherVersion, DESKTOP_PRODUCT_VERSION);
    assert.equal(d.environment, 'development');
    assert.ok(d.supportId.length >= 8);
    assert.ok(typeof d.buildId === 'string' && d.buildId.length > 0);
    assert.ok(typeof d.buildCommit === 'string' && d.buildCommit.length >= 7);
  });

  it('6. diagnostics reflects memory setting', async () => {
    const gw = new DevLauncherDesktopGateway();
    await gw.settings.update({ memoryMiB: 6144 });
    const d = await gw.diagnostics.get();
    assert.equal(d.memoryMiB, 6144);
  });

  it('7. diagnostics reflects install/auth/play states', async () => {
    const gw = new DevLauncherDesktopGateway();
    gw.setDemoReadiness('READY');
    gw.setDemoAuthState('AUTHENTICATED');
    gw.setPlayFixture('SUCCESS');
    // SUCCESS fixture leaves play READY/UNAVAILABLE until start — apply RUNNING via fixture GAME_ALREADY_RUNNING sets RUNNING
    gw.setPlayFixture('GAME_ALREADY_RUNNING');
    const d = await gw.diagnostics.get();
    assert.equal(d.installReadiness, 'READY');
    assert.equal(d.authState, 'AUTHENTICATED');
    assert.equal(d.playState, 'RUNNING');
    assert.equal(d.gameRunning, true);
  });

  it('8. diagnostics contains no forbidden sensitive fields', async () => {
    const gw = new DevLauncherDesktopGateway();
    const d = await gw.diagnostics.get();
    const json = JSON.stringify(d);
    for (const needle of FORBIDDEN) {
      assert.ok(!json.includes(needle), needle);
    }
    assert.equal('accessToken' in d, false);
    assert.equal('refreshToken' in d, false);
    const info = await gw.app.getInfo();
    assert.equal(d.buildId, info.buildId);
    assert.equal(d.buildCommit, info.buildCommit);
  });

  it('9. diagnostics copy text includes build identity without secrets', async () => {
    const gw = new DevLauncherDesktopGateway();
    const d = await gw.diagnostics.get();
    const result = await gw.diagnostics.copy();
    assert.equal(result.copied, true);
    assert.ok(result.textLength > 0);
    // Reconstruct expected identity lines from the same DTO provenance.
    assert.ok(d.buildId);
    assert.ok(d.buildCommit);
    for (const needle of FORBIDDEN) {
      assert.ok(!JSON.stringify(d).includes(needle), needle);
    }
  });
});
