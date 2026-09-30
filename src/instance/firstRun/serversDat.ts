import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/**
 * Minimal big-endian NBT codec for Minecraft Java `servers.dat` (uncompressed).
 * Contract verified against MC 26.1.2 instance sample (root compound → list "servers").
 */

export const NBT_TAG_END = 0;
export const NBT_TAG_BYTE = 1;
export const NBT_TAG_SHORT = 2;
export const NBT_TAG_INT = 3;
export const NBT_TAG_LONG = 4;
export const NBT_TAG_FLOAT = 5;
export const NBT_TAG_DOUBLE = 6;
export const NBT_TAG_BYTE_ARRAY = 7;
export const NBT_TAG_STRING = 8;
export const NBT_TAG_LIST = 9;
export const NBT_TAG_COMPOUND = 10;
export const NBT_TAG_INT_ARRAY = 11;
export const NBT_TAG_LONG_ARRAY = 12;

export interface MinecraftServerEntry {
  name: string;
  ip: string;
  /** Preserved opaque fields when rewriting (icon, hidden, …). */
  extra?: Record<string, NbtValue>;
}

export type NbtValue =
  | { type: typeof NBT_TAG_BYTE; value: number }
  | { type: typeof NBT_TAG_SHORT; value: number }
  | { type: typeof NBT_TAG_INT; value: number }
  | { type: typeof NBT_TAG_LONG; value: bigint }
  | { type: typeof NBT_TAG_FLOAT; value: number }
  | { type: typeof NBT_TAG_DOUBLE; value: number }
  | { type: typeof NBT_TAG_STRING; value: string }
  | { type: typeof NBT_TAG_BYTE_ARRAY; value: Buffer }
  | { type: typeof NBT_TAG_INT_ARRAY; value: number[] }
  | { type: typeof NBT_TAG_LONG_ARRAY; value: bigint[] }
  | { type: typeof NBT_TAG_LIST; listType: number; value: NbtValue[] }
  | { type: typeof NBT_TAG_COMPOUND; value: Record<string, NbtValue> };

function fail(message: string, details: Record<string, unknown> = {}): never {
  throw new LauncherError(ErrorCode.FIRST_RUN_SEED_FAILED, message, details);
}

function readName(buf: Buffer, o: number): { name: string; o: number } {
  if (o + 2 > buf.length) fail("nbt truncated name length");
  const len = buf.readUInt16BE(o);
  o += 2;
  if (o + len > buf.length) fail("nbt truncated name");
  return { name: buf.toString("utf8", o, o + len), o: o + len };
}

function readStringPayload(buf: Buffer, o: number): { value: string; o: number } {
  if (o + 2 > buf.length) fail("nbt truncated string length");
  const len = buf.readUInt16BE(o);
  o += 2;
  if (o + len > buf.length) fail("nbt truncated string");
  return { value: buf.toString("utf8", o, o + len), o: o + len };
}

function readPayload(buf: Buffer, o: number, type: number): { value: NbtValue; o: number } {
  switch (type) {
    case NBT_TAG_BYTE:
      return { value: { type, value: buf.readInt8(o) }, o: o + 1 };
    case NBT_TAG_SHORT:
      return { value: { type, value: buf.readInt16BE(o) }, o: o + 2 };
    case NBT_TAG_INT:
      return { value: { type, value: buf.readInt32BE(o) }, o: o + 4 };
    case NBT_TAG_LONG:
      return { value: { type, value: buf.readBigInt64BE(o) }, o: o + 8 };
    case NBT_TAG_FLOAT:
      return { value: { type, value: buf.readFloatBE(o) }, o: o + 4 };
    case NBT_TAG_DOUBLE:
      return { value: { type, value: buf.readDoubleBE(o) }, o: o + 8 };
    case NBT_TAG_BYTE_ARRAY: {
      const n = buf.readInt32BE(o);
      o += 4;
      if (n < 0 || o + n > buf.length) fail("nbt invalid byte array");
      return { value: { type, value: Buffer.from(buf.subarray(o, o + n)) }, o: o + n };
    }
    case NBT_TAG_STRING: {
      const s = readStringPayload(buf, o);
      return { value: { type, value: s.value }, o: s.o };
    }
    case NBT_TAG_LIST: {
      const listType = buf[o]!;
      o += 1;
      const count = buf.readInt32BE(o);
      o += 4;
      if (count < 0) fail("nbt invalid list count");
      const items: NbtValue[] = [];
      for (let i = 0; i < count; i++) {
        const item = readPayload(buf, o, listType);
        items.push(item.value);
        o = item.o;
      }
      return { value: { type, listType, value: items }, o };
    }
    case NBT_TAG_COMPOUND: {
      const fields: Record<string, NbtValue> = {};
      while (true) {
        if (o >= buf.length) fail("nbt truncated compound");
        const t = buf[o]!;
        o += 1;
        if (t === NBT_TAG_END) break;
        const n = readName(buf, o);
        o = n.o;
        const payload = readPayload(buf, o, t);
        fields[n.name] = payload.value;
        o = payload.o;
      }
      return { value: { type, value: fields }, o };
    }
    case NBT_TAG_INT_ARRAY: {
      const n = buf.readInt32BE(o);
      o += 4;
      if (n < 0 || o + n * 4 > buf.length) fail("nbt invalid int array");
      const arr: number[] = [];
      for (let i = 0; i < n; i++) {
        arr.push(buf.readInt32BE(o));
        o += 4;
      }
      return { value: { type, value: arr }, o };
    }
    case NBT_TAG_LONG_ARRAY: {
      const n = buf.readInt32BE(o);
      o += 4;
      if (n < 0 || o + n * 8 > buf.length) fail("nbt invalid long array");
      const arr: bigint[] = [];
      for (let i = 0; i < n; i++) {
        arr.push(buf.readBigInt64BE(o));
        o += 8;
      }
      return { value: { type, value: arr }, o };
    }
    default:
      fail("nbt unsupported tag type", { type });
  }
}

export function parseServersDat(buf: Buffer): MinecraftServerEntry[] {
  if (buf.length === 0) fail("servers.dat empty");
  let o = 0;
  const rootType = buf[o++]!;
  if (rootType !== NBT_TAG_COMPOUND) fail("servers.dat root must be compound", { rootType });
  const rootName = readName(buf, o);
  o = rootName.o;
  const root = readPayload(buf, o, NBT_TAG_COMPOUND);
  if (root.value.type !== NBT_TAG_COMPOUND) fail("servers.dat root payload invalid");
  const servers = root.value.value.servers;
  if (!servers || servers.type !== NBT_TAG_LIST) {
    fail("servers.dat missing servers list");
  }
  if (servers.listType !== NBT_TAG_COMPOUND) {
    fail("servers.dat servers list must be compound", { listType: servers.listType });
  }
  const out: MinecraftServerEntry[] = [];
  for (const item of servers.value) {
    if (item.type !== NBT_TAG_COMPOUND) fail("servers.dat entry not compound");
    const nameTag = item.value.name;
    const ipTag = item.value.ip;
    if (!nameTag || nameTag.type !== NBT_TAG_STRING || !ipTag || ipTag.type !== NBT_TAG_STRING) {
      fail("servers.dat entry missing name/ip strings");
    }
    const extra: Record<string, NbtValue> = {};
    for (const [k, v] of Object.entries(item.value)) {
      if (k === "name" || k === "ip") continue;
      extra[k] = v;
    }
    out.push({
      name: nameTag.value,
      ip: ipTag.value,
      ...(Object.keys(extra).length > 0 ? { extra } : {})
    });
  }
  return out;
}

function writeName(chunks: Buffer[], name: string): void {
  const b = Buffer.from(name, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  chunks.push(len, b);
}

function writeStringPayload(chunks: Buffer[], value: string): void {
  const b = Buffer.from(value, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  chunks.push(len, b);
}

function writePayload(chunks: Buffer[], value: NbtValue): void {
  switch (value.type) {
    case NBT_TAG_BYTE: {
      const b = Buffer.alloc(1);
      b.writeInt8(value.value);
      chunks.push(b);
      return;
    }
    case NBT_TAG_SHORT: {
      const b = Buffer.alloc(2);
      b.writeInt16BE(value.value);
      chunks.push(b);
      return;
    }
    case NBT_TAG_INT: {
      const b = Buffer.alloc(4);
      b.writeInt32BE(value.value);
      chunks.push(b);
      return;
    }
    case NBT_TAG_LONG: {
      const b = Buffer.alloc(8);
      b.writeBigInt64BE(value.value);
      chunks.push(b);
      return;
    }
    case NBT_TAG_FLOAT: {
      const b = Buffer.alloc(4);
      b.writeFloatBE(value.value);
      chunks.push(b);
      return;
    }
    case NBT_TAG_DOUBLE: {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(value.value);
      chunks.push(b);
      return;
    }
    case NBT_TAG_STRING:
      writeStringPayload(chunks, value.value);
      return;
    case NBT_TAG_BYTE_ARRAY: {
      const n = Buffer.alloc(4);
      n.writeInt32BE(value.value.length);
      chunks.push(n, value.value);
      return;
    }
    case NBT_TAG_INT_ARRAY: {
      const n = Buffer.alloc(4);
      n.writeInt32BE(value.value.length);
      chunks.push(n);
      for (const v of value.value) {
        const b = Buffer.alloc(4);
        b.writeInt32BE(v);
        chunks.push(b);
      }
      return;
    }
    case NBT_TAG_LONG_ARRAY: {
      const n = Buffer.alloc(4);
      n.writeInt32BE(value.value.length);
      chunks.push(n);
      for (const v of value.value) {
        const b = Buffer.alloc(8);
        b.writeBigInt64BE(v);
        chunks.push(b);
      }
      return;
    }
    case NBT_TAG_LIST: {
      chunks.push(Buffer.from([value.listType]));
      const n = Buffer.alloc(4);
      n.writeInt32BE(value.value.length);
      chunks.push(n);
      for (const item of value.value) writePayload(chunks, item);
      return;
    }
    case NBT_TAG_COMPOUND:
      for (const [k, v] of Object.entries(value.value)) {
        chunks.push(Buffer.from([v.type]));
        writeName(chunks, k);
        writePayload(chunks, v);
      }
      chunks.push(Buffer.from([NBT_TAG_END]));
      return;
  }
}

export function encodeServersDat(servers: MinecraftServerEntry[]): Buffer {
  const compounds: NbtValue[] = servers.map(s => {
    const fields: Record<string, NbtValue> = {
      name: { type: NBT_TAG_STRING, value: s.name },
      ip: { type: NBT_TAG_STRING, value: s.ip }
    };
    if (s.extra) {
      for (const [k, v] of Object.entries(s.extra)) {
        fields[k] = v;
      }
    }
    return { type: NBT_TAG_COMPOUND, value: fields };
  });

  const root: NbtValue = {
    type: NBT_TAG_COMPOUND,
    value: {
      servers: { type: NBT_TAG_LIST, listType: NBT_TAG_COMPOUND, value: compounds }
    }
  };

  const chunks: Buffer[] = [Buffer.from([NBT_TAG_COMPOUND])];
  writeName(chunks, "");
  writePayload(chunks, root);
  return Buffer.concat(chunks);
}

export function normalizeServerAddress(ip: string): string {
  return ip.trim().toLowerCase();
}

export function serverAddressEquals(a: string, b: string): boolean {
  return normalizeServerAddress(a) === normalizeServerAddress(b);
}
