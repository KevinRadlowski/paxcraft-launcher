import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  safeAuthErrorDetails,
  sanitizeAuthHttpRequest,
  AUTH_REDACTED
} from "../redaction.js";
import { assertRealOutboundTransportAllowed } from "../../product/paxNetworkConfig.js";

/**
 * Auth HTTP request — body is SENSITIVE BY DEFAULT.
 * NEVER LOG / NEVER SERIALIZE FOR DIAGNOSTICS / NEVER INCLUDE IN ERRORS.
 * Use sanitizeAuthHttpRequest() for any diagnostic representation.
 */
export interface AuthHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  /** Sensitive: codes, verifiers, tokens. Always redacted in safe views. */
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /**
   * OAuth token exchange / refresh MUST be non-retryable by default.
   * Only explicitly marked idempotent GETs may retry.
   */
  idempotent?: boolean;
}

export interface AuthHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface AuthHttpTransport {
  request(req: AuthHttpRequest): Promise<AuthHttpResponse>;
}

/** Safe call metadata for MockAuthHttpTransport.calls — no secret bodies. */
export interface SafeAuthHttpCall {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** Always "<redacted>" when a body was present. */
  body?: typeof AUTH_REDACTED;
  idempotent?: boolean;
  hadBody: boolean;
}

export type AuthFetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const DEFAULT_AUTH_TIMEOUT_MS = 30_000;
export const DEFAULT_AUTH_MAX_BYTES = 512 * 1024;

const ABORT_TIMEOUT = "SWEETCRAFT_AUTH_TIMEOUT";
const ABORT_USER = "SWEETCRAFT_AUTH_USER_ABORT";

function assertHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.AUTH_HTTP_ERROR, "invalid auth URL", safeAuthErrorDetails({}));
  }
  if (parsed.protocol !== "https:") {
    throw new LauncherError(ErrorCode.UNSAFE_REDIRECT, "auth HTTP requires HTTPS", {});
  }
  return parsed;
}

class AuthRequestSession {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onExternalAbort: (() => void) | null;
  private readonly external: AbortSignal | undefined;
  private disposed = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(
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
      return new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "auth request aborted by caller", {});
    }
    return new LauncherError(ErrorCode.AUTH_HTTP_TIMEOUT, `auth HTTP timeout after ${this.timeoutMs}ms`, {
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
 * HTTPS auth transport — timeout covers connection → headers → full body.
 * External AbortSignal → AUTH_REQUEST_ABORTED (never presented as timeout).
 * Bodies never appear in thrown error details.
 */
export class FetchAuthHttpTransport implements AuthHttpTransport {
  private readonly fetchImpl: AuthFetchLike;
  private readonly realOutbound: boolean;

  constructor(opts: { fetchImpl?: AuthFetchLike } = {}) {
    this.realOutbound = opts.fetchImpl === undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request(req: AuthHttpRequest): Promise<AuthHttpResponse> {
    // Injected fetchImpl = hermetic harness; default fetch = real outbound (blocked).
    if (this.realOutbound) {
      assertRealOutboundTransportAllowed();
    }
    assertHttpsUrl(req.url);
    const timeoutMs = req.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
    const maxBytes = req.maxBytes ?? DEFAULT_AUTH_MAX_BYTES;
    const session = new AuthRequestSession(timeoutMs, req.signal);

    try {
      if (req.signal?.aborted) {
        throw session.classifyAbort();
      }

      let response: Response;
      try {
        const init: RequestInit = {
          method: req.method,
          redirect: "error",
          signal: session.controller.signal
        };
        if (req.headers) init.headers = req.headers;
        if (req.body !== undefined) init.body = req.body;
        response = await this.fetchImpl(req.url, init);
      } catch (e) {
        if (LauncherError.isLauncherError(e)) throw e;
        if (session.controller.signal.aborted) {
          throw session.classifyAbort();
        }
        // External Error.message is hostile — never copy into LauncherError.
        throw new LauncherError(ErrorCode.NETWORK_ERROR, "auth network error", {
          phase: "fetch"
        });
      }

      const body = await readBodyEndToEnd(response, session, maxBytes);
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      return { status: response.status, headers, body };
    } finally {
      session.dispose();
    }
  }
}

async function readBodyEndToEnd(
  response: Response,
  session: AuthRequestSession,
  maxBytes: number
): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  session.attachReader(reader);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (session.controller.signal.aborted) {
        throw session.classifyAbort();
      }
      if (value) {
        size += value.byteLength;
        if (size > maxBytes) {
          throw new LauncherError(ErrorCode.AUTH_RESPONSE_TOO_LARGE, "auth response too large", {
            size,
            maxBytes
          });
        }
        chunks.push(value);
      }
    }
  } catch (e) {
    if (LauncherError.isLauncherError(e)) throw e;
    if (session.controller.signal.aborted) {
      throw session.classifyAbort();
    }
    // External stream/Error.message is hostile — never copy into LauncherError.
    throw new LauncherError(ErrorCode.NETWORK_ERROR, "auth body read error", {
      phase: "body"
    });
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * In-memory mock for hermetic tests.
 * `calls` stores SAFE metadata only (body always redacted).
 * Use consumeCapturedSensitiveBody() for explicit test-only body inspection.
 */
export class MockAuthHttpTransport implements AuthHttpTransport {
  /** Safe call log — never contains raw secret bodies. */
  readonly calls: SafeAuthHttpCall[] = [];
  private routes = new Map<
    string,
    {
      status: number;
      body: string;
      headers?: Record<string, string>;
      delayMs?: number;
      stallAfterBytes?: number;
      stallMs?: number;
    }
  >();
  /** Test-only sensitive body ring — not for production diagnostics. */
  private sensitiveBodies: Array<string | undefined> = [];

  set(
    method: string,
    url: string,
    body: string,
    opts: {
      status?: number;
      delayMs?: number;
      stallAfterBytes?: number;
      stallMs?: number;
    } = {}
  ): void {
    const entry: {
      status: number;
      body: string;
      headers?: Record<string, string>;
      delayMs?: number;
      stallAfterBytes?: number;
      stallMs?: number;
    } = {
      status: opts.status ?? 200,
      body,
      headers: { "content-type": "application/json" }
    };
    if (opts.delayMs !== undefined) entry.delayMs = opts.delayMs;
    if (opts.stallAfterBytes !== undefined) entry.stallAfterBytes = opts.stallAfterBytes;
    if (opts.stallMs !== undefined) entry.stallMs = opts.stallMs;
    this.routes.set(`${method.toUpperCase()} ${url}`, entry);
  }

  /**
   * TEST-ONLY: pop the most recent raw request body for assertions.
   * Must not be used for logging or production diagnostics.
   */
  consumeCapturedSensitiveBody(): string | undefined {
    return this.sensitiveBodies.pop();
  }

  async request(req: AuthHttpRequest): Promise<AuthHttpResponse> {
    assertHttpsUrl(req.url);
    const safe = sanitizeAuthHttpRequest(req);
    const call: SafeAuthHttpCall = {
      method: String(safe.method),
      url: String(safe.url),
      hadBody: req.body !== undefined
    };
    if (safe.headers) call.headers = safe.headers as Record<string, string>;
    if (req.body !== undefined) call.body = AUTH_REDACTED;
    if (req.idempotent !== undefined) call.idempotent = req.idempotent;
    this.calls.push(call);
    this.sensitiveBodies.push(req.body);

    const key = `${req.method} ${req.url}`;
    const entry = this.routes.get(key);
    if (!entry) {
      throw new LauncherError(ErrorCode.AUTH_HTTP_ERROR, "HTTP 404", { status: 404 });
    }
    const timeoutMs = req.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;

    if (req.signal?.aborted) {
      throw new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "auth request aborted by caller", {});
    }

    // Full-request delay (headers not yet available).
    // delayMs > timeoutMs → immediate timeout (deterministic unit tests).
    // delayMs ≤ timeoutMs → wait, honouring external AbortSignal.
    if (entry.delayMs !== undefined) {
      if (entry.delayMs > timeoutMs) {
        throw new LauncherError(ErrorCode.AUTH_HTTP_TIMEOUT, "auth HTTP timeout", { timeoutMs });
      }
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => resolve(), entry.delayMs);
        if (!req.signal) return;
        const onAbort = () => {
          clearTimeout(t);
          reject(
            new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "auth request aborted by caller", {})
          );
        };
        if (req.signal.aborted) {
          onAbort();
          return;
        }
        req.signal.addEventListener("abort", onAbort, { once: true });
      });
    }

    // Simulate 200 + first chunk + stall (body phase)
    if (entry.stallAfterBytes !== undefined && entry.stallMs !== undefined) {
      if (entry.stallMs > timeoutMs) {
        if (req.signal) {
          await new Promise<never>((_, rej) => {
            const t = setTimeout(() => {
              rej(
                new LauncherError(ErrorCode.AUTH_HTTP_TIMEOUT, "auth HTTP timeout", { timeoutMs })
              );
            }, timeoutMs);
            req.signal!.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                rej(
                  new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "auth request aborted by caller", {})
                );
              },
              { once: true }
            );
          });
        }
        throw new LauncherError(ErrorCode.AUTH_HTTP_TIMEOUT, "auth HTTP timeout", { timeoutMs });
      }
    }

    if (Buffer.byteLength(entry.body, "utf8") > (req.maxBytes ?? DEFAULT_AUTH_MAX_BYTES)) {
      throw new LauncherError(ErrorCode.AUTH_RESPONSE_TOO_LARGE, "auth response too large", {});
    }
    return {
      status: entry.status,
      headers: entry.headers ?? {},
      body: entry.body
    };
  }
}

/**
 * Parse auth JSON. `context` must be an internal controlled label (never network text).
 * Never copies SyntaxError.message into LauncherError.
 */
export function parseJsonAuthBody(body: string, context: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_RESPONSE, "invalid JSON", {
      context
    });
  }
}

export function assertAuthHttpOk(res: AuthHttpResponse, context: string): void {
  if (res.status < 200 || res.status >= 300) {
    throw new LauncherError(ErrorCode.AUTH_HTTP_ERROR, `auth HTTP ${res.status} (${context})`, {
      status: res.status
    });
  }
}
