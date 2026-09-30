import type { AuthState, InstallActiveOperation, LauncherReadiness, PlayLifecycleState } from '@sweetcraft/ipc';
import type { PrimaryActionPresentation } from '../core/state/models';

export interface PrimaryActionOptions {
  readonly activeOperation?: InstallActiveOperation;
  readonly installBusy?: boolean;
  readonly playState?: PlayLifecycleState;
  readonly playBusy?: boolean;
}

const MUTATION_OPS = new Set<InstallActiveOperation>([
  'INSTALLING',
  'UPDATING',
  'REPAIRING',
  'UNINSTALLING',
]);

const PLAY_BLOCKING_STATES = new Set<PlayLifecycleState>(['LAUNCHING', 'RUNNING']);

function inProgress(readiness: LauncherReadiness): boolean {
  return readiness === 'BUSY';
}

function actionRequired(readiness: LauncherReadiness): boolean {
  return readiness === 'RECOVERY_REQUIRED' || readiness === 'INCOMPATIBLE_STATE';
}

export function isPlayBlockingMutations(playState?: PlayLifecycleState): boolean {
  return playState !== undefined && PLAY_BLOCKING_STATES.has(playState);
}

function isInstallMutationBusy(
  readiness: LauncherReadiness,
  options?: PrimaryActionOptions,
): boolean {
  if (options?.installBusy) return true;
  const op = options?.activeOperation;
  if (op && MUTATION_OPS.has(op)) return true;
  return inProgress(readiness);
}

function isPlayBusy(options?: PrimaryActionOptions): boolean {
  if (options?.playBusy) return true;
  return isPlayBlockingMutations(options?.playState);
}

function isPlayIdle(playState?: PlayLifecycleState): boolean {
  return playState === undefined || playState === 'READY' || playState === 'EXITED';
}

/**
 * Pure mapping: installation readiness + auth + play lifecycle → primary CTA presentation.
 * Install states always beat play; installBusy and playBusy both block mutations.
 */
export function mapPrimaryAction(
  readiness: LauncherReadiness,
  authState: AuthState,
  options?: PrimaryActionOptions,
): PrimaryActionPresentation {
  if (isInstallMutationBusy(readiness, options) || isPlayBusy(options)) {
    const playState = options?.playState;
    if (playState === 'LAUNCHING') {
      return {
        kind: 'IN_PROGRESS',
        labelKey: 'play.message.launching',
        enabled: false,
        variant: 'secondary',
        readiness,
        authState,
      };
    }
    if (playState === 'RUNNING') {
      return {
        kind: 'IN_PROGRESS',
        labelKey: 'play.message.running',
        enabled: false,
        variant: 'secondary',
        readiness,
        authState,
      };
    }
    return {
      kind: 'IN_PROGRESS',
      labelKey: 'cta.in_progress',
      enabled: false,
      variant: 'secondary',
      readiness,
      authState,
    };
  }

  if (authState === 'RESTORING') {
    return {
      kind: 'IN_PROGRESS',
      labelKey: 'auth.status.restoring',
      enabled: false,
      variant: 'secondary',
      readiness,
      authState,
    };
  }

  if (readiness === 'CHECKING') {
    return {
      kind: 'IN_PROGRESS',
      labelKey: 'readiness.checking',
      enabled: false,
      variant: 'secondary',
      readiness,
      authState,
    };
  }

  if (readiness === 'ERROR') {
    return {
      kind: 'VERIFY',
      labelKey: 'cta.verify_status',
      enabled: true,
      variant: 'secondary',
      readiness,
      authState,
    };
  }

  if (actionRequired(readiness)) {
    return {
      kind: 'ACTION_REQUIRED',
      labelKey: 'cta.action_required',
      enabled: false,
      variant: 'danger',
      readiness,
      authState,
    };
  }

  switch (readiness) {
    case 'NOT_INSTALLED':
      return {
        kind: 'INSTALL',
        labelKey: 'cta.install',
        enabled: true,
        variant: 'primary',
        readiness,
        authState,
      };
    case 'UPDATE_AVAILABLE':
      return {
        kind: 'UPDATE',
        labelKey: 'cta.update',
        enabled: true,
        variant: 'primary',
        readiness,
        authState,
      };
    case 'REPAIR_REQUIRED':
      return {
        kind: 'REPAIR',
        labelKey: 'cta.repair',
        enabled: true,
        variant: 'primary',
        readiness,
        authState,
      };
    case 'READY':
      if (authState === 'REAUTH_REQUIRED') {
        return {
          kind: 'REAUTH',
          labelKey: 'cta.reauth',
          enabled: true,
          variant: 'primary',
          readiness,
          authState,
        };
      }
      if (authState !== 'AUTHENTICATED') {
        return {
          kind: 'SIGN_IN',
          labelKey: 'cta.sign_in_microsoft',
          enabled: true,
          variant: 'primary',
          readiness,
          authState,
        };
      }
      if (isPlayIdle(options?.playState)) {
        return {
          kind: 'PLAY',
          labelKey: 'cta.play',
          enabled: true,
          variant: 'primary',
          readiness,
          authState,
        };
      }
      return {
        kind: 'UNAVAILABLE',
        labelKey: 'cta.unavailable',
        enabled: false,
        variant: 'ghost',
        readiness,
        authState,
      };
    default:
      return {
        kind: 'UNAVAILABLE',
        labelKey: 'cta.unavailable',
        enabled: false,
        variant: 'ghost',
        readiness,
        authState,
      };
  }
}

export function readinessBadgeKey(readiness: LauncherReadiness): string {
  switch (readiness) {
    case 'NOT_INSTALLED':
      return 'readiness.not_installed';
    case 'READY':
      return 'readiness.ready';
    case 'UPDATE_AVAILABLE':
      return 'readiness.update_available';
    case 'REPAIR_REQUIRED':
      return 'readiness.repair_required';
    case 'BUSY':
      return 'readiness.busy';
    case 'CHECKING':
      return 'readiness.checking';
    case 'ERROR':
      return 'readiness.error';
    case 'INCOMPATIBLE_STATE':
      return 'readiness.incompatible';
    case 'RECOVERY_REQUIRED':
      return 'readiness.recovery';
    case 'UNKNOWN':
      return 'readiness.installation_unknown';
    default:
      return 'readiness.installation_unknown';
  }
}

export function readinessBadgeVariant(
  readiness: LauncherReadiness,
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (readiness) {
    case 'READY':
      return 'success';
    case 'UPDATE_AVAILABLE':
      return 'info';
    case 'REPAIR_REQUIRED':
    case 'RECOVERY_REQUIRED':
      return 'warning';
    case 'BUSY':
    case 'CHECKING':
      return 'info';
    case 'ERROR':
    case 'INCOMPATIBLE_STATE':
      return 'danger';
    case 'UNKNOWN':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function installProgressLabelKey(phase: string): string {
  return `install.progress.${phase.toLowerCase()}`;
}
