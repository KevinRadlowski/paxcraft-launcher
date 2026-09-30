import fs from "node:fs";
import path from "node:path";
import type { AuthAccountRecord } from "./auth-desktop-service.js";

export const FAKE_AUTH_STORE_SCHEMA_VERSION = 1 as const;
export const FAKE_AUTH_STORE_FILENAME = "accounts.json";

export interface FakePersistedAccount {
  readonly accountId: string;
  readonly minecraftUsername: string;
  readonly minecraftUuid?: string;
  readonly lastUsedAtMs: number;
  /** Fake restorable session marker — never a real token. */
  readonly restorable: boolean;
}

export interface FakeAuthStoreFile {
  readonly schemaVersion: typeof FAKE_AUTH_STORE_SCHEMA_VERSION;
  readonly accounts: readonly FakePersistedAccount[];
}

const MAX_ACCOUNTS = 16;
const MAX_ID = 128;
const MAX_NAME = 64;
const MAX_UUID = 64;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function boundedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

/**
 * Parse + validate fake store. Corrupt / unknown schema → empty (fail safe).
 * Never throws for corrupt content.
 */
export function parseFakeAuthStore(raw: unknown): FakeAuthStoreFile {
  if (!isPlainObject(raw)) {
    return { schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION, accounts: [] };
  }
  if (raw.schemaVersion !== FAKE_AUTH_STORE_SCHEMA_VERSION) {
    return { schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION, accounts: [] };
  }
  if (!Array.isArray(raw.accounts) || raw.accounts.length > MAX_ACCOUNTS) {
    return { schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION, accounts: [] };
  }

  const accounts: FakePersistedAccount[] = [];
  for (const item of raw.accounts) {
    if (!isPlainObject(item)) continue;
    const accountId = boundedString(item.accountId, MAX_ID);
    const minecraftUsername = boundedString(item.minecraftUsername, MAX_NAME);
    if (!accountId || !minecraftUsername) continue;
    if (typeof item.restorable !== "boolean") continue;
    if (typeof item.lastUsedAtMs !== "number" || !Number.isFinite(item.lastUsedAtMs)) continue;
    if (item.lastUsedAtMs < 0 || item.lastUsedAtMs > Number.MAX_SAFE_INTEGER) continue;

    const entry: {
      accountId: string;
      minecraftUsername: string;
      minecraftUuid?: string;
      lastUsedAtMs: number;
      restorable: boolean;
    } = {
      accountId,
      minecraftUsername,
      lastUsedAtMs: Math.floor(item.lastUsedAtMs),
      restorable: item.restorable
    };
    const uuid = boundedString(item.minecraftUuid, MAX_UUID);
    if (uuid) entry.minecraftUuid = uuid;

    // Reject any accidental secret-looking keys by only copying allowlisted fields.
    accounts.push(entry);
  }

  return { schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION, accounts };
}

export function fakeStorePath(storeDir: string): string {
  return path.join(storeDir, FAKE_AUTH_STORE_FILENAME);
}

export function loadFakeAuthStore(storeDir: string): FakeAuthStoreFile {
  const file = fakeStorePath(storeDir);
  try {
    if (!fs.existsSync(file)) {
      return { schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION, accounts: [] };
    }
    const text = fs.readFileSync(file, "utf8");
    if (text.length > 256_000) {
      return { schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION, accounts: [] };
    }
    return parseFakeAuthStore(JSON.parse(text) as unknown);
  } catch {
    return { schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION, accounts: [] };
  }
}

/** Atomic write: tmp + rename. */
export function saveFakeAuthStore(storeDir: string, store: FakeAuthStoreFile): void {
  fs.mkdirSync(storeDir, { recursive: true });
  const file = fakeStorePath(storeDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload: FakeAuthStoreFile = {
    schemaVersion: FAKE_AUTH_STORE_SCHEMA_VERSION,
    accounts: store.accounts.slice(0, MAX_ACCOUNTS)
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function clearFakeAuthStore(storeDir: string): void {
  const file = fakeStorePath(storeDir);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

export function toPersisted(
  account: AuthAccountRecord,
  restorable: boolean
): FakePersistedAccount {
  const entry: {
    accountId: string;
    minecraftUsername: string;
    minecraftUuid?: string;
    lastUsedAtMs: number;
    restorable: boolean;
  } = {
    accountId: account.accountId,
    minecraftUsername: account.minecraftUsername,
    lastUsedAtMs: account.lastUsedAtMs,
    restorable
  };
  if (account.minecraftUuid) entry.minecraftUuid = account.minecraftUuid;
  return entry;
}

export function fromPersisted(p: FakePersistedAccount): AuthAccountRecord {
  const account: AuthAccountRecord = {
    accountId: p.accountId,
    minecraftUsername: p.minecraftUsername,
    lastUsedAtMs: p.lastUsedAtMs
  };
  if (p.minecraftUuid) account.minecraftUuid = p.minecraftUuid;
  return account;
}

/**
 * Trust-boundary gate for FakeAuthBackend.
 * Packaged builds must never activate fake via user-controlled env.
 */
export function shouldUseFakeAuthBackend(opts: {
  isPackaged: boolean;
  fakeEnv?: string | undefined;
}): boolean {
  if (opts.isPackaged) return false;
  const v = (opts.fakeEnv ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Dev-only fixture enum (IPC payload). */
export const FAKE_AUTH_FIXTURES = [
  "SUCCESS",
  "REAUTH_REQUIRED",
  "APPID_BLOCKED",
  "NOT_OWNED",
  "ERROR"
] as const;

export type FakeAuthFixtureId = (typeof FAKE_AUTH_FIXTURES)[number];

export function assertFakeAuthFixturePayload(raw: unknown): FakeAuthFixtureId {
  if (!isPlainObject(raw)) {
    throw Object.assign(new Error("invalid"), {
      code: "IPC_INVALID_PAYLOAD",
      messageKey: "errors.ipc.invalid_payload"
    });
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "fixture") {
    throw Object.assign(new Error("invalid"), {
      code: "IPC_INVALID_PAYLOAD",
      messageKey: "errors.ipc.invalid_payload"
    });
  }
  const fixture = raw.fixture;
  if (typeof fixture !== "string" || !(FAKE_AUTH_FIXTURES as readonly string[]).includes(fixture)) {
    throw Object.assign(new Error("invalid"), {
      code: "IPC_INVALID_PAYLOAD",
      messageKey: "errors.ipc.invalid_payload"
    });
  }
  return fixture as FakeAuthFixtureId;
}
