/**
 * Safe support diagnostics — never includes tokens, paths, env, command lines.
 */

import type {
  AppInfoDto,
  AuthStateDto,
  LauncherStatusDto,
  PlayStatusDto,
  SafeDiagnosticsDto,
  SettingsDto
} from "../../shared/contract.js";
import { DESKTOP_PRODUCT_NAME, DESKTOP_PRODUCT_VERSION } from "../../shared/product.js";

export type { SafeDiagnosticsDto };

export interface BuildSafeDiagnosticsInput {
  readonly info: AppInfoDto | null;
  readonly status: LauncherStatusDto | null;
  readonly auth: AuthStateDto | null;
  readonly play: PlayStatusDto | null;
  readonly settings: SettingsDto | null;
  readonly supportId: string;
  readonly platform?: string;
  readonly architecture?: string;
  readonly lastAuthErrorCode?: string | null;
  readonly lastInstallErrorCode?: string | null;
  readonly lastPlayErrorCode?: string | null;
  readonly packaged?: boolean;
  readonly trustedKeysSource?: "resources" | "app" | "missing";
  readonly trustedKeysPresent?: boolean;
  readonly rendererPresent?: boolean;
  readonly coreDistPresent?: boolean;
  readonly preloadPresent?: boolean;
  readonly liveAuthAllowed?: boolean;
  readonly clientIdSource?: "product_default" | "env_override";
  readonly criticalInitErrorCode?: string | null;
  readonly productUserDataRoot?: string | null;
  readonly launcherDataRoot?: string | null;
  readonly defaultInstanceRoot?: string | null;
  readonly defaultRuntimeRoot?: string | null;
  readonly dataRootSource?: "explicit" | "env" | "canonical" | "legacy-fallback" | null;
  readonly javaSource?: "managed" | "JAVA_HOME" | "PATH" | "known_path" | "none" | null;
  readonly javaRequiredMajor?: number | null;
  readonly javaSelectedMajor?: number | null;
  readonly javaProvider?: string | null;
  readonly javaManagedIdentity?: string | null;
  readonly javaManagedRuntimeRoot?: string | null;
  readonly javaProvisioningState?: "idle" | "ready" | "missing" | null;
}

const SENSITIVE_SUBSTRINGS = [
  "accessToken",
  "refreshToken",
  "authorizationCode",
  "codeVerifier",
  "xsts",
  "xboxToken",
  "clientSecret",
  "PKCE",
  "argfile"
] as const;

export function buildSafeDiagnostics(input: BuildSafeDiagnosticsInput): SafeDiagnosticsDto {
  const info = input.info;
  const status = input.status;
  const auth = input.auth;
  const play = input.play;
  const settings = input.settings;

  const authState = auth?.state ?? "UNKNOWN";
  const playState = play?.state ?? "UNKNOWN";
  const accountName = auth?.account?.minecraftUsername;
  const username =
    typeof accountName === "string" && accountName.trim()
      ? accountName.trim().slice(0, 64)
      : typeof play?.minecraftUsername === "string" && play.minecraftUsername.trim()
        ? play.minecraftUsername.trim().slice(0, 64)
        : null;

  const buildId = optionalBuildId(info?.buildId);
  const buildCommit = optionalBuildCommit(info?.buildCommit);

  const dto: SafeDiagnosticsDto = {
    productName: info?.name ?? DESKTOP_PRODUCT_NAME,
    launcherVersion: info?.version ?? DESKTOP_PRODUCT_VERSION,
    ...(buildId ? { buildId } : {}),
    ...(buildCommit ? { buildCommit } : {}),
    environment: info?.environment === "development" ? "development" : "production",
    platform: sanitizeLabel(input.platform ?? info?.platform ?? "unknown", 64),
    architecture: sanitizeLabel(input.architecture ?? process.arch ?? "unknown", 32),
    installReadiness: sanitizeLabel(status?.readiness ?? "UNKNOWN", 64),
    installedPackVersion: optionalVersion(status?.installedVersion ?? status?.packVersion),
    availablePackVersion: optionalVersion(status?.latestVersion),
    minecraftVersion: optionalVersion(status?.minecraftVersion),
    fabricVersion: optionalVersion(status?.fabricVersion),
    channel: optionalVersion(status?.channel),
    authState: sanitizeLabel(authState, 64),
    minecraftUsername: username,
    playState: sanitizeLabel(playState, 64),
    gameRunning: playState === "RUNNING" || playState === "LAUNCHING",
    activeInstallOperation: status?.activeOperation
      ? sanitizeLabel(status.activeOperation, 64)
      : null,
    memoryMiB:
      typeof settings?.memoryMiB === "number" && Number.isInteger(settings.memoryMiB)
        ? settings.memoryMiB
        : null,
    lastAuthErrorCode: optionalCode(input.lastAuthErrorCode ?? auth?.error?.code),
    lastInstallErrorCode: optionalCode(input.lastInstallErrorCode ?? status?.messageKey),
    lastPlayErrorCode: optionalCode(input.lastPlayErrorCode ?? play?.error?.code),
    appIdBlocked: auth?.error?.code === "MINECRAFT_APP_NOT_AUTHORIZED",
    fakeAuthHarness: info?.features?.fakeAuthHarness === true,
    fakeInstallHarness: info?.features?.fakeInstallHarness === true,
    fakePlayHarness: info?.features?.fakePlayHarness === true,
    supportId: sanitizeSupportId(input.supportId),
    ...(typeof settings?.instanceLocationConfigured === "boolean"
      ? { instanceLocationConfigured: settings.instanceLocationConfigured }
      : {}),
    ...(input.packaged !== undefined ? { packaged: input.packaged } : {}),
    ...(input.trustedKeysSource ? { trustedKeysSource: input.trustedKeysSource } : {}),
    ...(input.trustedKeysPresent !== undefined
      ? { trustedKeysPresent: input.trustedKeysPresent }
      : {}),
    ...(input.rendererPresent !== undefined ? { rendererPresent: input.rendererPresent } : {}),
    ...(input.coreDistPresent !== undefined ? { coreDistPresent: input.coreDistPresent } : {}),
    ...(input.preloadPresent !== undefined ? { preloadPresent: input.preloadPresent } : {}),
    ...(input.liveAuthAllowed !== undefined ? { liveAuthAllowed: input.liveAuthAllowed } : {}),
    ...(input.clientIdSource ? { clientIdSource: input.clientIdSource } : {}),
    ...(input.criticalInitErrorCode !== undefined
      ? { criticalInitErrorCode: input.criticalInitErrorCode }
      : {}),
    ...(input.productUserDataRoot !== undefined
      ? { productUserDataRoot: input.productUserDataRoot }
      : {}),
    ...(input.launcherDataRoot !== undefined ? { launcherDataRoot: input.launcherDataRoot } : {}),
    ...(input.defaultInstanceRoot !== undefined
      ? { defaultInstanceRoot: input.defaultInstanceRoot }
      : {}),
    ...(input.defaultRuntimeRoot !== undefined
      ? { defaultRuntimeRoot: input.defaultRuntimeRoot }
      : {}),
    ...(input.dataRootSource !== undefined ? { dataRootSource: input.dataRootSource } : {}),
    ...(input.javaSource !== undefined ? { javaSource: input.javaSource } : {}),
    ...(input.javaRequiredMajor !== undefined ? { javaRequiredMajor: input.javaRequiredMajor } : {}),
    ...(input.javaSelectedMajor !== undefined ? { javaSelectedMajor: input.javaSelectedMajor } : {}),
    ...(input.javaProvider !== undefined ? { javaProvider: input.javaProvider } : {}),
    ...(input.javaManagedIdentity !== undefined
      ? { javaManagedIdentity: input.javaManagedIdentity }
      : {}),
    ...(input.javaManagedRuntimeRoot !== undefined
      ? { javaManagedRuntimeRoot: input.javaManagedRuntimeRoot }
      : {}),
    ...(input.javaProvisioningState !== undefined
      ? { javaProvisioningState: input.javaProvisioningState }
      : {})
  };

  assertNoSensitiveLeak(dto);
  return dto;
}

/** Human-readable clipboard text for support — no secrets, no absolute paths. */
export function formatDiagnosticsClipboardText(dto: SafeDiagnosticsDto): string {
  const lines = [
    `${dto.productName} ${dto.launcherVersion}`,
    `Build ID: ${dto.buildId ?? "unavailable"}`,
    `Build commit: ${dto.buildCommit ?? "unavailable"}`,
    `OS: ${dto.platform} ${dto.architecture}`,
    `Environment: ${dto.environment}`,
    `Install: ${dto.installReadiness}`,
    `Pack installed: ${dto.installedPackVersion ?? "none"}`,
    `Pack available: ${dto.availablePackVersion ?? "unknown"}`,
    `Minecraft: ${dto.minecraftVersion ?? "unknown"}`,
    `Fabric: ${dto.fabricVersion ?? "unknown"}`,
    `Channel: ${dto.channel ?? "unknown"}`,
    `Auth: ${dto.authState}`,
    `Minecraft user: ${dto.minecraftUsername ?? "none"}`,
    `Play: ${dto.playState}`,
    `Game running: ${dto.gameRunning ? "yes" : "no"}`,
    `Install operation: ${dto.activeInstallOperation ?? "IDLE"}`,
    `Memory: ${dto.memoryMiB != null ? `${dto.memoryMiB} MiB` : "unknown"}`,
    `AppID blocked: ${dto.appIdBlocked ? "yes" : "no"}`,
    `Last auth error: ${dto.lastAuthErrorCode ?? "none"}`,
    `Last install error: ${dto.lastInstallErrorCode ?? "none"}`,
    `Last play error: ${dto.lastPlayErrorCode ?? "none"}`,
    `Support ID: ${dto.supportId}`
  ];

  if (typeof dto.instanceLocationConfigured === "boolean") {
    lines.push(
      `Instance location: ${dto.instanceLocationConfigured ? "custom" : "default"}`
    );
  }

  if (dto.packaged !== undefined) {
    lines.push(`Packaged: ${dto.packaged ? "yes" : "no"}`);
  }
  if (dto.trustedKeysSource) {
    lines.push(`Trusted keys source: ${dto.trustedKeysSource}`);
  }
  if (dto.trustedKeysPresent !== undefined) {
    lines.push(`Trusted keys present: ${dto.trustedKeysPresent ? "yes" : "no"}`);
  }
  if (dto.liveAuthAllowed !== undefined) {
    lines.push(`Live auth allowed: ${dto.liveAuthAllowed ? "yes" : "no"}`);
  }
  if (dto.clientIdSource) {
    lines.push(`Client id source: ${dto.clientIdSource}`);
  }
  if (dto.criticalInitErrorCode) {
    lines.push(`Critical init error: ${dto.criticalInitErrorCode}`);
  }
  if (dto.dataRootSource) {
    lines.push(`Data root source: ${dto.dataRootSource}`);
  }
  if (dto.launcherDataRoot) {
    lines.push(`Launcher data root: ${dto.launcherDataRoot}`);
  }
  if (dto.defaultInstanceRoot) {
    lines.push(`Default instance: ${dto.defaultInstanceRoot}`);
  }
  if (dto.defaultRuntimeRoot) {
    lines.push(`Default runtime: ${dto.defaultRuntimeRoot}`);
  }

  if (dto.environment === "development") {
    lines.push(
      `Fake auth harness: ${dto.fakeAuthHarness ? "active" : "off"}`,
      `Fake install harness: ${dto.fakeInstallHarness ? "active" : "off"}`,
      `Fake play harness: ${dto.fakePlayHarness ? "active" : "off"}`
    );
  }

  const text = `${lines.join("\n")}\n`;
  assertNoSensitiveLeak(text);
  return text;
}

export function createEphemeralSupportId(): string {
  // Random UUID v4-ish without Node crypto dependency on randomUUID availability quirks.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sanitizeLabel(v: string, max: number): string {
  return v.replace(/[\r\n\t]/g, " ").trim().slice(0, max) || "unknown";
}

function sanitizeSupportId(v: string): string {
  const t = v.trim().slice(0, 64);
  if (/^[0-9a-fA-F-]{8,64}$/.test(t)) return t;
  return createEphemeralSupportId();
}

function optionalVersion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 64);
  if (!t || t.includes("\\") || t.includes("/") || t.includes(":")) return null;
  return t;
}

/** SemVer@shortCommit[+dirty] from AppInfo — reject path-like values. */
function optionalBuildId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 96);
  if (!t || t.includes("\\") || t.includes("/") || t.includes(":")) return null;
  return t;
}

/** Full git SHA — hex only, optional dirty suffix already handled upstream. */
function optionalBuildCommit(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 64);
  if (!t || t.includes("\\") || t.includes("/") || t.includes(":")) return null;
  if (!/^[0-9a-fA-F]{7,40}$/.test(t)) return null;
  return t;
}

function optionalCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 128);
  if (!t) return null;
  // messageKey-like values are OK; reject path-looking strings.
  if (t.includes("\\") || /^[A-Za-z]:/.test(t) || t.includes("/Users/") || t.includes("APPDATA")) {
    return null;
  }
  return t;
}

export function assertNoSensitiveLeak(value: unknown): void {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  for (const needle of SENSITIVE_SUBSTRINGS) {
    if (json.includes(needle)) {
      throw new Error(`diagnostics_sensitive_leak:${needle}`);
    }
  }
}

/** Keys that must never appear on SafeDiagnosticsDto / clipboard builders. */
export const DIAGNOSTICS_FORBIDDEN_KEYS = [
  "accessToken",
  "refreshToken",
  "authorizationCode",
  "codeVerifier",
  "xstsToken",
  "xboxToken",
  "clientSecret",
  "commandLine",
  "argv",
  "argfile",
  "env",
  "environmentVariables",
  "stack",
  "stackTrace",
  "userDataPath",
  "instancePath",
  "homeDir"
] as const;
