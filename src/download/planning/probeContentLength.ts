import type { HttpClient } from "../../distribution/http/index.js";
import { parseContentLengthHeader } from "../engine/contentLength.js";

/**
 * Resolve artifact size via HTTPS HEAD before download planning (PACK-10.1G.6.1).
 * Uses the same HTTPS-only client as metadata resolution — no body is transferred.
 */
export async function probeRemoteContentLength(
  http: HttpClient,
  url: string,
  signal?: AbortSignal
): Promise<number | null> {
  try {
    const req: Parameters<HttpClient["request"]>[0] = { url, method: "HEAD" };
    if (signal) req.signal = signal;
    const resp = await http.request(req);
    return parseContentLengthHeader(resp.headers["content-length"] ?? null);
  } catch {
    return null;
  }
}

/** Probe unique URLs concurrently; omit entries that could not be sized. */
export async function resolveUniqueContentLengths(
  http: HttpClient,
  urls: readonly string[],
  signal?: AbortSignal
): Promise<Map<string, number>> {
  const unique = [...new Set(urls.filter((u) => u.length > 0))];
  const out = new Map<string, number>();
  await Promise.all(
    unique.map(async (url) => {
      const size = await probeRemoteContentLength(http, url, signal);
      if (size !== null) out.set(url, size);
    })
  );
  return out;
}
