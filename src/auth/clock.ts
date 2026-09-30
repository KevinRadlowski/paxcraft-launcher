/**
 * Injectable clock for auth expiry / flow TTL / refresh decisions.
 * Tests must not depend on fragile Date.now() wall clock alone.
 */
export interface Clock {
  nowMs(): number;
}

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  constructor(private ms: number) {}

  nowMs(): number {
    return this.ms;
  }

  advance(ms: number): void {
    this.ms += ms;
  }

  set(ms: number): void {
    this.ms = ms;
  }
}

/** Refresh when within this many ms of expiresAt (clock skew buffer). */
export const DEFAULT_TOKEN_SKEW_MS = 60_000;

export function isExpired(expiresAtMs: number, clock: Clock, skewMs: number = DEFAULT_TOKEN_SKEW_MS): boolean {
  return clock.nowMs() + skewMs >= expiresAtMs;
}
