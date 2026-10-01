import type { AuthState, LauncherReadiness, PlayLifecycleState } from '@sweetcraft/ipc';

/** UI-only readiness label keys — DTO codes remain unchanged in copied diagnostics. */
export function readinessLabelKey(readiness: LauncherReadiness | string | null | undefined): string {
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
    case 'RECOVERY_REQUIRED':
      return 'readiness.recovery';
    case 'INCOMPATIBLE_STATE':
      return 'readiness.incompatible';
    case 'LOCATION_UNAVAILABLE':
      return 'settings.location.unavailable';
    default:
      return 'readiness.unknown';
  }
}

export function authLabelKey(auth: AuthState | string | null | undefined): string {
  switch (auth) {
    case 'SIGNED_OUT':
      return 'account.state.signed_out';
    case 'AUTHENTICATED':
      return 'account.state.authenticated';
    case 'RESTORING':
      return 'account.state.restoring';
    case 'REAUTH_REQUIRED':
      return 'account.state.reauth_required';
    case 'ERROR':
      return 'account.state.error';
    default:
      return 'account.state.unknown';
  }
}

export function playLabelKey(play: PlayLifecycleState | string | null | undefined): string {
  switch (play) {
    case 'UNAVAILABLE':
      return 'diagnostics.play.unavailable';
    case 'READY':
      return 'diagnostics.play.ready';
    case 'LAUNCHING':
      return 'diagnostics.play.launching';
    case 'RUNNING':
      return 'diagnostics.play.running';
    case 'EXITED':
      return 'diagnostics.play.exited';
    case 'ERROR':
      return 'diagnostics.play.error';
    case 'RECOVERY_REQUIRED':
      return 'diagnostics.play.recovery';
    default:
      return 'diagnostics.play.unknown';
  }
}

export type DiagnosticsTone = 'ok' | 'warn' | 'error' | 'neutral';

export function readinessTone(readiness: LauncherReadiness | string | null | undefined): DiagnosticsTone {
  switch (readiness) {
    case 'READY':
      return 'ok';
    case 'UPDATE_AVAILABLE':
    case 'REPAIR_REQUIRED':
    case 'BUSY':
    case 'CHECKING':
      return 'warn';
    case 'ERROR':
    case 'RECOVERY_REQUIRED':
    case 'INCOMPATIBLE_STATE':
    case 'LOCATION_UNAVAILABLE':
      return 'error';
    default:
      return 'neutral';
  }
}

export function authTone(auth: AuthState | string | null | undefined): DiagnosticsTone {
  switch (auth) {
    case 'AUTHENTICATED':
      return 'ok';
    case 'RESTORING':
    case 'REAUTH_REQUIRED':
      return 'warn';
    case 'ERROR':
      return 'error';
    default:
      return 'neutral';
  }
}

export function playTone(play: PlayLifecycleState | string | null | undefined): DiagnosticsTone {
  switch (play) {
    case 'RUNNING':
    case 'READY':
      return 'ok';
    case 'LAUNCHING':
    case 'EXITED':
      return 'warn';
    case 'ERROR':
    case 'RECOVERY_REQUIRED':
      return 'error';
    default:
      return 'neutral';
  }
}
