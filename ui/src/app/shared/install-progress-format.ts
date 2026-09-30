import type { InstallProgressDto } from '@sweetcraft/ipc';

import { translate } from '../core/i18n/messages.js';
import { INSTALL_ELAPSED_HIDE_MS } from './install-elapsed-display.js';

const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

/** Format byte counts for French UI (binary prefixes). */
export function formatBytesFr(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < MIB) {
    const kiB = bytes / 1024;
    return `${formatDecimalFr(kiB, kiB >= 100 ? 0 : 1)} Ko`;
  }
  if (bytes < GIB) {
    const miB = bytes / MIB;
    return `${formatDecimalFr(miB, miB >= 100 ? 0 : 1)} Mo`;
  }
  const giB = bytes / GIB;
  return `${formatDecimalFr(giB, giB >= 100 ? 0 : 2)} Go`;
}

export function formatSpeedFr(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  return `${formatBytesFr(bytesPerSecond)}/s`;
}

export function formatDurationFr(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '';
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  const rem = s % 60;
  if (minutes < 60) {
    return rem > 0 ? `${minutes} min ${rem} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours} h ${remMin} min` : `${hours} h`;
}

/**
 * Phase-scoped ETA copy (download epoch only — never whole-install).
 * Uses install.progress.detail.eta_phase i18n.
 */
export function formatEtaFr(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const duration = formatDurationFr(seconds);
  if (!duration) return '';
  return translate('install.progress.detail.eta_phase', { duration });
}

export function formatPercentFr(percent: number): string {
  if (!Number.isFinite(percent)) return '';
  return `${Math.floor(percent)} %`;
}

function formatDecimalFr(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

export interface InstallProgressDetailLines {
  readonly scopeLine?: string;
  readonly bytesLine?: string;
  readonly filesLine?: string;
  readonly speedLine?: string;
  readonly etaLine?: string;
  readonly elapsedLine?: string;
  readonly itemLine?: string;
}

export function buildInstallProgressDetails(
  progress: InstallProgressDto,
  labels: {
    downloadScope: string;
    filesScope: string;
    elapsed: (duration: string) => string;
    /** Phase-scoped ETA; must not imply whole-install remaining time. */
    eta?: (duration: string) => string;
  },
  opts?: { displayElapsedMs?: number },
): InstallProgressDetailLines {
  const out: {
    scopeLine?: string;
    bytesLine?: string;
    filesLine?: string;
    speedLine?: string;
    etaLine?: string;
    elapsedLine?: string;
    itemLine?: string;
  } = {};

  const elapsedMs = opts?.displayElapsedMs ?? progress.elapsedMs;
  if (elapsedMs !== undefined && elapsedMs >= INSTALL_ELAPSED_HIDE_MS) {
    const d = formatDurationFr(Math.floor(elapsedMs / 1000));
    if (d) out.elapsedLine = labels.elapsed(d);
  }

  if (progress.metricScope === 'download' && progress.completedBytes !== undefined) {
    out.scopeLine = labels.downloadScope;
    if (progress.totalBytes !== undefined && progress.totalBytes > 0) {
      out.bytesLine = `${formatBytesFr(progress.completedBytes)} / ${formatBytesFr(progress.totalBytes)}`;
    } else if (progress.completedBytes > 0) {
      out.bytesLine = `${formatBytesFr(progress.completedBytes)} téléchargés`;
    }
    if (
      progress.completedFiles !== undefined &&
      progress.totalFiles !== undefined &&
      progress.totalFiles > 0
    ) {
      out.filesLine = `${progress.completedFiles} / ${progress.totalFiles} téléchargements`;
    }
  } else if (
    progress.metricScope === 'files' &&
    progress.completedFiles !== undefined &&
    progress.totalFiles !== undefined &&
    progress.totalFiles > 0
  ) {
    out.scopeLine = labels.filesScope;
    out.filesLine = `${progress.completedFiles} / ${progress.totalFiles}`;
  } else if (
    progress.completedBytes !== undefined &&
    progress.totalBytes !== undefined &&
    progress.totalBytes > 0
  ) {
    out.bytesLine = `${formatBytesFr(progress.completedBytes)} / ${formatBytesFr(progress.totalBytes)}`;
  } else if (
    progress.completedFiles !== undefined &&
    progress.totalFiles !== undefined &&
    progress.totalFiles > 0
  ) {
    out.filesLine = `${progress.completedFiles} / ${progress.totalFiles}`;
  }

  if (progress.bytesPerSecond !== undefined) {
    const speed = formatSpeedFr(progress.bytesPerSecond);
    if (speed) out.speedLine = speed;
  }

  if (progress.etaSeconds !== undefined && Number.isFinite(progress.etaSeconds) && progress.etaSeconds > 0) {
    const duration = formatDurationFr(progress.etaSeconds);
    if (duration) {
      out.etaLine = labels.eta
        ? labels.eta(duration)
        : translate('install.progress.detail.eta_phase', { duration });
    }
  }

  if (progress.currentItemLabel) {
    out.itemLine = progress.currentItemLabel;
  }

  return out;
}
