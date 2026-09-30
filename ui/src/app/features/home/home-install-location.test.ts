import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPrimaryAction } from '../../shared/cta-mapping';
import { translate } from '../../core/i18n/messages';
import {
  confirmFirstInstallLocation,
  normalizeInstallLocationPath,
  resolveInstallLocationDisplayPath,
  shouldCommitInstallLocation,
  shouldOpenFirstInstallLocationModal,
} from './install-location-flow';

test('shouldOpenFirstInstallLocationModal is true only for NOT_INSTALLED', () => {
  assert.equal(shouldOpenFirstInstallLocationModal('NOT_INSTALLED'), true);
  assert.equal(shouldOpenFirstInstallLocationModal('READY'), false);
  assert.equal(shouldOpenFirstInstallLocationModal('UPDATE_AVAILABLE'), false);
  assert.equal(shouldOpenFirstInstallLocationModal('REPAIR_REQUIRED'), false);
  assert.equal(shouldOpenFirstInstallLocationModal('LOCATION_UNAVAILABLE'), false);
});

test('READY primary CTA remains Jouer without install location modal', () => {
  const action = mapPrimaryAction('READY', 'AUTHENTICATED', { playState: 'READY' });
  assert.equal(action.kind, 'PLAY');
  assert.equal(action.labelKey, 'cta.play');
});

test('resolveInstallLocationDisplayPath prefers settings then storage summary', () => {
  assert.equal(
    resolveInstallLocationDisplayPath('C:\\Custom\\B', 'C:\\Legacy\\sweetcraft'),
    'C:\\Custom\\B',
  );
  assert.equal(
    resolveInstallLocationDisplayPath(undefined, 'C:\\Users\\Me\\launcher-data\\instances\\sweetcraft'),
    'C:\\Users\\Me\\launcher-data\\instances\\sweetcraft',
  );
});

test('shouldCommitInstallLocation skips when candidate equals persisted', () => {
  assert.equal(
    shouldCommitInstallLocation('C:\\A', 'C:\\A'),
    false,
  );
  assert.equal(
    shouldCommitInstallLocation('C:/A', 'C:\\A'),
    false,
  );
  assert.equal(
    shouldCommitInstallLocation('C:\\A', 'C:\\B'),
    true,
  );
});

test('NOT_INSTALLED default path: confirm without commit starts install', async () => {
  const calls: string[] = [];
  const defaultPath = 'C:\\Users\\Me\\AppData\\Roaming\\SweetCraft Launcher\\launcher-data\\instances\\sweetcraft';
  const result = await confirmFirstInstallLocation(defaultPath, {
    persistedPath: defaultPath,
    setLocation: async () => {
      calls.push('setLocation');
    },
    install: async () => {
      calls.push('install');
    },
  });
  assert.equal(result.outcome, 'installed');
  assert.deepEqual(calls, ['install']);
});

test('NOT_INSTALLED custom choice commits location before install', async () => {
  const calls: string[] = [];
  const custom = 'D:\\Games\\SweetCraft';
  const result = await confirmFirstInstallLocation(custom, {
    persistedPath: 'C:\\Legacy\\sweetcraft',
    setLocation: async (path) => {
      calls.push(`setLocation:${path}`);
    },
    install: async () => {
      calls.push('install');
    },
  });
  assert.equal(result.outcome, 'installed');
  assert.equal(result.locationCommitted, true);
  assert.deepEqual(calls, [`setLocation:${custom}`, 'install']);
});

test('cancel semantics: candidate change does not affect persisted until confirm', () => {
  const persistedAtOpen = 'C:\\SweetCraft-E2E-A';
  let candidate = persistedAtOpen;
  candidate = 'C:\\SweetCraft-E2E-B';
  assert.notEqual(normalizeInstallLocationPath(candidate), normalizeInstallLocationPath(persistedAtOpen));
  assert.equal(persistedAtOpen, 'C:\\SweetCraft-E2E-A');
});

test('non-empty rejection: setLocation failure keeps persisted path and skips install', async () => {
  const calls: string[] = [];
  const persisted = 'C:\\SweetCraft-E2E-A';
  const result = await confirmFirstInstallLocation('C:\\SweetCraft-E2E-NONEMPTY', {
    persistedPath: persisted,
    setLocation: async () => {
      calls.push('setLocation');
      const err = { messageKey: 'error.instance.location.not_empty', code: 'INSTANCE_LOCATION_NOT_EMPTY' };
      throw err;
    },
    install: async () => {
      calls.push('install');
    },
  });
  assert.equal(result.outcome, 'location_error');
  assert.equal(result.persistedPath, persisted);
  assert.deepEqual(calls, ['setLocation']);
  assert.match(translate(result.errorKey), /n'est pas vide/i);
});

test('existing custom location B is displayed and used on confirm', async () => {
  const customB = 'C:\\SweetCraft-E2E-B';
  const displayed = resolveInstallLocationDisplayPath(customB, 'C:\\Legacy\\sweetcraft');
  assert.equal(displayed, customB);
  const calls: string[] = [];
  const result = await confirmFirstInstallLocation(customB, {
    persistedPath: customB,
    setLocation: async () => {
      calls.push('setLocation');
    },
    install: async () => {
      calls.push('install');
    },
  });
  assert.equal(result.outcome, 'installed');
  assert.deepEqual(calls, ['install']);
});

test('setLocation success with install failure keeps committed location', async () => {
  const custom = 'D:\\SweetCraft-E2E-B';
  const result = await confirmFirstInstallLocation(custom, {
    persistedPath: 'C:\\Old',
    setLocation: async () => {},
    install: async () => {
      throw new Error('install failed');
    },
  });
  assert.equal(result.outcome, 'install_error');
  assert.equal(result.persistedPath, custom);
  assert.equal(result.locationCommitted, true);
});

test('install location modal French copy exists', () => {
  assert.match(translate('install.location.title'), /Installer SweetCraft/i);
  assert.match(translate('install.location.body'), /emplacement/i);
  assert.match(translate('install.location.hint'), /paramètres/i);
  assert.equal(translate('install.location.confirm'), 'Installer');
  assert.equal(translate('install.location.cancel'), 'Annuler');
});

/** Simulates lifecycle onLocationChanged → install.getStatus() CHECKING overlay. */
async function simulateLocationChangedRefresh(
  opts: { awaitRefresh: boolean },
): Promise<{ refreshInFlight: boolean }> {
  let inFlight = false;
  const refresh = (async () => {
    inFlight = true;
    await new Promise((r) => setTimeout(r, 15));
    inFlight = false;
  })();
  if (opts.awaitRefresh) {
    await refresh;
    return { refreshInFlight: false };
  }
  await new Promise((r) => setImmediate(r));
  return { refreshInFlight: inFlight };
}

test('first custom confirm: awaited setLocation refresh then install succeeds once', async () => {
  const calls: string[] = [];
  const custom = 'E:\\Jeux\\SweetCraft';
  const result = await confirmFirstInstallLocation(custom, {
    persistedPath: 'C:\\Legacy\\sweetcraft',
    setLocation: async (path) => {
      calls.push(`setLocation:${path}`);
      await simulateLocationChangedRefresh({ awaitRefresh: true });
    },
    install: async () => {
      calls.push('install');
    },
  });
  assert.equal(result.outcome, 'installed');
  assert.deepEqual(calls, [`setLocation:${custom}`, 'install']);
});

test('first custom confirm: fire-and-forget refresh reproduces false busy on install()', async () => {
  const calls: string[] = [];
  let refreshInFlight = false;
  const result = await confirmFirstInstallLocation('E:\\Jeux\\SweetCraft', {
    persistedPath: 'C:\\Legacy\\sweetcraft',
    setLocation: async (path) => {
      calls.push(`setLocation:${path}`);
      ({ refreshInFlight } = await simulateLocationChangedRefresh({ awaitRefresh: false }));
    },
    install: async () => {
      calls.push('install');
      if (refreshInFlight) {
        throw { code: 'INSTANCE_BUSY', messageKey: 'error.install.busy' };
      }
    },
  });
  assert.equal(result.outcome, 'install_error');
  assert.equal(refreshInFlight, true);
  assert.deepEqual(calls, ['setLocation:E:\\Jeux\\SweetCraft', 'install']);
  assert.match(translate('error.install.busy'), /déjà en cours/i);
});

test('cancel: no setLocation and no install when confirm never runs', async () => {
  const calls: string[] = [];
  assert.equal(calls.length, 0);
});

test('COMPLETE restart NOT_INSTALLED: custom path first install sequence', async () => {
  const calls: string[] = [];
  const custom = 'E:\\Jeux\\SweetCraft';
  const result = await confirmFirstInstallLocation(custom, {
    persistedPath: '',
    setLocation: async (path) => {
      calls.push(`setLocation:${path}`);
    },
    install: async () => {
      calls.push('install');
    },
  });
  assert.equal(result.outcome, 'installed');
  assert.equal(result.locationCommitted, true);
  assert.deepEqual(calls, [`setLocation:${custom}`, 'install']);
});

test('duplicate install guard: runMutation busy skips second install call', async () => {
  let installCount = 0;
  let busy = false;
  const runInstall = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    installCount += 1;
    await new Promise((r) => setTimeout(r, 10));
    busy = false;
  };
  await Promise.all([runInstall(), runInstall()]);
  assert.equal(installCount, 1);
});

test('genuine backend mutation busy rejects install from confirm flow', async () => {
  const result = await confirmFirstInstallLocation('D:\\Games\\SweetCraft', {
    persistedPath: 'C:\\Legacy',
    setLocation: async () => {},
    install: async () => {
      throw { code: 'INSTANCE_BUSY', messageKey: 'error.install.busy' };
    },
  });
  assert.equal(result.outcome, 'install_error');
  assert.equal(result.locationCommitted, true);
});
