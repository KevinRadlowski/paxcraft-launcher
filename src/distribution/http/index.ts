import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  assertRealOutboundTransportAllowed,
  isHistoricalBlockedHost
} from "../../product/paxNetworkConfig.js";

export interface HttpRequestOptions {
  url: string;
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Maximum response body size in bytes (default 2 MiB for metadata). */
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  finalUrl: string;
}

export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

export const DEFAULT_METADATA_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function assertHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.NETWORK_ERROR, `invalid URL: ${url}`, { url });
  }
  if (parsed.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, `only HTTPS is allowed, got ${parsed.protocol}`, {});
  }
  if (parsed.username || parsed.password) {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "URL must not contain credentials", {});
  }
  if (isHistoricalBlockedHost(parsed.hostname)) {
    throw new LauncherError(
      ErrorCode.HISTORICAL_DESTINATION_BLOCKED,
      "historical SweetCraft destination refused",
      { hostname: parsed.hostname.toLowerCase() }
    );
  }
  return parsed;
}

/**
 * HTTPS-only fetch client with timeout, size limit, and redirect protocol checks.
 * Redirects are followed manually so non-HTTPS targets are rejected.
 */
export class FetchHttpClient implements HttpClient {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    // Harness permits never authorize real fetch — fail closed before network I/O.
    assertRealOutboundTransportAllowed();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_METADATA_MAX_BYTES;
    let currentUrl = assertHttpsUrl(options.url).toString();
    const method = options.method ?? "GET";

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        throw new LauncherError(ErrorCode.HTTP_TIMEOUT, "request aborted");
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Manual redirect loop (max 5) to enforce HTTPS on every hop.
      for (let hop = 0; hop < 5; hop++) {
        let response: Response;
        try {
          const init: RequestInit = {
            method,
            redirect: "manual",
            signal: controller.signal
          };
          if (options.headers) {
            init.headers = options.headers;
          }
          response = await fetch(currentUrl, init);
        } catch (e) {
          if (controller.signal.aborted) {
            throw new LauncherError(ErrorCode.HTTP_TIMEOUT, `HTTP timeout after ${timeoutMs}ms`, {
              url: currentUrl,
              timeoutMs
            });
          }
          throw new LauncherError(ErrorCode.NETWORK_ERROR, `network error fetching ${currentUrl}`, {
            url: currentUrl,
            cause: e instanceof Error ? e.message : String(e)
          });
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) {
            throw new LauncherError(ErrorCode.HTTP_ERROR, `redirect without Location`, {
              status: response.status,
              url: currentUrl
            });
          }
          const next = new URL(location, currentUrl);
          if (next.protocol !== "https:") {
            throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, `redirect to non-HTTPS refused`, {
              from: currentUrl,
              to: next.toString()
            });
          }
          if (next.username || next.password) {
            throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "redirect must not contain credentials", {
              from: currentUrl,
              to: next.toString()
            });
          }
          if (isHistoricalBlockedHost(next.hostname)) {
            throw new LauncherError(
              ErrorCode.HISTORICAL_DESTINATION_BLOCKED,
              "redirect to historical SweetCraft destination refused",
              { from: currentUrl, hostname: next.hostname.toLowerCase() }
            );
          }
          currentUrl = next.toString();
          continue;
        }

        if (response.status !== 200) {
          throw new LauncherError(ErrorCode.HTTP_ERROR, `HTTP ${response.status}`, {
            status: response.status,
            url: currentUrl
          });
        }

        const headers = normalizeHeaders(response.headers);

        if (method === "HEAD") {
          return {
            status: response.status,
            headers,
            body: Buffer.alloc(0),
            finalUrl: currentUrl
          };
        }

        const contentLength = response.headers.get("content-length");
        if (contentLength !== null) {
          const len = Number(contentLength);
          if (Number.isFinite(len) && len > maxBytes) {
            throw new LauncherError(ErrorCode.METADATA_TOO_LARGE, `Content-Length ${len} exceeds max ${maxBytes}`, {
              contentLength: len,
              maxBytes,
              url: currentUrl
            });
          }
        }

        const ab = await response.arrayBuffer();
        const body = Buffer.from(ab);
        if (body.byteLength > maxBytes) {
          throw new LauncherError(ErrorCode.METADATA_TOO_LARGE, `body ${body.byteLength} exceeds max ${maxBytes}`, {
            size: body.byteLength,
            maxBytes,
            url: currentUrl
          });
        }

        return {
          status: response.status,
          headers,
          body,
          finalUrl: currentUrl
        };
      }

      throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "too many redirects", { url: options.url });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}

/** In-memory mock HTTP client for offline tests. */
export class MockHttpClient implements HttpClient {
  private readonly routes: Map<string, { status?: number; body: Buffer; headers?: Record<string, string>; delayMs?: number }>;

  constructor() {
    this.routes = new Map();
  }

  set(url: string, body: Buffer | string, opts: { status?: number; headers?: Record<string, string>; delayMs?: number } = {}): void {
    const entry: { status?: number; body: Buffer; headers?: Record<string, string>; delayMs?: number } = {
      status: opts.status ?? 200,
      body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
      headers: opts.headers ?? { "content-type": "application/json" }
    };
    if (opts.delayMs !== undefined) {
      entry.delayMs = opts.delayMs;
    }
    this.routes.set(url, entry);
  }

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    assertHttpsUrl(options.url);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_METADATA_MAX_BYTES;
    const method = options.method ?? "GET";
    const entry = this.routes.get(options.url);
    if (!entry) {
      throw new LauncherError(ErrorCode.HTTP_ERROR, `HTTP 404`, { status: 404, url: options.url });
    }
    if (entry.delayMs && entry.delayMs > timeoutMs) {
      throw new LauncherError(ErrorCode.HTTP_TIMEOUT, `HTTP timeout after ${timeoutMs}ms`, {
        url: options.url,
        timeoutMs
      });
    }
    if (entry.delayMs) {
      await new Promise((r) => setTimeout(r, entry.delayMs));
    }
    if (options.signal?.aborted) {
      throw new LauncherError(ErrorCode.HTTP_TIMEOUT, "request aborted");
    }
    const status = entry.status ?? 200;
    if (status !== 200) {
      throw new LauncherError(ErrorCode.HTTP_ERROR, `HTTP ${status}`, { status, url: options.url });
    }
    if (method === "HEAD") {
      return {
        status,
        headers: entry.headers ?? {},
        body: Buffer.alloc(0),
        finalUrl: options.url
      };
    }
    if (entry.body.byteLength > maxBytes) {
      throw new LauncherError(ErrorCode.METADATA_TOO_LARGE, `body exceeds max ${maxBytes}`, {
        size: entry.body.byteLength,
        maxBytes,
        url: options.url
      });
    }
    return {
      status,
      headers: entry.headers ?? {},
      body: entry.body,
      finalUrl: options.url
    };
  }
}
