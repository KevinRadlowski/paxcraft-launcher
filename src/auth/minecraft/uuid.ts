import { ErrorCode, LauncherError } from "../../core/errors/index.js";

const HYPHENATED =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW32 = /^[0-9a-f]{32}$/i;

/**
 * Normalize Minecraft profile id to LaunchIdentity RFC UUID (with hyphens).
 * Accepts 32-hex or already-hyphenated form. Never accepts silently malformed values.
 */
export function normalizeMinecraftUuid(id: string): string {
  if (typeof id !== "string" || !id.trim()) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_UUID, "uuid empty");
  }
  const trimmed = id.trim();
  if (HYPHENATED.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (RAW32.test(trimmed)) {
    const h = trimmed.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new LauncherError(ErrorCode.INVALID_MINECRAFT_UUID, "uuid must be 32 hex or hyphenated RFC form", {
    length: trimmed.length
  });
}
