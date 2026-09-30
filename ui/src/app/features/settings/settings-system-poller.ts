/**
 * Pure Settings system/disk poller — testable without Angular.
 * inFlight guard prevents overlapping fetches; failures never clear lastGood
 * (caller owns the signal and decides whether to keep prior value).
 */

export const SYSTEM_POLL_INTERVAL_MS = 5000;
export const DISK_POLL_INTERVAL_MS = 60_000;

export type SettingsPollerFetch<T> = () => Promise<T>;

export interface SettingsSystemPollerOptions<T> {
  readonly fetch: SettingsPollerFetch<T>;
  readonly onSuccess: (value: T) => void;
  /** Called on fetch failure — caller must NOT clear lastGood unless desired. */
  readonly onError?: (err: unknown) => void;
  readonly intervalMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

export class SettingsSystemPoller<T = unknown> {
  private readonly fetchFn: SettingsPollerFetch<T>;
  private readonly onSuccess: (value: T) => void;
  private readonly onError?: (err: unknown) => void;
  private readonly intervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private disposed = false;
  private started = false;

  constructor(opts: SettingsSystemPollerOptions<T>) {
    this.fetchFn = opts.fetch;
    this.onSuccess = opts.onSuccess;
    this.onError = opts.onError;
    this.intervalMs = opts.intervalMs ?? SYSTEM_POLL_INTERVAL_MS;
    this.setIntervalFn = opts.setIntervalFn ?? setInterval;
    this.clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get isStarted(): boolean {
    return this.started && !this.disposed;
  }

  /** Immediate fetch + interval. Idempotent while already started. */
  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    void this.runFetch();
    this.timer = this.setIntervalFn(() => {
      void this.runFetch();
    }, this.intervalMs);
  }

  /** Clear interval and mark disposed — further fetches are no-ops. */
  stop(): void {
    this.disposed = true;
    this.started = false;
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  /** Same fetch path as interval ticks (respects inFlight + disposed). */
  manualRefresh(): Promise<void> {
    return this.runFetch();
  }

  private async runFetch(): Promise<void> {
    if (this.disposed || this.inFlight) return;
    this.inFlight = true;
    try {
      const value = await this.fetchFn();
      if (!this.disposed) this.onSuccess(value);
    } catch (err) {
      if (!this.disposed) this.onError?.(err);
    } finally {
      this.inFlight = false;
    }
  }
}
