import fs from "node:fs";
import path from "node:path";
import { toUiError } from "../../shared/validate.js";
import type { LauncherReadiness } from "../../shared/contract.js";

export const FAKE_INSTALL_STORE_SCHEMA_VERSION = 1 as const;
export const FAKE_INSTALL_STORE_FILENAME = "state.json";

export const FAKE_INSTALL_FIXTURES = [
  "NOT_INSTALLED",
  "READY",
  "UPDATE_AVAILABLE",
  "REPAIR_REQUIRED",
  "RECOVERY_REQUIRED",
  "BUSY",
  "NETWORK_ERROR",
  "INTEGRITY_ERROR",
  "GENERIC_ERROR"
] as const;

export type FakeInstallFixtureId = (typeof FAKE_INSTALL_FIXTURES)[number];

export interface FakeInstallStoreFile {
  readonly schemaVersion: typeof FAKE_INSTALL_STORE_SCHEMA_VERSION;
  readonly fixture: FakeInstallFixtureId;
  readonly readiness: LauncherReadiness;
  readonly installedVersion: string | null;
  readonly latestVersion: string | null;
}

const ALLOWED_READINESS = new Set<string>([
  "NOT_INSTALLED",
  "READY",
  "UPDATE_AVAILABLE",
  "REPAIR_REQUIRED",
  "BUSY",
  "INCOMPATIBLE_STATE",
  "RECOVERY_REQUIRED",
  "UNKNOWN",
  "ERROR"
]);

export function shouldUseFakeInstallBackend(opts: {
  isPackaged: boolean;
  fakeEnv: string | undefined;
}): boolean {
  if (opts.isPackaged) return false;
  return opts.fakeEnv === "1";
}

export function isFakeInstallFixtureId(v: string): v is FakeInstallFixtureId {
  return (FAKE_INSTALL_FIXTURES as readonly string[]).includes(v);
}

export function assertFakeInstallFixturePayload(raw: unknown): FakeInstallFixtureId {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1 || keys[0] !== "fixture") {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  if (typeof o.fixture !== "string" || !isFakeInstallFixtureId(o.fixture)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  return o.fixture;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function defaultFakeInstallState(
  fixture: FakeInstallFixtureId = "NOT_INSTALLED"
): FakeInstallStoreFile {
  return {
    schemaVersion: FAKE_INSTALL_STORE_SCHEMA_VERSION,
    fixture,
    ...fixtureToState(fixture)
  };
}

export function fixtureToState(fixture: FakeInstallFixtureId): {
  readiness: LauncherReadiness;
  installedVersion: string | null;
  latestVersion: string | null;
} {
  switch (fixture) {
    case "NOT_INSTALLED":
      return { readiness: "NOT_INSTALLED", installedVersion: null, latestVersion: "1.0.0-fake" };
    case "READY":
      return {
        readiness: "READY",
        installedVersion: "1.0.0-fake",
        latestVersion: "1.0.0-fake"
      };
    case "UPDATE_AVAILABLE":
      return {
        readiness: "UPDATE_AVAILABLE",
        installedVersion: "1.0.0-fake",
        latestVersion: "1.1.0-fake"
      };
    case "REPAIR_REQUIRED":
      return {
        readiness: "REPAIR_REQUIRED",
        installedVersion: "1.0.0-fake",
        latestVersion: "1.0.0-fake"
      };
    case "RECOVERY_REQUIRED":
      return {
        readiness: "RECOVERY_REQUIRED",
        installedVersion: "1.0.0-fake",
        latestVersion: "1.0.0-fake"
      };
    case "BUSY":
      return {
        readiness: "BUSY",
        installedVersion: "1.0.0-fake",
        latestVersion: "1.0.0-fake"
      };
    case "NETWORK_ERROR":
      return {
        readiness: "NOT_INSTALLED",
        installedVersion: null,
        latestVersion: "1.0.0-fake"
      };
    case "INTEGRITY_ERROR":
      return {
        readiness: "UPDATE_AVAILABLE",
        installedVersion: "1.0.0-fake",
        latestVersion: "1.1.0-fake"
      };
    case "GENERIC_ERROR":
      return {
        readiness: "NOT_INSTALLED",
        installedVersion: null,
        latestVersion: "1.0.0-fake"
      };
  }
}

export function parseFakeInstallStore(raw: unknown): FakeInstallStoreFile {
  if (!isPlainObject(raw) || raw.schemaVersion !== FAKE_INSTALL_STORE_SCHEMA_VERSION) {
    return defaultFakeInstallState("NOT_INSTALLED");
  }
  if (typeof raw.fixture !== "string" || !isFakeInstallFixtureId(raw.fixture)) {
    return defaultFakeInstallState("NOT_INSTALLED");
  }
  const readiness =
    typeof raw.readiness === "string" && ALLOWED_READINESS.has(raw.readiness)
      ? (raw.readiness as LauncherReadiness)
      : fixtureToState(raw.fixture).readiness;
  const installedVersion =
    raw.installedVersion === null
      ? null
      : typeof raw.installedVersion === "string" && raw.installedVersion.length <= 64
        ? raw.installedVersion
        : fixtureToState(raw.fixture).installedVersion;
  const latestVersion =
    raw.latestVersion === null
      ? null
      : typeof raw.latestVersion === "string" && raw.latestVersion.length <= 64
        ? raw.latestVersion
        : fixtureToState(raw.fixture).latestVersion;
  return {
    schemaVersion: FAKE_INSTALL_STORE_SCHEMA_VERSION,
    fixture: raw.fixture,
    readiness,
    installedVersion,
    latestVersion
  };
}

export function fakeInstallStorePath(storeDir: string): string {
  return path.join(storeDir, FAKE_INSTALL_STORE_FILENAME);
}

export function loadFakeInstallStore(storeDir: string): FakeInstallStoreFile {
  const file = fakeInstallStorePath(storeDir);
  try {
    if (!fs.existsSync(file)) return defaultFakeInstallState("NOT_INSTALLED");
    const text = fs.readFileSync(file, "utf8");
    if (text.length > 64_000) return defaultFakeInstallState("NOT_INSTALLED");
    return parseFakeInstallStore(JSON.parse(text) as unknown);
  } catch {
    return defaultFakeInstallState("NOT_INSTALLED");
  }
}

export function saveFakeInstallStore(storeDir: string, store: FakeInstallStoreFile): void {
  fs.mkdirSync(storeDir, { recursive: true });
  const file = fakeInstallStorePath(storeDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function clearFakeInstallStore(storeDir: string): void {
  const file = fakeInstallStorePath(storeDir);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}
