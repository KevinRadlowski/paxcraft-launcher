import assert from 'node:assert/strict';
import test from 'node:test';
import { DevLauncherDesktopGateway } from './dev.gateway.js';
import { resolveGateway } from './gateway-resolve.js';

test('dev login success → AUTHENTICATED without tokens', async () => {
  const g = new DevLauncherDesktopGateway();
  g.setAuthFixture('SIGNED_OUT');
  const result = await g.auth.login();
  assert.equal(result.state.state, 'AUTHENTICATED');
  assert.ok(result.state.account?.minecraftUsername);
  const json = JSON.stringify(result);
  assert.ok(!json.includes('accessToken'));
  assert.ok(!json.includes('refreshToken'));
});

test('dev login AppID blocked fixture', async () => {
  const g = new DevLauncherDesktopGateway();
  g.setAuthFixture('APPID_BLOCKED');
  const result = await g.auth.login();
  assert.equal(result.state.error?.code, 'MINECRAFT_APP_NOT_AUTHORIZED');
});

test('dev double login → busy', async () => {
  const g = new DevLauncherDesktopGateway();
  g.setAuthFixture('SIGNED_OUT');
  const p = g.auth.login();
  await assert.rejects(() => g.auth.login(), (e: { code?: string }) => e.code === 'AUTH_OPERATION_BUSY');
  await p;
});

test('production still never selects Dev gateway', () => {
  const g = resolveGateway({ production: true, hasPreload: false, forceDev: true });
  assert.notEqual(g.constructor.name, 'DevLauncherDesktopGateway');
});
