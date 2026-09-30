/**
 * Settings memory UX helpers — presentation only (mirrors Main SETTINGS_MEMORY_*).
 */

export const MEMORY_MIN = 512;
export const MEMORY_MAX = 32768;
export const MEMORY_STEP = 512;
export const MEMORY_DEFAULT = 2048;

/** Circumference for Settings SVG metric rings (r=34). */
export const METRIC_RING_RADIUS = 34;
export const METRIC_RING_CIRCUMFERENCE = 2 * Math.PI * METRIC_RING_RADIUS;

export function clampMemory(n: number): number {
  const stepped = Math.round(n / MEMORY_STEP) * MEMORY_STEP;
  return Math.min(MEMORY_MAX, Math.max(MEMORY_MIN, stepped));
}

export function formatMemoryLabel(mib: number): string {
  const gb = mib / 1024;
  const gbLabel = Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
  return `${mib} Mo (${gbLabel} Go)`;
}

/** Used RAM fraction when total+free known — null if either missing. */
export function memoryUsedPercent(
  totalMemoryMiB: number | null | undefined,
  freeMemoryMiB: number | null | undefined,
): number | null {
  if (
    typeof totalMemoryMiB !== 'number' ||
    typeof freeMemoryMiB !== 'number' ||
    !Number.isFinite(totalMemoryMiB) ||
    !Number.isFinite(freeMemoryMiB) ||
    totalMemoryMiB <= 0
  ) {
    return null;
  }
  const used = Math.max(0, totalMemoryMiB - freeMemoryMiB);
  return Math.min(100, Math.round((used / totalMemoryMiB) * 100));
}

/** Used disk fraction when total+free known — same formula as RAM (used = total − free). */
export function diskUsedPercent(
  totalGiB: number | null | undefined,
  freeGiB: number | null | undefined,
): number | null {
  if (
    typeof totalGiB !== 'number' ||
    typeof freeGiB !== 'number' ||
    !Number.isFinite(totalGiB) ||
    !Number.isFinite(freeGiB) ||
    totalGiB <= 0
  ) {
    return null;
  }
  const used = Math.max(0, totalGiB - freeGiB);
  return Math.min(100, Math.round((used / totalGiB) * 100));
}

/** stroke-dasharray for a circular progress ring from a 0–100 percentage. */
export function ringStrokeDasharray(percent: number | null | undefined): string {
  const c = METRIC_RING_CIRCUMFERENCE;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return `0 ${c}`;
  }
  const clamped = Math.min(100, Math.max(0, percent));
  return `${(clamped / 100) * c} ${c}`;
}

/** French decimal comma; trim trailing zeros after maxDecimals. */
function formatFrDecimal(n: number, maxDecimals: number): string {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(maxDecimals);
  if (s.includes('.')) {
    s = s.replace(/\.?0+$/, '');
  }
  return s.replace('.', ',');
}

/** Format GiB capacity for FR UI: Go below 1024 GiB, To at/above. French decimal comma. */
export function formatDiskCapacityGiB(gib: number): string {
  const n = Number.isFinite(gib) ? Math.max(0, gib) : 0;
  if (n >= 1024) {
    return `${formatFrDecimal(n / 1024, 2)} To`;
  }
  return `${formatFrDecimal(n, 1)} Go`;
}

/** e.g. "59,1 Go libres sur 930,5 Go" or "1,27 To libres sur 1,82 To". */
export function formatDiskFreeSurTotal(freeGiB: number, totalGiB: number): string {
  return `${formatDiskCapacityGiB(freeGiB)} libres sur ${formatDiskCapacityGiB(totalGiB)}`;
}
