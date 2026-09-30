import assert from 'node:assert/strict';
import test from 'node:test';
import type { InstallProgressDto } from '@sweetcraft/ipc';
import { translate } from '../core/i18n/messages.js';
import {
  buildInstallProgressDetails,
  formatBytesFr,
  formatDurationFr,
  formatEtaFr,
  formatSpeedFr,
} from './install-progress-format.js';

const labels = {
  downloadScope: 'Téléchargement',
  filesScope: 'Fichiers',
  elapsed: (d: string) => `Temps écoulé : ${d}`,
  eta: (d: string) => translate('install.progress.detail.eta_phase', { duration: d }),
};

test('formatBytesFr handles KiB MiB GiB boundaries', () => {
  assert.equal(formatBytesFr(512), '0,5 Ko');
  assert.ok(formatBytesFr(812 * 1024 * 1024).includes('Mo'));
  assert.ok(formatBytesFr(2 * 1024 * 1024 * 1024).includes('Go'));
});

test('formatDurationFr seconds and minutes', () => {
  assert.equal(formatDurationFr(18), '18 s');
  assert.equal(formatDurationFr(90), '1 min 30 s');
});

test('determinate download details expose bytes and phase-scoped ETA', () => {
  const progress: InstallProgressDto = {
    phase: 'DOWNLOADING',
    operation: 'install',
    indeterminate: false,
    percent: 43,
    metricScope: 'download',
    completedBytes: 812 * 1024 * 1024,
    totalBytes: 2 * 1024 * 1024 * 1024,
    bytesPerSecond: 11.8 * 1024 * 1024,
    etaSeconds: 90,
    elapsedMs: 18_000,
  };
  const details = buildInstallProgressDetails(progress, labels);
  assert.equal(details.scopeLine, 'Téléchargement');
  assert.ok(details.bytesLine?.includes('/'));
  assert.ok(formatSpeedFr(progress.bytesPerSecond!));
  assert.ok(details.etaLine?.includes('cette étape'));
  assert.ok(details.etaLine?.includes('≈'));
  assert.match(details.etaLine!, /Temps restant pour cette étape/);
});

test('indeterminate phase hides fake metrics', () => {
  const progress: InstallProgressDto = {
    phase: 'PLANNING',
    operation: 'install',
    indeterminate: true,
    elapsedMs: 5000,
  };
  const details = buildInstallProgressDetails(progress, labels);
  assert.equal(details.bytesLine, undefined);
  assert.equal(details.speedLine, undefined);
  assert.equal(details.etaLine, undefined);
  assert.ok(details.elapsedLine);
});

test('optional metrics absent -> hidden', () => {
  const progress: InstallProgressDto = {
    phase: 'VERIFYING',
    operation: 'repair',
    indeterminate: true,
  };
  const details = buildInstallProgressDetails(progress, labels);
  assert.deepEqual(details, {});
});

test('formatEtaFr is phase-scoped and avoids fake precision', () => {
  const eta = formatEtaFr(90);
  assert.equal(eta, 'Temps restant pour cette étape : ≈ 1 min 30 s');
  assert.match(eta, /cette étape/i);
  assert.doesNotMatch(eta, /^≈ .+ restantes$/);
});

test('ETA absent when estimator provides none', () => {
  const progress: InstallProgressDto = {
    phase: 'DOWNLOADING',
    operation: 'install',
    indeterminate: false,
    percent: 10,
    metricScope: 'download',
    completedBytes: 10,
    totalBytes: 100,
    // etaSeconds omitted
  };
  const details = buildInstallProgressDetails(progress, labels);
  assert.equal(details.etaLine, undefined);
});

test('fixed download total renders stable bounded bytes line', () => {
  const first: InstallProgressDto = {
    phase: 'DOWNLOADING',
    operation: 'install',
    indeterminate: false,
    percent: 0,
    metricScope: 'download',
    completedBytes: 0,
    totalBytes: 148 * 1024 * 1024,
    bytesPerSecond: 0,
    elapsedMs: 2000,
  };
  const later: InstallProgressDto = {
    ...first,
    completedBytes: 147 * 1024 * 1024,
    percent: 99,
    bytesPerSecond: 12.2 * 1024 * 1024,
    etaSeconds: 1,
  };
  const d1 = buildInstallProgressDetails(first, labels);
  const d2 = buildInstallProgressDetails(later, labels);
  assert.ok(d1.bytesLine?.endsWith('/ 148 Mo'));
  assert.ok(d2.bytesLine?.endsWith('/ 148 Mo'));
  assert.equal(d1.bytesLine?.split('/')[1]?.trim(), d2.bytesLine?.split('/')[1]?.trim());
  assert.ok(d2.etaLine?.includes('cette étape'));
});

test('unknown download total omits slash denominator and fabricates no ETA', () => {
  const progress: InstallProgressDto = {
    phase: 'DOWNLOADING',
    operation: 'install',
    indeterminate: true,
    metricScope: 'download',
    completedBytes: 28.4 * 1024 * 1024,
    completedFiles: 3,
    totalFiles: 8,
    bytesPerSecond: 12.2 * 1024 * 1024,
    elapsedMs: 12_000,
  };
  const details = buildInstallProgressDetails(progress, labels);
  assert.ok(details.bytesLine?.includes('téléchargés'));
  assert.equal(details.bytesLine?.includes('/'), false);
  assert.equal(details.filesLine, '3 / 8 téléchargements');
  assert.ok(details.speedLine);
  assert.equal(details.etaLine, undefined);
});

test('i18n eta_phase key is phase-scoped', () => {
  const text = translate('install.progress.detail.eta_phase', { duration: '2 min' });
  assert.equal(text, 'Temps restant pour cette étape : ≈ 2 min');
});
