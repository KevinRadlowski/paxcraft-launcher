import { createReadStream } from "node:fs";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { parseContentLengthHeader } from "./contentLength.js";
import {
  MAX_DOWNLOAD_REDIRECTS,
  type ByteSource,
  type ByteSourceOpenOptions,
  type ByteSourceOpenResult
} from "./types.js";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface FetchByteSourceOptions {
  /** Injected fetch for hermetic tests (defaults to global fetch). */
  fetchImpl?: FetchLike;
  maxRedirects?: number;
}

const ABORT_TIMEOUT = "SWEETCRAFT_DOWNLOAD_TIMEOUT";
const ABORT_USER = "SWEETCRAFT_DOWNLOAD_USER_ABORT";

/**
 * Session spanning open()+body read so timeout covers the full download lifetime.
 * Resources (timer, listeners, reader cancel) are released only when the stream ends or fails.
 */
class DownloadSession {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onExternalAbort: (() => void) | null;
  private readonly external: AbortSignal | undefined;
  private disposed = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(
    readonly url: string,
    readonly timeoutMs: number,
    external?: AbortSignal
  ) {
    this.external = external;
    if (external) {
      this.onExternalAbort = () => {
        if (!this.controller.signal.aborted) {
          this.controller.abort(ABORT_USER);
        }
      };
      if (external.aborted) {
        this.controller.abort(ABORT_USER);
      } else {
        external.addEventListener("abort", this.onExternalAbort, { once: true });
      }
    } else {
      this.onExternalAbort = null;
    }
    this.timer = setTimeout(() => {
      if (!this.controller.signal.aborted) {
        this.controller.abort(ABORT_TIMEOUT);
      }
    }, timeoutMs);
  }

  attachReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
    this.reader = reader;
  }

  classifyAbort(): LauncherError {
    if (this.external?.aborted || this.controller.signal.reason === ABORT_USER) {
      return new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "download aborted by caller", {
        url: this.url
      });
    }
    return new LauncherError(ErrorCode.HTTP_TIMEOUT, `download timeout after ${this.timeoutMs}ms`, {
      url: this.url,
      timeoutMs: this.timeoutMs
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.external && this.onExternalAbort) {
      this.external.removeEventListener("abort", this.onExternalAbort);
    }
    if (this.reader) {
      void this.reader.cancel().catch(() => undefined);
      this.reader = null;
    }
  }
}

/**
 * HTTPS-only fetch stream source.
 * Timeout covers connection → headers → redirects → full body read.
 */
export class FetchByteSource implements ByteSource {
  private readonly fetchImpl: FetchLike;
  private readonly maxRedirects: number;

  constructor(opts: FetchByteSourceOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRedirects = opts.maxRedirects ?? MAX_DOWNLOAD_REDIRECTS;
  }

  async open(url: string, opts: ByteSourceOpenOptions): Promise<ByteSourceOpenResult> {
    assertHttpsUrl(url);
    const session = new DownloadSession(url, opts.timeoutMs, opts.signal);

    try {
      const { response, finalUrl } = await this.fetchFollowingRedirects(url, session);

      if (response.status !== 200) {
        throw new LauncherError(ErrorCode.HTTP_ERROR, `HTTP ${response.status}`, {
          status: response.status,
          url: finalUrl
        });
      }

      const contentLength = parseContentLengthHeader(response.headers.get("content-length"));
      if (!response.body) {
        throw new LauncherError(ErrorCode.DOWNLOAD_FAILED, "empty response body", { url });
      }

      const reader = response.body.getReader();
      session.attachReader(reader);

      const stream = this.wrapReader(reader, session);
      return { stream, contentLength };
    } catch (e) {
      session.dispose();
      throw this.mapOpenError(e, session, url);
    }
  }

  private async fetchFollowingRedirects(
    startUrl: string,
    session: DownloadSession
  ): Promise<{ response: Response; finalUrl: string }> {
    const seen = new Set<string>();
    let current = startUrl;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (seen.has(current)) {
        throw new LauncherError(ErrorCode.TOO_MANY_REDIRECTS, "redirect loop detected", {
          url: current,
          maxRedirects: this.maxRedirects
        });
      }
      seen.add(current);
      assertHttpsUrl(current);

      let response: Response;
      try {
        response = await this.fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          signal: session.controller.signal
        });
      } catch (e) {
        throw this.mapFetchAbort(e, session, current);
      }

      if (response.status >= 300 && response.status < 400) {
        if (hop >= this.maxRedirects) {
          throw new LauncherError(ErrorCode.TOO_MANY_REDIRECTS, `exceeded max redirects (${this.maxRedirects})`, {
            url: current,
            maxRedirects: this.maxRedirects,
            hops: hop + 1
          });
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new LauncherError(ErrorCode.HTTP_ERROR, "redirect without Location", {
            status: response.status,
            url: current
          });
        }
        const next = new URL(location, current);
        if (next.protocol !== "https:") {
          throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "redirect to non-HTTPS refused", {
            from: current,
            to: next.toString()
          });
        }
        // Drain/cancel unused redirect body if present
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        current = next.toString();
        continue;
      }

      return { response, finalUrl: current };
    }

    throw new LauncherError(ErrorCode.TOO_MANY_REDIRECTS, `exceeded max redirects (${this.maxRedirects})`, {
      url: startUrl,
      maxRedirects: this.maxRedirects
    });
  }

  private wrapReader(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    session: DownloadSession
  ): AsyncIterable<Buffer> {
    const self = this;
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        try {
          for (;;) {
            let done: boolean;
            let value: Uint8Array | undefined;
            try {
              const readResult = await reader.read();
              done = readResult.done;
              value = readResult.value;
            } catch (e) {
              throw self.mapFetchAbort(e, session, session.url);
            }
            if (session.controller.signal.aborted) {
              throw session.classifyAbort();
            }
            if (done) break;
            if (value && value.byteLength > 0) {
              yield Buffer.from(value);
            }
          }
        } finally {
          session.dispose();
        }
      }
    };
  }

  private mapFetchAbort(e: unknown, session: DownloadSession, url: string): LauncherError {
    if (LauncherError.isLauncherError(e)) return e;
    if (session.controller.signal.aborted || isAbortError(e)) {
      return session.classifyAbort();
    }
    return new LauncherError(ErrorCode.NETWORK_ERROR, `network error`, {
      url,
      cause: e instanceof Error ? e.message : String(e)
    });
  }

  private mapOpenError(e: unknown, session: DownloadSession, url: string): LauncherError {
    if (LauncherError.isLauncherError(e)) return e;
    return this.mapFetchAbort(e, session, url);
  }
}

function assertHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.NETWORK_ERROR, `invalid download URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "download URL must be HTTPS", { url });
  }
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** In-memory / local-file mock source for hermetic tests. */
export class MockByteSource implements ByteSource {
  private readonly map = new Map<
    string,
    {
      body: Buffer;
      delayMs?: number;
      stallAfterBytes?: number;
      stallMs?: number;
      fail?: ErrorCode;
      status?: number;
      contentLength?: number | null;
      contentLengthRaw?: string;
    }
  >();

  set(
    url: string,
    body: Buffer | string,
    opts: {
      delayMs?: number;
      stallAfterBytes?: number;
      stallMs?: number;
      fail?: ErrorCode;
      status?: number;
      contentLength?: number | null;
      contentLengthRaw?: string;
    } = {}
  ): void {
    const entry: {
      body: Buffer;
      delayMs?: number;
      stallAfterBytes?: number;
      stallMs?: number;
      fail?: ErrorCode;
      status?: number;
      contentLength?: number | null;
      contentLengthRaw?: string;
    } = {
      body: typeof body === "string" ? Buffer.from(body) : body
    };
    if (opts.delayMs !== undefined) entry.delayMs = opts.delayMs;
    if (opts.stallAfterBytes !== undefined) entry.stallAfterBytes = opts.stallAfterBytes;
    if (opts.stallMs !== undefined) entry.stallMs = opts.stallMs;
    if (opts.fail !== undefined) entry.fail = opts.fail;
    if (opts.status !== undefined) entry.status = opts.status;
    if (opts.contentLength !== undefined) entry.contentLength = opts.contentLength;
    if (opts.contentLengthRaw !== undefined) entry.contentLengthRaw = opts.contentLengthRaw;
    this.map.set(url, entry);
  }

  async open(url: string, opts: ByteSourceOpenOptions): Promise<ByteSourceOpenResult> {
    if (url.startsWith("file:")) {
      const filePath = url.slice("file:".length);
      const stream = createReadStream(filePath);
      return {
        stream: stream as unknown as AsyncIterable<Buffer>,
        contentLength: null
      };
    }

    const entry = this.map.get(url);
    if (!entry) {
      throw new LauncherError(ErrorCode.HTTP_ERROR, "HTTP 404", { status: 404, url });
    }
    if (entry.fail) {
      throw new LauncherError(entry.fail, `mock failure ${entry.fail}`, {
        url,
        ...(entry.fail === ErrorCode.HTTP_ERROR && entry.status !== undefined
          ? { status: entry.status }
          : {})
      });
    }
    if (entry.status !== undefined && entry.status !== 200) {
      throw new LauncherError(ErrorCode.HTTP_ERROR, `HTTP ${entry.status}`, {
        status: entry.status,
        url
      });
    }
    if (entry.delayMs && entry.delayMs > opts.timeoutMs) {
      throw new LauncherError(ErrorCode.HTTP_TIMEOUT, "download timeout", {
        url,
        timeoutMs: opts.timeoutMs
      });
    }
    if (entry.delayMs) {
      await new Promise((r) => setTimeout(r, entry.delayMs));
    }
    if (opts.signal?.aborted) {
      throw new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "aborted", { url });
    }

    const body = entry.body;
    const stallAfter = entry.stallAfterBytes;
    const stallMs = entry.stallMs ?? 60_000;
    const timeoutMs = opts.timeoutMs;
    const external = opts.signal;

    const stream = (async function* () {
      const stall = { cleanup: null as (() => void) | null };
      try {
        let sent = 0;
        const chunkSize = 64 * 1024;
        while (sent < body.byteLength) {
          if (external?.aborted) {
            throw new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "aborted", { url });
          }
          if (stallAfter !== undefined && sent >= stallAfter) {
            await new Promise<void>((_resolve, reject) => {
              const timer = setTimeout(() => {
                cleanup();
                reject(
                  new LauncherError(ErrorCode.HTTP_TIMEOUT, "download timeout", {
                    url,
                    timeoutMs
                  })
                );
              }, Math.min(stallMs, timeoutMs + 1));
              const onAbort = () => {
                cleanup();
                reject(new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "aborted", { url }));
              };
              const cleanup = () => {
                clearTimeout(timer);
                external?.removeEventListener("abort", onAbort);
                stall.cleanup = null;
              };
              stall.cleanup = cleanup;
              if (external) external.addEventListener("abort", onAbort, { once: true });
            });
          }
          const next = Math.min(sent + chunkSize, body.byteLength);
          // If stallAfter is in the middle of remaining, send up to stallAfter first
          const end =
            stallAfter !== undefined && sent < stallAfter && next > stallAfter ? stallAfter : next;
          yield body.subarray(sent, end);
          sent = end;
        }
      } finally {
        // IteratorClose / abrupt consumer exit must clear pending stall timers
        // so a late reject cannot become an unhandledRejection after the test ends.
        stall.cleanup?.();
        stall.cleanup = null;
      }
    })();

    let contentLength: number | null;
    if (entry.contentLengthRaw !== undefined) {
      contentLength = parseContentLengthHeader(entry.contentLengthRaw);
    } else if (entry.contentLength !== undefined) {
      contentLength = entry.contentLength;
    } else {
      contentLength = body.byteLength;
    }

    return { stream, contentLength };
  }
}
