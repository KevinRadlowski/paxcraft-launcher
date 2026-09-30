import type { AuthState } from '@sweetcraft/ipc';

/**
 * Play eligibility can go stale while auth is RESTORING (e.g. update/auth race).
 * Refresh only on genuine transitions into AUTHENTICATED — not on duplicate events.
 */
export function shouldRefreshPlayOnAuthTransition(
  previous: AuthState,
  next: AuthState,
): boolean {
  if (next !== 'AUTHENTICATED' || previous === 'AUTHENTICATED') {
    return false;
  }
  return previous === 'RESTORING' || previous === 'SIGNED_OUT' || previous === 'REAUTH_REQUIRED';
}
