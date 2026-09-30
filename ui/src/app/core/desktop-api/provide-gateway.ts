import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  LAUNCHER_DESKTOP_GATEWAY,
  LauncherDesktopGateway,
} from './gateway';
import { DevLauncherDesktopGateway } from './dev.gateway';
import { resolveGateway as resolveGatewayPure } from './gateway-resolve';
import { DESKTOP_RENDERER_PRODUCTION } from '../../../environments/environment';

/**
 * Production Electron builds must never silently fall back to the demo gateway.
 * Development browser preview (no preload) may use DevLauncherDesktopGateway.
 *
 * Force-dev query/localStorage is intentionally unsupported.
 * Production is build-gated via environment.prod.ts fileReplacement.
 */
export function isProductionRendererBuild(): boolean {
  if (DESKTOP_RENDERER_PRODUCTION) return true;
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (env?.['NG_APP_DESKTOP_ENV'] === 'production') return true;
  if (env?.['NG_APP_PRODUCTION'] === 'true') return true;
  return (globalThis as { ngDevMode?: boolean }).ngDevMode === false;
}

export function resolveGateway(opts?: {
  forceDev?: boolean;
  hasPreload?: boolean;
  production?: boolean;
}): LauncherDesktopGateway {
  const production = opts?.production ?? isProductionRendererBuild();
  const hasPreload =
    opts?.hasPreload ??
    (typeof window !== 'undefined' && typeof window.sweetcraft !== 'undefined');
  const forceDev = opts?.forceDev === true;
  return resolveGatewayPure({ production, hasPreload, forceDev });
}

export function provideLauncherDesktopGateway(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: LAUNCHER_DESKTOP_GATEWAY,
      useFactory: () => resolveGateway(),
    },
  ]);
}

export function getDevGatewayInstance(
  gateway: LauncherDesktopGateway,
): DevLauncherDesktopGateway | null {
  return gateway.kind === 'dev' ? (gateway as DevLauncherDesktopGateway) : null;
}
