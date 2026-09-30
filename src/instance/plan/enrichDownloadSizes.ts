import type { HttpClient } from "../../distribution/http/index.js";
import { resolveUniqueContentLengths } from "../../download/planning/probeContentLength.js";
import type { PlanEntry } from "./index.js";

/**
 * Manifest configs carry sha256 only — enrich DOWNLOAD/REPLACE entries via HEAD
 * so plannedDownloadBytes is bounded before the first pack byte transfers.
 */
export async function enrichPackPlanDownloadSizes(
  entries: readonly PlanEntry[],
  http: HttpClient,
  signal?: AbortSignal
): Promise<PlanEntry[]> {
  const probeUrls: string[] = [];
  for (const entry of entries) {
    if (entry.action !== "DOWNLOAD" && entry.action !== "REPLACE") continue;
    if (entry.expectedSize >= 0) continue;
    const url = entry.download?.url;
    if (url) probeUrls.push(url);
  }
  if (probeUrls.length === 0) return [...entries];

  const sizes = await resolveUniqueContentLengths(http, probeUrls, signal);
  if (sizes.size === 0) return [...entries];

  return entries.map((entry) => {
    if (entry.action !== "DOWNLOAD" && entry.action !== "REPLACE") return entry;
    if (entry.expectedSize >= 0) return entry;
    const url = entry.download?.url;
    if (!url) return entry;
    const size = sizes.get(url);
    if (size === undefined) return entry;
    const download = entry.download ? { ...entry.download, expectedSize: size } : entry.download;
    return { ...entry, expectedSize: size, download };
  });
}
