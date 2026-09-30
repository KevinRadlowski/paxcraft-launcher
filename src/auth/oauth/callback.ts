import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { OAuthFlowState } from "../pkce.js";
import { assertFlowUsable } from "../pkce.js";
import type { Clock } from "../clock.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import { normalizeOAuthErrorCode, safeAuthErrorDetails } from "../redaction.js";

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

export interface OAuthCallbackWaiter {
  waitForCallback(flow: OAuthFlowState, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<OAuthCallbackResult>;
  close(): Promise<void>;
}

export interface LoopbackCallback {
  /** Exact redirect_uri used for authorize + token exchange. */
  redirectUri: string;
  /** Bound loopback host (always 127.0.0.1). */
  bindHost: "127.0.0.1";
  port: number;
  path: string;
  waitForCallback(flow: OAuthFlowState, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<OAuthCallbackResult>;
  close(): Promise<void>;
}

const CALLBACK_NO_STORE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  pragma: "no-cache"
};

/** Max request-target / query size (bytes) — fail closed on oversized OAuth redirects. */
export const MAX_CALLBACK_URL_BYTES = 8192;

const HTML_OK = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>SweetCraft</title></head><body><p>Connexion réussie. Vous pouvez fermer cette fenêtre et revenir dans SweetCraft Launcher.</p></body></html>`;
const HTML_ERR = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>SweetCraft</title></head><body><p>Connexion impossible. Vous pouvez revenir dans SweetCraft Launcher.</p></body></html>`;

/**
 * Start a loopback OAuth callback server.
 * Binds 127.0.0.1 ONLY (never 0.0.0.0). Dynamic port when port=0.
 * redirectUri uses http://localhost:{port}{path} to align with Entra `http://localhost` registration.
 */
export async function startLoopbackOAuthCallbackServer(opts: {
  clock: Clock;
  emitter?: ProgressEmitter;
  /** 0 = ephemeral. */
  port?: number;
  path?: string;
}): Promise<LoopbackCallback> {
  const bindHost = "127.0.0.1" as const;
  const callbackPath = normalizeCallbackPath(opts.path ?? "/");
  const portWanted = opts.port ?? 0;

  let server: Server | null = null;
  let closed = false;
  let boundPort = 0;

  const api: LoopbackCallback = {
    get redirectUri() {
      return `http://localhost:${boundPort}${callbackPath === "/" ? "/" : callbackPath}`;
    },
    bindHost,
    get port() {
      return boundPort;
    },
    path: callbackPath,
    async waitForCallback(flow, waitOpts = {}) {
      return waitOnServer({
        server: server!,
        bindHost,
        boundPort,
        callbackPath,
        flow,
        clock: opts.clock,
        timeoutMs: waitOpts.timeoutMs ?? 5 * 60 * 1000,
        close: () => api.close(),
        ...(opts.emitter ? { emitter: opts.emitter } : {}),
        ...(waitOpts.signal ? { signal: waitOpts.signal } : {})
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      const s = server;
      server = null;
      if (!s) return;
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
      });
    }
  };

  await new Promise<void>((ready, fail) => {
    server = createServer(); // handler attached in waitForCallback
    server.once("error", fail);
    server.listen(portWanted, bindHost, () => {
      const addr = server!.address();
      if (!addr || typeof addr === "string") {
        fail(new Error("no port"));
        return;
      }
      boundPort = addr.port;
      ready();
    });
  }).catch(() => {
    void api.close();
    throw new LauncherError(ErrorCode.OAUTH_ERROR, "callback listen failed", {});
  });

  return api;
}

/**
 * Legacy fixed-port waiter (offline tests / fixtures using 127.0.0.1:port/callback).
 */
export function createLoopbackCallbackWaiter(opts: {
  port: number;
  path?: string;
  clock: Clock;
  emitter?: ProgressEmitter;
  host?: "127.0.0.1" | "::1";
}): OAuthCallbackWaiter {
  const host = opts.host ?? "127.0.0.1";
  const callbackPath = normalizeCallbackPath(opts.path ?? "/callback");
  let server: Server | null = null;
  let closed = false;

  return {
    async waitForCallback(flow, waitOpts = {}) {
      assertFlowUsable(flow, opts.clock);
      const timeoutMs = waitOpts.timeoutMs ?? 5 * 60 * 1000;

      let settled = false;
      let settleOk!: (r: OAuthCallbackResult) => void;
      let settleErr!: (e: unknown) => void;
      let timer: ReturnType<typeof setTimeout>;

      const resultPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
        settleOk = (r) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          opts.emitter?.emit("AUTH_CALLBACK_RECEIVED", { ok: true });
          resolve(r);
          void this.close();
        };
        settleErr = (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          opts.emitter?.emit("AUTH_CALLBACK_RECEIVED", { ok: false });
          reject(e);
          void this.close();
        };
      });

      timer = setTimeout(() => {
        settleErr(new LauncherError(ErrorCode.OAUTH_FLOW_EXPIRED, "callback wait timed out"));
      }, timeoutMs);

      if (waitOpts.signal) {
        if (waitOpts.signal.aborted) {
          settleErr(new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "callback aborted", {}));
        } else {
          waitOpts.signal.addEventListener(
            "abort",
            () => settleErr(new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "callback aborted", {})),
            { once: true }
          );
        }
      }

      const handler = makeHandler({
        bindHost: host,
        boundPort: opts.port,
        callbackPath,
        flow,
        settleOk,
        settleErr,
        allowHost127: true
      });

      await new Promise<void>((ready, fail) => {
        server = createServer(handler);
        server.once("error", fail);
        server.listen(opts.port, host, () => ready());
      }).catch(() => {
        clearTimeout(timer);
        settled = true;
        void this.close();
        throw new LauncherError(ErrorCode.OAUTH_ERROR, "callback listen failed", {});
      });

      return resultPromise;
    },

    async close() {
      if (closed) return;
      closed = true;
      const s = server;
      server = null;
      if (!s) return;
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
      });
    }
  };
}

async function waitOnServer(opts: {
  server: Server;
  bindHost: string;
  boundPort: number;
  callbackPath: string;
  flow: OAuthFlowState;
  clock: Clock;
  emitter?: ProgressEmitter;
  timeoutMs: number;
  signal?: AbortSignal;
  close: () => Promise<void>;
}): Promise<OAuthCallbackResult> {
  assertFlowUsable(opts.flow, opts.clock);

  let settled = false;
  let settleOk!: (r: OAuthCallbackResult) => void;
  let settleErr!: (e: unknown) => void;
  let timer: ReturnType<typeof setTimeout>;

  const resultPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    settleOk = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.emitter?.emit("AUTH_CALLBACK_RECEIVED", { ok: true });
      resolve(r);
      void opts.close();
    };
    settleErr = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.emitter?.emit("AUTH_CALLBACK_RECEIVED", { ok: false });
      reject(e);
      void opts.close();
    };
  });

  timer = setTimeout(() => {
    settleErr(new LauncherError(ErrorCode.OAUTH_FLOW_EXPIRED, "callback wait timed out"));
  }, opts.timeoutMs);

  if (opts.signal) {
    if (opts.signal.aborted) {
      settleErr(new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "callback aborted", {}));
    } else {
      opts.signal.addEventListener(
        "abort",
        () => settleErr(new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "callback aborted", {})),
        { once: true }
      );
    }
  }

  const handler = makeHandler({
    bindHost: opts.bindHost,
    boundPort: opts.boundPort,
    callbackPath: opts.callbackPath,
    flow: opts.flow,
    settleOk,
    settleErr,
    allowHost127: true
  });
  opts.server.removeAllListeners("request");
  opts.server.on("request", handler);

  return resultPromise;
}

function makeHandler(opts: {
  bindHost: string;
  boundPort: number;
  callbackPath: string;
  flow: OAuthFlowState;
  settleOk: (r: OAuthCallbackResult) => void;
  settleErr: (e: unknown) => void;
  allowHost127: boolean;
}): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    try {
      const rawUrl = req.url ?? "/";
      if (Buffer.byteLength(rawUrl, "utf8") > MAX_CALLBACK_URL_BYTES) {
        res.writeHead(414, { ...CALLBACK_NO_STORE_HEADERS });
        res.end("URI Too Long");
        opts.settleErr(
          new LauncherError(ErrorCode.CALLBACK_URL_TOO_LARGE, "callback URL too large", {})
        );
        return;
      }

      if (!isAllowedHostHeader(req.headers.host, opts.boundPort, opts.allowHost127)) {
        res.writeHead(400, { ...CALLBACK_NO_STORE_HEADERS });
        res.end("Bad Host");
        // Parasite request — do NOT consume flow / settle
        return;
      }

      const u = new URL(rawUrl, `http://${opts.bindHost}:${opts.boundPort}`);
      if (u.pathname !== opts.callbackPath) {
        res.writeHead(404, { ...CALLBACK_NO_STORE_HEADERS });
        res.end("Not found");
        return;
      }

      if ((req.method ?? "GET").toUpperCase() !== "GET") {
        res.writeHead(405, {
          ...CALLBACK_NO_STORE_HEADERS,
          "content-type": "text/plain; charset=utf-8",
          allow: "GET"
        });
        res.end("Method Not Allowed");
        return;
      }

      const err = u.searchParams.get("error");
      if (err) {
        writeHtml(res, 400, HTML_ERR);
        opts.settleErr(
          new LauncherError(
            ErrorCode.OAUTH_ERROR,
            "oauth redirect error",
            safeAuthErrorDetails({
              oauthErrorCode: normalizeOAuthErrorCode(err)
            })
          )
        );
        return;
      }
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      if (!code || !state) {
        writeHtml(res, 400, HTML_ERR);
        // Incomplete callback — do not consume waiter
        return;
      }
      if (state !== opts.flow.state) {
        writeHtml(res, 400, HTML_ERR);
        // Wrong state: do NOT settle — parasite must not consume the waiter
        return;
      }
      writeHtml(res, 200, HTML_OK);
      opts.settleOk({ code, state });
    } catch (e) {
      if (LauncherError.isLauncherError(e)) {
        opts.settleErr(e);
      } else {
        opts.settleErr(new LauncherError(ErrorCode.OAUTH_ERROR, "callback handler failed", {}));
      }
    }
  };
}

function writeHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    ...CALLBACK_NO_STORE_HEADERS,
    "content-type": "text/html; charset=utf-8"
  });
  res.end(html);
}

function normalizeCallbackPath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1) || "/";
  return path;
}

function isAllowedHostHeader(
  hostHeader: string | undefined,
  port: number,
  allow127: boolean
): boolean {
  if (!hostHeader) return false;
  const h = hostHeader.trim().toLowerCase();
  const allowed = [`localhost:${port}`];
  if (allow127) {
    allowed.push(`127.0.0.1:${port}`);
  }
  // port 80 default forms (unlikely for ephemeral)
  if (port === 80) {
    allowed.push("localhost", "127.0.0.1");
  }
  return allowed.includes(h);
}

/**
 * Parse callback query without starting a server (unit tests / injected redirect URL).
 * Returns only { code, state }. Never embeds callbackUrl or error_description.
 */
export function parseOAuthCallbackUrl(
  callbackUrl: string,
  flow: OAuthFlowState,
  clock: Clock
): OAuthCallbackResult {
  assertFlowUsable(flow, clock);
  let u: URL;
  try {
    u = new URL(callbackUrl);
  } catch {
    throw new LauncherError(ErrorCode.OAUTH_ERROR, "invalid callback URL", {});
  }
  const err = u.searchParams.get("error");
  if (err) {
    throw new LauncherError(
      ErrorCode.OAUTH_ERROR,
      "oauth redirect error",
      safeAuthErrorDetails({
        oauthErrorCode: normalizeOAuthErrorCode(err)
      })
    );
  }
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state) {
    throw new LauncherError(ErrorCode.OAUTH_ERROR, "callback missing code or state");
  }
  if (state !== flow.state) {
    throw new LauncherError(ErrorCode.OAUTH_STATE_MISMATCH, "OAuth state mismatch");
  }
  return { code, state };
}
