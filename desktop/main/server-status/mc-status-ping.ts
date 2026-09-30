/**
 * Minecraft Java Edition Server List Ping (status) — isolated desktop utility.
 * No dependency on frozen launch/runtime paths.
 */
import net from "node:net";
import dns from "node:dns/promises";

export interface McStatusPingResult {
  readonly online: true;
  readonly latencyMs: number | null;
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  readonly versionLabel: string | null;
  readonly protocol: number | null;
}

export interface McStatusPingOptions {
  readonly host: string;
  readonly port?: number;
  /** Overall deadline in ms (connect + handshake + response). */
  readonly timeoutMs?: number;
  /** Optional injectable for tests. */
  readonly connect?: typeof defaultConnect;
  readonly resolveSrv?: typeof resolveMinecraftSrv;
}

export class McStatusTimeoutError extends Error {
  constructor(message = "mc_status_timeout") {
    super(message);
    this.name = "McStatusTimeoutError";
  }
}

export class McStatusOfflineError extends Error {
  constructor(message = "mc_status_offline") {
    super(message);
    this.name = "McStatusOfflineError";
  }
}

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let temp = v & 0x7f;
    v >>>= 7;
    if (v !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function readVarInt(
  buf: Buffer,
  offset: number
): { value: number; size: number } | null {
  let value = 0;
  let size = 0;
  let byte: number;
  do {
    if (offset + size >= buf.length) return null;
    byte = buf[offset + size]!;
    value |= (byte & 0x7f) << (7 * size);
    size++;
    if (size > 5) return null;
  } while ((byte & 0x80) !== 0);
  return { value, size };
}

function writeString(str: string): Buffer {
  const data = Buffer.from(str, "utf8");
  return Buffer.concat([writeVarInt(data.length), data]);
}

function writeUnsignedShort(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}

function writeLong(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(n, 0);
  return b;
}

function framePacket(packetId: number, payload: Buffer): Buffer {
  const id = writeVarInt(packetId);
  const body = Buffer.concat([id, payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

export async function resolveMinecraftSrv(
  host: string
): Promise<{ host: string; port: number } | null> {
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (!records.length) return null;
    records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
    const top = records[0]!;
    return { host: top.name.replace(/\.$/, ""), port: top.port };
  } catch {
    return null;
  }
}

type SocketLike = {
  write(data: Buffer): boolean;
  destroy(): void;
  on(event: "data", cb: (chunk: Buffer) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: () => void): void;
  setNoDelay?(v: boolean): void;
};

async function defaultConnect(
  host: string,
  port: number,
  timeoutMs: number
): Promise<SocketLike> {
  return await new Promise<SocketLike>((resolve, reject) => {
    const socket = net.connect({ host, port });
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new McStatusTimeoutError());
    };
    const timer = setTimeout(onTimeout, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("error", onErr);
      socket.off("connect", onConnect);
    };
    const onConnect = () => {
      cleanup();
      socket.setNoDelay?.(true);
      resolve(socket);
    };
    socket.on("error", onErr);
    socket.once("connect", onConnect);
  });
}

function parseStatusJson(raw: string): {
  playersOnline: number | null;
  playersMax: number | null;
  versionLabel: string | null;
  protocol: number | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      playersOnline: null,
      playersMax: null,
      versionLabel: null,
      protocol: null
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      playersOnline: null,
      playersMax: null,
      versionLabel: null,
      protocol: null
    };
  }
  const o = parsed as Record<string, unknown>;
  let playersOnline: number | null = null;
  let playersMax: number | null = null;
  const players = o.players;
  if (typeof players === "object" && players !== null && !Array.isArray(players)) {
    const p = players as Record<string, unknown>;
    if (typeof p.online === "number" && Number.isFinite(p.online) && p.online >= 0) {
      playersOnline = Math.floor(p.online);
    }
    if (typeof p.max === "number" && Number.isFinite(p.max) && p.max >= 0) {
      playersMax = Math.floor(p.max);
    }
  }
  let versionLabel: string | null = null;
  let protocol: number | null = null;
  const version = o.version;
  if (typeof version === "object" && version !== null && !Array.isArray(version)) {
    const v = version as Record<string, unknown>;
    if (typeof v.name === "string" && v.name.length > 0 && v.name.length <= 128) {
      versionLabel = v.name.slice(0, 128);
    }
    if (typeof v.protocol === "number" && Number.isFinite(v.protocol)) {
      protocol = Math.floor(v.protocol);
    }
  }
  return { playersOnline, playersMax, versionLabel, protocol };
}

/**
 * Perform a Java Edition status ping against host:port.
 * Uses protocol version -1 (status probe) per wiki.vg convention.
 */
export async function pingMinecraftServer(
  options: McStatusPingOptions
): Promise<McStatusPingResult> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const connect = options.connect ?? defaultConnect;
  const resolveSrv = options.resolveSrv ?? resolveMinecraftSrv;

  let host = options.host.trim();
  let port = options.port ?? 25565;

  if (host.includes(":") && options.port === undefined) {
    const idx = host.lastIndexOf(":");
    const maybePort = Number(host.slice(idx + 1));
    if (Number.isInteger(maybePort) && maybePort > 0 && maybePort <= 65535) {
      port = maybePort;
      host = host.slice(0, idx);
    }
  }

  if (!host || host.length > 253 || /[\0\s/\\]/.test(host)) {
    throw new McStatusOfflineError("mc_status_invalid_host");
  }

  // Prefer SRV when port was not explicitly forced via host:port in input.
  if (options.port === undefined && !options.host.includes(":")) {
    const srv = await resolveSrv(host);
    if (srv) {
      host = srv.host;
      port = srv.port;
    }
  }

  const started = Date.now();
  let socket: SocketLike;
  try {
    socket = await connect(host, port, timeoutMs);
  } catch (e) {
    if (e instanceof McStatusTimeoutError) throw e;
    throw new McStatusOfflineError();
  }

  const remaining = () => Math.max(50, timeoutMs - (Date.now() - started));

  return await new Promise<McStatusPingResult>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let settled = false;
    let phase: "status" | "ping" = "status";
    let pingSentAt: number | null = null;
    let statusFields: ReturnType<typeof parseStatusJson> | null = null;

    const timer = setTimeout(() => {
      fail(new McStatusTimeoutError());
    }, remaining());

    const cleanup = () => {
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = (latencyMs: number | null) => {
      if (settled || !statusFields) return;
      settled = true;
      cleanup();
      resolve({
        online: true,
        latencyMs,
        playersOnline: statusFields.playersOnline,
        playersMax: statusFields.playersMax,
        versionLabel: statusFields.versionLabel,
        protocol: statusFields.protocol
      });
    };

    const tryConsume = () => {
      while (true) {
        const len = readVarInt(buf, 0);
        if (!len) return;
        const total = len.size + len.value;
        if (buf.length < total) return;
        const packet = buf.subarray(len.size, total);
        buf = buf.subarray(total);
        const id = readVarInt(packet, 0);
        if (!id) {
          fail(new McStatusOfflineError("mc_status_bad_packet"));
          return;
        }
        const payload = packet.subarray(id.size);

        if (phase === "status") {
          if (id.value !== 0x00) {
            fail(new McStatusOfflineError("mc_status_unexpected_packet"));
            return;
          }
          const strLen = readVarInt(payload, 0);
          if (!strLen) {
            fail(new McStatusOfflineError("mc_status_bad_json_len"));
            return;
          }
          const jsonStart = strLen.size;
          const jsonEnd = jsonStart + strLen.value;
          if (payload.length < jsonEnd) {
            fail(new McStatusOfflineError("mc_status_truncated_json"));
            return;
          }
          const json = payload.subarray(jsonStart, jsonEnd).toString("utf8");
          if (json.length > 65536) {
            fail(new McStatusOfflineError("mc_status_json_too_large"));
            return;
          }
          statusFields = parseStatusJson(json);
          phase = "ping";
          pingSentAt = Date.now();
          const token = BigInt(pingSentAt);
          socket.write(framePacket(0x01, writeLong(token)));
          continue;
        }

        if (phase === "ping") {
          // Latency from round-trip; ignore payload mismatch → still ONLINE with null latency.
          const latency =
            pingSentAt !== null ? Math.max(0, Date.now() - pingSentAt) : null;
          succeed(latency);
          return;
        }
      }
    };

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 512 * 1024) {
        fail(new McStatusOfflineError("mc_status_buffer_overflow"));
        return;
      }
      try {
        tryConsume();
      } catch (e) {
        fail(e instanceof Error ? e : new McStatusOfflineError());
      }
    });
    socket.on("error", () => fail(new McStatusOfflineError()));
    socket.on("close", () => {
      if (!settled && statusFields) {
        // Some servers close after status without answering ping — still ONLINE.
        succeed(null);
        return;
      }
      if (!settled) fail(new McStatusOfflineError());
    });

    // Handshake (next state = 1 status) + status request.
    // Protocol -1 is accepted by modern servers for status probing.
    const handshake = Buffer.concat([
      writeVarInt(-1),
      writeString(host),
      writeUnsignedShort(port),
      writeVarInt(1)
    ]);
    socket.write(framePacket(0x00, handshake));
    socket.write(framePacket(0x00, Buffer.alloc(0)));
  });
}
