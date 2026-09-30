/**
 * Pure extract of gateway resolution for node:test (no Angular DI).
 */
import type { LauncherDesktopGateway } from "./gateway.js";
import { DevLauncherDesktopGateway } from "./dev.gateway.js";
import { ElectronLauncherDesktopGateway } from "./electron.gateway.js";
import { DesktopBridgeUnavailableGateway } from "./unavailable.gateway.js";

export function resolveGateway(opts: {
  forceDev?: boolean;
  hasPreload: boolean;
  production: boolean;
}): LauncherDesktopGateway {
  const { production, hasPreload, forceDev } = opts;
  if (production) {
    if (!hasPreload) return new DesktopBridgeUnavailableGateway();
    return new ElectronLauncherDesktopGateway();
  }
  if (forceDev || !hasPreload) return new DevLauncherDesktopGateway();
  return new ElectronLauncherDesktopGateway();
}
