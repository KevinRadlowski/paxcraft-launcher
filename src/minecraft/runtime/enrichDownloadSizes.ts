import type { HttpClient } from "../../distribution/http/index.js";
import { resolveUniqueContentLengths } from "../../download/planning/probeContentLength.js";
import type { RuntimePlanEntry } from "./types.js";

/**
 * Mojang/Fabric metadata may omit Maven library sizes — enrich via HEAD before RUNTIME_PLAN_READY.
 */
export async function enrichRuntimePlanDownloadSizes(
  entries: readonly RuntimePlanEntry[],
  http: HttpClient,
  signal?: AbortSignal
): Promise<RuntimePlanEntry[]> {
  const probeUrls: string[] = [];
  for (const entry of entries) {
    if (entry.action !== "DOWNLOAD" && entry.action !== "REPAIR") continue;
    if (typeof entry.expectedSize === "number" && entry.expectedSize >= 0) continue;
    if (entry.url) probeUrls.push(entry.url);
  }
  if (probeUrls.length === 0) return [...entries];

  const sizes = await resolveUniqueContentLengths(http, probeUrls, signal);
  if (sizes.size === 0) return [...entries];

  return entries.map((entry) => {
    if (entry.action !== "DOWNLOAD" && entry.action !== "REPAIR") return entry;
    if (typeof entry.expectedSize === "number" && entry.expectedSize >= 0) return entry;
    const url = entry.url;
    if (!url) return entry;
    const size = sizes.get(url);
    if (size === undefined) return entry;
    return { ...entry, expectedSize: size };
  });
}
