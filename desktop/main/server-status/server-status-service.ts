import type { ServerStatusDto, ServerReachabilityState } from "../../shared/contract.js";
import { SWEETCRAFT_SERVER_ADDRESS } from "../../shared/contract.js";
import {
  McStatusOfflineError,
  McStatusTimeoutError,
  pingMinecraftServer,
  type McStatusPingOptions
} from "./mc-status-ping.js";

export type ServerStatusPingFn = (
  options: McStatusPingOptions
) => Promise<{
  online: true;
  latencyMs: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  versionLabel: string | null;
}>;

const DEFAULT_TIMEOUT_MS = 4000;

export function normalizeServerStatusDto(raw: unknown): ServerStatusDto {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return unknownStatus();
  }
  const o = raw as Record<string, unknown>;
  const stateRaw = o.state;
  const state: ServerReachabilityState =
    stateRaw === "ONLINE" || stateRaw === "OFFLINE" || stateRaw === "UNKNOWN"
      ? stateRaw
      : "UNKNOWN";

  const latencyMs =
    typeof o.latencyMs === "number" && Number.isFinite(o.latencyMs) && o.latencyMs >= 0
      ? Math.min(Math.floor(o.latencyMs), 600_000)
      : null;
  const playersOnline =
    typeof o.playersOnline === "number" && Number.isFinite(o.playersOnline) && o.playersOnline >= 0
      ? Math.floor(o.playersOnline)
      : null;
  const playersMax =
    typeof o.playersMax === "number" && Number.isFinite(o.playersMax) && o.playersMax >= 0
      ? Math.floor(o.playersMax)
      : null;
  const versionLabel =
    typeof o.versionLabel === "string" && o.versionLabel.length > 0
      ? o.versionLabel.slice(0, 128)
      : null;
  const checkedAt =
    typeof o.checkedAt === "string" && o.checkedAt.length > 0
      ? o.checkedAt.slice(0, 64)
      : new Date().toISOString();
  const address =
    typeof o.address === "string" && o.address.length > 0
      ? o.address.slice(0, 253)
      : SWEETCRAFT_SERVER_ADDRESS;

  return {
    state,
    latencyMs: state === "ONLINE" ? latencyMs : null,
    playersOnline: state === "ONLINE" ? playersOnline : null,
    playersMax: state === "ONLINE" ? playersMax : null,
    versionLabel: state === "ONLINE" ? versionLabel : null,
    checkedAt,
    address
  };
}

function unknownStatus(checkedAt = new Date().toISOString()): ServerStatusDto {
  return {
    state: "UNKNOWN",
    latencyMs: null,
    playersOnline: null,
    playersMax: null,
    versionLabel: null,
    checkedAt,
    address: SWEETCRAFT_SERVER_ADDRESS
  };
}

function offlineStatus(checkedAt = new Date().toISOString()): ServerStatusDto {
  return {
    state: "OFFLINE",
    latencyMs: null,
    playersOnline: null,
    playersMax: null,
    versionLabel: null,
    checkedAt,
    address: SWEETCRAFT_SERVER_ADDRESS
  };
}

/**
 * Main-side server status service.
 * Host/port come ONLY from product constant — never from renderer payload.
 */
export class ServerStatusService {
  private inFlight: Promise<ServerStatusDto> | null = null;
  private readonly ping: ServerStatusPingFn;
  private readonly timeoutMs: number;

  constructor(opts?: { ping?: ServerStatusPingFn; timeoutMs?: number }) {
    this.ping = opts?.ping ?? ((o) => pingMinecraftServer(o));
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Empty payload only — host is never taken from renderer. */
  async getStatus(): Promise<ServerStatusDto> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.query().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async query(): Promise<ServerStatusDto> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.ping({
        host: SWEETCRAFT_SERVER_ADDRESS,
        timeoutMs: this.timeoutMs
      });
      return normalizeServerStatusDto({
        state: "ONLINE" satisfies ServerReachabilityState,
        latencyMs: result.latencyMs,
        playersOnline: result.playersOnline,
        playersMax: result.playersMax,
        versionLabel: result.versionLabel,
        checkedAt,
        address: SWEETCRAFT_SERVER_ADDRESS
      });
    } catch (e) {
      if (e instanceof McStatusTimeoutError) {
        // Timeout → UNKNOWN (no proof of offline).
        return unknownStatus(checkedAt);
      }
      if (e instanceof McStatusOfflineError) {
        return offlineStatus(checkedAt);
      }
      // Unexpected — fail closed as UNKNOWN, never leak message.
      return unknownStatus(checkedAt);
    }
  }
}

let singleton: ServerStatusService | null = null;

export function getServerStatusService(): ServerStatusService {
  if (!singleton) singleton = new ServerStatusService();
  return singleton;
}

/** Test helper — reset singleton between suites. */
export function resetServerStatusServiceForTests(): void {
  singleton = null;
}
