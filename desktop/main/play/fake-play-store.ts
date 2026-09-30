import fs from "node:fs";
import path from "node:path";
import { toUiError } from "../../shared/validate.js";
import type { PlayLifecycleState } from "../../shared/contract.js";

export const FAKE_PLAY_STORE_SCHEMA_VERSION = 1 as const;
export const FAKE_PLAY_STORE_FILENAME = "state.json";

export const FAKE_PLAY_FIXTURES = [
  "SUCCESS",
  "GAME_ALREADY_RUNNING",
  "ACCOUNT_MISMATCH",
  "JAVA_UNAVAILABLE",
  "SPAWN_FAILURE",
  "BIND_FAILURE",
  "NONZERO_EXIT",
  "MALFORMED_LOCK",
  "GENERIC_ERROR"
] as const;

export type FakePlayFixtureId = (typeof FAKE_PLAY_FIXTURES)[number];

export interface FakePlayStoreFile {
  readonly schemaVersion: typeof FAKE_PLAY_STORE_SCHEMA_VERSION;
  readonly fixture: FakePlayFixtureId;
  readonly state: PlayLifecycleState;
  readonly minecraftUsername: string | null;
  readonly accountId: string | null;
  readonly lastExitCode: number | null;
  /** Harmless fake session marker for cold restore — not an OS PID claim. */
  readonly fakeSessionActive: boolean;
}

export function shouldUseFakePlayBackend(opts: {
  isPackaged: boolean;
  fakeEnv: string | undefined;
}): boolean {
  if (opts.isPackaged) return false;
  return opts.fakeEnv === "1";
}

export function isFakePlayFixtureId(v: string): v is FakePlayFixtureId {
  return (FAKE_PLAY_FIXTURES as readonly string[]).includes(v);
}

export function assertFakePlayFixturePayload(raw: unknown): FakePlayFixtureId {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).length !== 1 || o.fixture === undefined) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  if (typeof o.fixture !== "string" || !isFakePlayFixtureId(o.fixture)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  return o.fixture;
}

export function defaultFakePlayState(
  fixture: FakePlayFixtureId = "SUCCESS"
): FakePlayStoreFile {
  return {
    schemaVersion: FAKE_PLAY_STORE_SCHEMA_VERSION,
    fixture,
    state: fixture === "GAME_ALREADY_RUNNING" ? "RUNNING" : fixture === "MALFORMED_LOCK" ? "RECOVERY_REQUIRED" : "UNAVAILABLE",
    minecraftUsername: null,
    accountId: null,
    lastExitCode: null,
    fakeSessionActive: fixture === "GAME_ALREADY_RUNNING"
  };
}

export function fakePlayStorePath(storeDir: string): string {
  return path.join(storeDir, FAKE_PLAY_STORE_FILENAME);
}

export function parseFakePlayStore(raw: unknown): FakePlayStoreFile {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaultFakePlayState();
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== FAKE_PLAY_STORE_SCHEMA_VERSION) return defaultFakePlayState();
  if (typeof o.fixture !== "string" || !isFakePlayFixtureId(o.fixture)) {
    return defaultFakePlayState();
  }
  const states = new Set([
    "UNAVAILABLE",
    "READY",
    "LAUNCHING",
    "RUNNING",
    "EXITED",
    "ERROR",
    "RECOVERY_REQUIRED"
  ]);
  const state =
    typeof o.state === "string" && states.has(o.state)
      ? (o.state as PlayLifecycleState)
      : defaultFakePlayState(o.fixture).state;
  return {
    schemaVersion: FAKE_PLAY_STORE_SCHEMA_VERSION,
    fixture: o.fixture,
    state,
    minecraftUsername: typeof o.minecraftUsername === "string" ? o.minecraftUsername.slice(0, 64) : null,
    accountId: typeof o.accountId === "string" ? o.accountId.slice(0, 128) : null,
    lastExitCode:
      typeof o.lastExitCode === "number" && Number.isFinite(o.lastExitCode)
        ? Math.trunc(o.lastExitCode)
        : o.lastExitCode === null
          ? null
          : null,
    fakeSessionActive: o.fakeSessionActive === true
  };
}

export function loadFakePlayStore(storeDir: string): FakePlayStoreFile {
  const file = fakePlayStorePath(storeDir);
  try {
    if (!fs.existsSync(file)) return defaultFakePlayState();
    const text = fs.readFileSync(file, "utf8");
    if (text.length > 64_000) return defaultFakePlayState();
    return parseFakePlayStore(JSON.parse(text) as unknown);
  } catch {
    return defaultFakePlayState();
  }
}

export function saveFakePlayStore(storeDir: string, store: FakePlayStoreFile): void {
  fs.mkdirSync(storeDir, { recursive: true });
  const file = fakePlayStorePath(storeDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function clearFakePlayStore(storeDir: string): void {
  const file = fakePlayStorePath(storeDir);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}
