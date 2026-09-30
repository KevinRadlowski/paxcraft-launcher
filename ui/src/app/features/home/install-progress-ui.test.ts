import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InstallProgressDto } from '@sweetcraft/ipc';
import { normalizeInstallProgress } from '../../../../../desktop/main/install/install-progress.js';
import { buildInstallProgressDetails } from '../../shared/install-progress-format.js';
import {
  installProgressFallbackLabelKey,
  resolveInstallCardPresentation,
} from '../../shared/install-card-presentation.js';
import { installProgressLabelKey } from '../../shared/cta-mapping.js';

const HOME_PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'home.page.ts');

test('determinate download -> percentage visible in normalized DTO', () => {
  const p = normalizeInstallProgress({
    phase: 'DOWNLOADING',
    operation: 'install',
    completedBytes: 430,
    totalBytes: 1000,
    metricScope: 'download',
  });
  assert.equal(p.indeterminate, false);
  assert.equal(p.percent, 43);
});

test('indeterminate phase -> no fake percentage', () => {
  const p = normalizeInstallProgress({
    phase: 'PLANNING',
    operation: 'install',
  });
  assert.equal(p.indeterminate, true);
  assert.equal(p.percent, undefined);
});

test('DONE converges to 100%', () => {
  const p = normalizeInstallProgress({ phase: 'DONE', operation: 'install' });
  assert.equal(p.phase, 'COMPLETED');
  assert.equal(p.percent, 100);
});

test('home progressPercent uses authoritative DTO percent only', () => {
  // Contract: home.page progressPercent() returns progress.percent ?? 0 with no interpolation.
  const home = fs.readFileSync(HOME_PAGE, 'utf8');
  assert.match(home, /return progress\.percent \?\? 0/);
  assert.doesNotMatch(home, /requestAnimationFrame|lerp|interpolat/i);
  assert.match(home, /install\.progress\.detail\.eta_phase/);
});

test('healthy repair phase label is specific (not generic in progress)', () => {
  const progress = normalizeInstallProgress({
    phase: 'VERIFYING',
    operation: 'repair',
    elapsedMs: 3200,
  });
  assert.equal(installProgressLabelKey(progress.phase), 'install.progress.verifying');
  assert.notEqual(installProgressLabelKey(progress.phase), 'cta.in_progress');
});

test('elapsed under 1s stays hidden; renderer clock makes 3s visible without new events', () => {
  const fast = buildInstallProgressDetails(
    normalizeInstallProgress({ phase: 'INSPECTING', operation: 'repair', elapsedMs: 800 }),
    { downloadScope: 'Téléchargement', filesScope: 'Fichiers', elapsed: (d) => d },
    { displayElapsedMs: 800 },
  );
  assert.equal(fast.elapsedLine, undefined);

  const slow = buildInstallProgressDetails(
    normalizeInstallProgress({ phase: 'INSPECTING', operation: 'repair', elapsedMs: 200 }),
    { downloadScope: 'Téléchargement', filesScope: 'Fichiers', elapsed: (d) => `Temps écoulé : ${d}` },
    { displayElapsedMs: 3_200 },
  );
  assert.equal(slow.elapsedLine, 'Temps écoulé : 3 s');
});

test('READY + active REPAIR: install card regression from human video', () => {
  const card = resolveInstallCardPresentation('READY', 'REPAIRING');
  assert.notEqual(card.supportKey, 'home.card.install.support.ready');
  assert.equal(installProgressFallbackLabelKey('REPAIRING'), 'install.progress.inspecting');
});

test('failure does not leave stale download metrics in UI contract', () => {
  const failed: InstallProgressDto = normalizeInstallProgress({
    phase: 'FAILED',
    operation: 'install',
  });
  assert.equal(failed.phase, 'FAILED');
  assert.notEqual(failed.percent, 100);
  const details = buildInstallProgressDetails(failed, {
    downloadScope: 'Téléchargement',
    filesScope: 'Fichiers',
    elapsed: (d) => d,
  });
  assert.equal(details.bytesLine, undefined);
});
