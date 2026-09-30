import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ERROR_MESSAGE_KEYS,
  remapStatusNetworkMessageKey,
  resolveErrorMessageKey,
} from './error-messages.js';

test('resolveErrorMessageKey returns mapped key for known codes', () => {
  assert.equal(resolveErrorMessageKey('NETWORK_ERROR'), 'error.network');
  assert.equal(resolveErrorMessageKey('PLAY_INSTALL_REQUIRED'), 'error.play_install_required');
  assert.equal(resolveErrorMessageKey('INSTANCE_BUSY'), 'error.instance_busy');
  assert.equal(resolveErrorMessageKey('INSTALL_STATUS_ERROR'), 'error.install.status_check');
});

test('resolveErrorMessageKey falls back to generic', () => {
  assert.equal(resolveErrorMessageKey('UNKNOWN_CODE_XYZ'), 'error.generic');
});

test('ERROR_MESSAGE_KEYS has no empty values', () => {
  for (const [code, key] of Object.entries(ERROR_MESSAGE_KEYS)) {
    assert.ok(code.length > 0, 'code must be non-empty');
    assert.ok(key.startsWith('error.'), `key for ${code} must be an error.* key`);
  }
});

test('remapStatusNetworkMessageKey is status-path only; NETWORK_ERROR global stays error.network', () => {
  assert.equal(resolveErrorMessageKey('NETWORK_ERROR'), 'error.network');
  assert.equal(
    remapStatusNetworkMessageKey('NETWORK_ERROR', 'error.install.network'),
    'error.install.status_network',
  );
  assert.equal(
    remapStatusNetworkMessageKey('HTTP_TIMEOUT', 'error.network'),
    'error.install.status_network',
  );
  assert.equal(
    remapStatusNetworkMessageKey('INSTALL_STATUS_ERROR', 'error.install.status_check'),
    'error.install.status_check',
  );
});
