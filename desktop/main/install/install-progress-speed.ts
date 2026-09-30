/**
 * Rolling download speed from byte observations — deterministic, no wall-clock flakiness in tests.
 * Uses a 3 s window; requires ≥500 ms span and monotonic byte counter.
 */

export interface SpeedSample {
  readonly atMs: number;
  readonly bytes: number;
}

export class InstallByteSpeedTracker {
  private samples: SpeedSample[] = [];
  private lastBytes = 0;
  private readonly windowMs: number;
  private readonly minSpanMs: number;

  constructor(opts?: { windowMs?: number; minSpanMs?: number }) {
    this.windowMs = opts?.windowMs ?? 3000;
    this.minSpanMs = opts?.minSpanMs ?? 500;
  }

  reset(): void {
    this.samples = [];
    this.lastBytes = 0;
  }

  /** Returns smoothed bytes/sec or undefined when not enough stable data. */
  observe(completedBytes: number, nowMs: number): number | undefined {
    if (!Number.isFinite(completedBytes) || completedBytes < 0) return undefined;
    if (completedBytes < this.lastBytes) {
      this.reset();
      this.lastBytes = completedBytes;
      return undefined;
    }
    this.lastBytes = completedBytes;
    this.samples.push({ atMs: nowMs, bytes: completedBytes });
    const cutoff = nowMs - this.windowMs;
    this.samples = this.samples.filter((s) => s.atMs >= cutoff);
    if (this.samples.length < 2) return undefined;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const dtMs = last.atMs - first.atMs;
    if (dtMs < this.minSpanMs) return undefined;
    const dBytes = last.bytes - first.bytes;
    if (dBytes <= 0) return undefined;
    const bps = dBytes / (dtMs / 1000);
    return Number.isFinite(bps) && bps > 0 ? bps : undefined;
  }
}

export function computeEtaSeconds(
  remainingBytes: number,
  bytesPerSecond: number | undefined,
): number | undefined {
  if (
    !Number.isFinite(remainingBytes) ||
    remainingBytes <= 0 ||
    bytesPerSecond === undefined ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  ) {
    return undefined;
  }
  return Math.ceil(remainingBytes / bytesPerSecond);
}
