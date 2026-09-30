/**
 * Instance paths that may change size during migration copy while operations are quiescent.
 *
 * Evidence (PACK-10.1G.5.1):
 * - `logs/` is the Minecraft append-only log area (see InstancePaths layout).
 * - Launcher does not write into `logs/` outside install/update/repair (blocked during move).
 * - Human E2E failure involved `logs/latest.log` growth during migration.
 *
 * All other instance content (launcher/state.json, saves, mods, config, resourcepacks, …)
 * must remain strictly verified.
 */
export function isVolatileMigrationPath(relativePosix: string): boolean {
  const norm = relativePosix.replace(/\\/g, "/").replace(/^\/+/, "");
  return norm === "logs" || norm.startsWith("logs/");
}
