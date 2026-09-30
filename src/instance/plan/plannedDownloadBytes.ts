/**
 * Pre-compute network download workload from an install/runtime plan (PACK-10.1G.6).
 * Counts only artifacts that will actually be fetched — not KEEP / already valid.
 */

export interface PlannedDownloadSummary {
  readonly plannedDownloadBytes: number;
  readonly hasUnknownDownloadSize: boolean;
  readonly plannedDownloadFiles: number;
}

export function summarizePlannedDownloadBytes(
  entries: readonly { readonly action: string; readonly expectedSize?: number }[]
): PlannedDownloadSummary {
  let plannedDownloadBytes = 0;
  let hasUnknownDownloadSize = false;
  let plannedDownloadFiles = 0;

  for (const entry of entries) {
    if (entry.action !== "DOWNLOAD" && entry.action !== "REPLACE" && entry.action !== "REPAIR") {
      continue;
    }
    plannedDownloadFiles += 1;
    const size = entry.expectedSize;
    if (typeof size === "number" && size >= 0) {
      plannedDownloadBytes += size;
    } else {
      hasUnknownDownloadSize = true;
    }
  }

  return { plannedDownloadBytes, hasUnknownDownloadSize, plannedDownloadFiles };
}
