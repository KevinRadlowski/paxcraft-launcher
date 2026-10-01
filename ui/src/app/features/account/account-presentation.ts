import type { AuthState } from '@sweetcraft/ipc';

export type AccountRowTone = 'ok' | 'neutral' | 'error';

/** Earliest plausible last-used (rejects epoch / second-scale trash → « 1 janvier 1970 »). */
const MIN_SANE_LAST_USED_MS = Date.UTC(2000, 0, 1);

/** Formats last-used timestamp for display, or null when unavailable/invalid. */
export function formatLastUsed(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < MIN_SANE_LAST_USED_MS) {
    return null;
  }
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000) {
      return null;
    }
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

export function isAuthenticated(authState: AuthState): boolean {
  return authState === 'AUTHENTICATED';
}

/**
 * Microsoft auth row: ok only when a usable session exists after Microsoft auth.
 * ERROR / REAUTH_REQUIRED are genuine failure states; others stay neutral.
 */
export function msAuthRowState(authState: AuthState): AccountRowTone {
  if (authState === 'AUTHENTICATED') return 'ok';
  if (authState === 'ERROR' || authState === 'REAUTH_REQUIRED') return 'error';
  return 'neutral';
}

/**
 * Minecraft access row: AUTHENTICATED means a usable Minecraft session.
 * ERROR / REAUTH_REQUIRED block play; otherwise unknown/neutral.
 */
export function mcAccessRowState(authState: AuthState): AccountRowTone {
  if (authState === 'AUTHENTICATED') return 'ok';
  if (authState === 'ERROR' || authState === 'REAUTH_REQUIRED') return 'error';
  return 'neutral';
}

/** Secure launcher session without exposing secrets — ok only when authenticated. */
export function sessionRowState(authState: AuthState): AccountRowTone {
  if (authState === 'AUTHENTICATED') return 'ok';
  if (authState === 'ERROR') return 'error';
  return 'neutral';
}

/** Initials fallback for avatar box (no skin URL inventing). */
export function avatarInitials(username: string): string {
  const cleaned = username.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  }
  return cleaned.slice(0, Math.min(2, cleaned.length)).toUpperCase();
}
