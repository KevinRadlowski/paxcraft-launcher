import type { InstallActiveOperation, InstallProgressPhase, LauncherReadiness } from '@sweetcraft/ipc';

const MUTATION_OPS = new Set<InstallActiveOperation>([
  'INSTALLING',
  'UPDATING',
  'REPAIRING',
  'UNINSTALLING',
]);

/** Terminal progress phases — never imply an active mutation busy overlay. */
export function isTerminalInstallProgressPhase(phase: InstallProgressPhase): boolean {
  return phase === 'COMPLETED' || phase === 'FAILED';
}

/**
 * Readiness after applying an install progress event.
 *
 * - Non-terminal → BUSY overlay (active work).
 * - Terminal → retain authoritative readiness; never invent READY.
 * - Terminal while readiness is progress-only BUSY and no mutation op → clear overlay
 *   to UNKNOWN (honest unknown; not READY).
 * - Terminal while a mutation op is still marked active → keep BUSY until
 *   authoritative applyInstallStatus arrives.
 */
export function readinessAfterInstallProgress(
  currentReadiness: LauncherReadiness,
  activeOperation: InstallActiveOperation,
  phase: InstallProgressPhase,
): LauncherReadiness {
  if (!isTerminalInstallProgressPhase(phase)) {
    return 'BUSY';
  }
  if (currentReadiness !== 'BUSY') {
    return currentReadiness;
  }
  if (MUTATION_OPS.has(activeOperation)) {
    return 'BUSY';
  }
  return 'UNKNOWN';
}
