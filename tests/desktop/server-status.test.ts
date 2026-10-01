import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { EventEmitter } from "node:events";
import {
  McStatusOfflineError,
  McStatusTimeoutError,
  pingMinecraftServer
} from "../../desktop/main/server-status/mc-status-ping.js";
import {
  ServerStatusService,
  normalizeServerStatusDto,
  resetServerStatusServiceForTests,
  setConfiguredServerAddressForTests
} from "../../desktop/main/server-status/server-status-service.js";
import {
  IpcChannels,
  PAX_SERVER_ADDRESS_UNCONFIGURED,
  SWEETCRAFT_SERVER_ADDRESS
} from "../../desktop/shared/contract.js";
import { assertEmptyInvokePayload } from "../../desktop/shared/validate.js";

/** Minimal fake TCP status responder (status JSON only, then close). */
function encodeVarInt(value: number): Buffer {
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

function frame(packetId: number, payload: Buffer): Buffer {
  const id = encodeVarInt(packetId);
  const body = Buffer.concat([id, payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function statusResponseJson(json: string): Buffer {
  const data = Buffer.from(json, "utf8");
  return frame(0x00, Buffer.concat([encodeVarInt(data.length), data]));
}

class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  write(data: Buffer): boolean {
    this.written.push(data);
    queueMicrotask(() => {
      if (this.destroyed) return;
      if (this.written.length === 2) {
        this.emit(
          "data",
          statusResponseJson(
            JSON.stringify({
              version: { name: "1.20.1", protocol: 763 },
              players: { online: 12, max: 100 },
              description: { text: "SweetCraft" }
            })
          )
        );
      } else if (this.written.length >= 3) {
        const pingBody = Buffer.alloc(8);
        this.emit("data", frame(0x01, pingBody));
      }
    });
    return true;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit("close");
  }
  setNoDelay(): void {}
}

describe("0.6F.2 V3 Minecraft server status", () => {
  beforeEach(() => {
    resetServerStatusServiceForTests();
    setConfiguredServerAddressForTests("127.0.0.1");
  });
  afterEach(() => {
    resetServerStatusServiceForTests();
  });

  it("unconfigured Pax server → UNKNOWN without ping (not historical OFFLINE)", async () => {
    setConfiguredServerAddressForTests(null);
    let calls = 0;
    const service = new ServerStatusService({
      ping: async () => {
        calls++;
        return {
          online: true as const,
          latencyMs: 1,
          playersOnline: 1,
          playersMax: 1,
          versionLabel: "x"
        };
      }
    });
    const dto = await service.getStatus();
    assert.equal(calls, 0);
    assert.equal(dto.state, "UNKNOWN");
    assert.equal(dto.address, PAX_SERVER_ADDRESS_UNCONFIGURED);
    assert.notEqual(dto.address, SWEETCRAFT_SERVER_ADDRESS);
  });

  it("ONLINE result maps players + latency", async () => {
    const service = new ServerStatusService({
      ping: async () => ({
        online: true as const,
        latencyMs: 16,
        playersOnline: 247,
        playersMax: 500,
        versionLabel: "1.20.1"
      })
    });
    const dto = await service.getStatus();
    assert.equal(dto.state, "ONLINE");
    assert.equal(dto.latencyMs, 16);
    assert.equal(dto.playersOnline, 247);
    assert.equal(dto.playersMax, 500);
    assert.equal(dto.versionLabel, "1.20.1");
    assert.equal(dto.address, "127.0.0.1");
  });

  it("OFFLINE from protocol offline error", async () => {
    const service = new ServerStatusService({
      ping: async () => {
        throw new McStatusOfflineError();
      }
    });
    const dto = await service.getStatus();
    assert.equal(dto.state, "OFFLINE");
    assert.equal(dto.latencyMs, null);
    assert.equal(dto.playersOnline, null);
  });

  it("UNKNOWN from timeout (not forced OFFLINE)", async () => {
    const service = new ServerStatusService({
      ping: async () => {
        throw new McStatusTimeoutError();
      }
    });
    const dto = await service.getStatus();
    assert.equal(dto.state, "UNKNOWN");
  });

  it("UNKNOWN from unexpected throw — no raw message leak", async () => {
    const service = new ServerStatusService({
      ping: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:25565 secret-path");
      }
    });
    const dto = await service.getStatus();
    assert.equal(dto.state, "UNKNOWN");
    assert.equal(JSON.stringify(dto).includes("secret-path"), false);
    assert.equal(JSON.stringify(dto).includes("ECONNREFUSED"), false);
  });

  it("partial player data preserved as nulls", async () => {
    const service = new ServerStatusService({
      ping: async () => ({
        online: true as const,
        latencyMs: null,
        playersOnline: 3,
        playersMax: null,
        versionLabel: null
      })
    });
    const dto = await service.getStatus();
    assert.equal(dto.state, "ONLINE");
    assert.equal(dto.playersOnline, 3);
    assert.equal(dto.playersMax, null);
    assert.equal(dto.latencyMs, null);
  });

  it("malformed normalize → UNKNOWN", () => {
    const dto = normalizeServerStatusDto({ state: "HACKED", latencyMs: "nope" });
    assert.equal(dto.state, "UNKNOWN");
    assert.equal(dto.address, PAX_SERVER_ADDRESS_UNCONFIGURED);
  });

  it("concurrent refresh shares one in-flight promise", async () => {
    let calls = 0;
    const service = new ServerStatusService({
      ping: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 40));
        return {
          online: true as const,
          latencyMs: 10,
          playersOnline: 1,
          playersMax: 10,
          versionLabel: "x"
        };
      }
    });
    const [a, b] = await Promise.all([service.getStatus(), service.getStatus()]);
    assert.equal(calls, 1);
    assert.equal(a.playersOnline, b.playersOnline);
  });

  it("IPC channel is explicit empty-payload only", () => {
    assert.equal(IpcChannels.SERVER_GET_STATUS, "sc:server:getStatus");
    assert.doesNotThrow(() => assertEmptyInvokePayload(undefined));
    assert.throws(() => assertEmptyInvokePayload({ host: "evil.com" }));
    assert.throws(() => assertEmptyInvokePayload({ port: 25565 }));
  });

  it("pingMinecraftServer parses fake socket ONLINE", async () => {
    const socket = new FakeSocket();
    const result = await pingMinecraftServer({
      host: "example.invalid",
      port: 25565,
      timeoutMs: 2000,
      resolveSrv: async () => null,
      connect: async () => socket
    });
    assert.equal(result.online, true);
    assert.equal(result.playersOnline, 12);
    assert.equal(result.playersMax, 100);
    assert.equal(result.versionLabel, "1.20.1");
    assert.ok(result.latencyMs === null || result.latencyMs >= 0);
  });

  it("host comes from product config only — never renderer (and never historical default)", async () => {
    setConfiguredServerAddressForTests("127.0.0.1");
    const seen: string[] = [];
    const service = new ServerStatusService({
      ping: async (opts) => {
        seen.push(opts.host);
        return {
          online: true as const,
          latencyMs: 1,
          playersOnline: 0,
          playersMax: 1,
          versionLabel: null
        };
      }
    });
    await service.getStatus();
    assert.deepEqual(seen, ["127.0.0.1"]);
    assert.ok(!seen.includes(SWEETCRAFT_SERVER_ADDRESS));
  });

  it("historical constant remains documented but is not the ping default", () => {
    assert.equal(SWEETCRAFT_SERVER_ADDRESS, "sweetcraft.datho.st");
    assert.equal(PAX_SERVER_ADDRESS_UNCONFIGURED, "not-configured");
  });
});
