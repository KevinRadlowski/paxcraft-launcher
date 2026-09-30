import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AppInfoDto,
  AuthState,
  LauncherReadiness,
  LauncherStatusDto,
  SafeAccountDto,
  SettingsDto,
} from '../../../../desktop/shared/contract.ts';
import { runBootstrap, type BootstrapStore } from './bootstrap-logic.js';

class MemoryStore implements BootstrapStore {
  private _initialized = false;
  private _loading = true;
  private _error: string | null = null;
  private _info: AppInfoDto | null = null;
  private _status: LauncherStatusDto | null = null;
  private _accounts: SafeAccountDto[] = [];
  private _settings: SettingsDto | null = null;
  private _auth: AuthState = 'UNKNOWN';
  private demoAllowed = false;
  private demo: { readiness: LauncherReadiness; authState: AuthState } | null = null;

  initialized(): boolean {
    return this._initialized;
  }
  loading(): boolean {
    return this._loading;
  }
  error(): string | null {
    return this._error;
  }
  info(): AppInfoDto | null {
    return this._info;
  }
  accounts(): SafeAccountDto[] {
    return this._accounts;
  }
  settings(): SettingsDto | null {
    return this._settings;
  }
  authState(): AuthState {
    return this._auth;
  }
  demoFixtureActive(): boolean {
    return this.demoAllowed && this.demo !== null;
  }

  effectiveReadiness(): LauncherReadiness {
    if (this.demoAllowed && this.demo) return this.demo.readiness;
    return this._status?.readiness ?? 'UNKNOWN';
  }

  setDemoAllowed(allowed: boolean): void {
    this.demoAllowed = allowed;
    if (!allowed) this.demo = null;
  }
  setLoading(loading: boolean): void {
    this._loading = loading;
  }
  setError(error: string | null): void {
    this._error = error;
  }
  setAppInfo(info: AppInfoDto): void {
    this._info = info;
  }
  setLauncherStatus(status: LauncherStatusDto | null): void {
    this._status = status;
  }
  setAccounts(accounts: SafeAccountDto[]): void {
    this._accounts = accounts;
  }
  setSettings(settings: SettingsDto | null): void {
    this._settings = settings;
  }
  setInitialized(value: boolean): void {
    this._initialized = value;
  }
  setAuthRestoring(): void {
    this._auth = 'RESTORING';
  }
  setSignedOut(): void {
    this._auth = 'SIGNED_OUT';
  }
  applyAuthStateDto(dto: { state: AuthState }): void {
    this._auth = dto.state;
  }
  applyDemoFixture(fixture: { readiness: LauncherReadiness; authState: AuthState } | null): void {
    if (!this.demoAllowed) return;
    this.demo = fixture;
  }
}

test('bootstrap all success retains data and initializes', async () => {
  const store = new MemoryStore();
  await runBootstrap(store, {
    kind: 'dev',
    getInfo: async () => ({
      name: 'SweetCraft Launcher',
      version: '0.6.0-beta.1',
      platform: 'win32',
      environment: 'development',
    }),
    getStatus: async () => ({
      readiness: 'READY',
      serverAddress: 'sweetcraft.datho.st',
      packVersion: '0.1.2',
    }),
    listAccounts: async () => [],
    getSettings: async () => ({ language: 'fr', reducedMotion: false, memoryMiB: 2048 }),
    restoreAuth: async () => ({
      state: { state: 'SIGNED_OUT' },
      accounts: [],
    }),
  });
  assert.equal(store.initialized(), true);
  assert.equal(store.loading(), false);
  assert.equal(store.info()?.version, '0.6.0-beta.1');
  assert.equal(store.effectiveReadiness(), 'READY');
  assert.equal(store.authState(), 'SIGNED_OUT');
});

test('status failure only → UNKNOWN readiness, shell still up', async () => {
  const store = new MemoryStore();
  await runBootstrap(store, {
    kind: 'electron',
    getInfo: async () => ({
      name: 'SweetCraft Launcher',
      version: '0.6.0-beta.1',
      platform: 'win32',
      environment: 'production',
    }),
    getStatus: async () => {
      throw { code: 'HTTP_ERROR', messageKey: 'error.network' };
    },
    listAccounts: async () => [],
    getSettings: async () => ({ language: 'fr', reducedMotion: true }),
    restoreAuth: async () => ({ state: { state: 'SIGNED_OUT' }, accounts: [] }),
  });
  assert.equal(store.initialized(), true);
  assert.equal(store.effectiveReadiness(), 'UNKNOWN');
  assert.notEqual(store.effectiveReadiness(), 'NOT_INSTALLED');
  assert.equal(store.error(), 'error.network.pack_check');
});

test('auth restore network failure → error.network.auth sticky key', async () => {
  const store = new MemoryStore();
  await runBootstrap(store, {
    kind: 'electron',
    getInfo: async () => ({
      name: 'SweetCraft Launcher',
      version: '0.6.0-beta.1',
      platform: 'win32',
      environment: 'production',
    }),
    getStatus: async () => ({
      readiness: 'READY',
      serverAddress: 'sweetcraft.datho.st',
    }),
    listAccounts: async () => [
      { accountId: 'mc:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', minecraftUsername: 'Steve' },
    ],
    getSettings: async () => ({ language: 'fr', reducedMotion: false }),
    restoreAuth: async () => {
      throw { code: 'AUTH_HTTP_TIMEOUT', messageKey: 'error.network' };
    },
  });
  assert.equal(store.initialized(), true);
  assert.equal(store.authState(), 'SIGNED_OUT');
  assert.equal(store.accounts().length, 1);
  assert.equal(store.error(), 'error.network.auth');
});

test('auth restore non-network failure keeps resolveErrorMessageKey mapping', async () => {
  const store = new MemoryStore();
  await runBootstrap(store, {
    kind: 'electron',
    getInfo: async () => ({
      name: 'SweetCraft Launcher',
      version: '0.6.0-rc.16',
      platform: 'win32',
      environment: 'production',
    }),
    getStatus: async () => ({
      readiness: 'READY',
      serverAddress: 'sweetcraft.datho.st',
    }),
    listAccounts: async () => [
      { accountId: 'mc:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', minecraftUsername: 'Steve' },
    ],
    getSettings: async () => ({ language: 'fr', reducedMotion: false }),
    restoreAuth: async () => {
      throw { code: 'AUTH_REQUEST_ABORTED', messageKey: 'error.auth_aborted' };
    },
  });
  assert.equal(store.error(), 'error.auth_aborted');
});
