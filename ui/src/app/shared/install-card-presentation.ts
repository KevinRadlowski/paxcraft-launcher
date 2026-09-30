import type { InstallActiveOperation, LauncherReadiness } from '@sweetcraft/ipc';

import { readinessBadgeKey } from './cta-mapping';

const MUTATION_OPS = new Set<InstallActiveOperation>([
  'INSTALLING',
  'UPDATING',
  'REPAIRING',
  'UNINSTALLING',
]);

export interface InstallCardPresentation {
  readonly headlineKey: string;
  readonly supportKey: string;
}

/** Effective install card copy while an operation is active vs underlying readiness. */
export function resolveInstallCardPresentation(
  readiness: LauncherReadiness,
  activeOperation: InstallActiveOperation,
): InstallCardPresentation {
  if (activeOperation === 'CHECKING') {
    return {
      headlineKey: 'home.card.install.headline.verifying',
      supportKey: 'home.card.install.support.verifying',
    };
  }
  if (activeOperation === 'REPAIRING') {
    return {
      headlineKey: 'home.card.install.headline.maintenance',
      supportKey: 'home.card.install.support.maintenance',
    };
  }
  if (activeOperation === 'UNINSTALLING') {
    return {
      headlineKey: 'home.card.install.headline.uninstalling',
      supportKey: 'home.card.install.support.uninstalling',
    };
  }
  if (activeOperation === 'INSTALLING' || activeOperation === 'UPDATING') {
    return {
      headlineKey: 'home.card.install.headline.busy',
      supportKey: 'home.card.install.support.busy',
    };
  }

  switch (readiness) {
    case 'READY':
      return {
        headlineKey: 'home.card.install.headline.ready',
        supportKey: 'home.card.install.support.ready',
      };
    case 'NOT_INSTALLED':
      return {
        headlineKey: 'home.card.install.headline.not_installed',
        supportKey: 'home.card.install.support.not_installed',
      };
    case 'UPDATE_AVAILABLE':
      return {
        headlineKey: 'home.card.install.headline.update',
        supportKey: readinessBadgeKey(readiness),
      };
    case 'REPAIR_REQUIRED':
      return {
        headlineKey: 'home.card.install.headline.repair',
        supportKey: readinessBadgeKey(readiness),
      };
    case 'RECOVERY_REQUIRED':
      return {
        headlineKey: 'home.card.install.headline.recovery',
        supportKey: readinessBadgeKey(readiness),
      };
    case 'BUSY':
      return {
        headlineKey: 'home.card.install.headline.busy',
        supportKey: 'home.card.install.support.busy',
      };
    case 'CHECKING':
      return {
        headlineKey: 'home.card.install.headline.verifying',
        supportKey: 'home.card.install.support.verifying',
      };
    case 'LOCATION_UNAVAILABLE':
      return {
        headlineKey: 'install.message.location_unavailable',
        supportKey: 'settings.location.unavailable',
      };
    default:
      return {
        headlineKey: readinessBadgeKey(readiness),
        supportKey: readinessBadgeKey(readiness),
      };
  }
}

/** Progress label when no DTO has arrived yet. */
export function installProgressFallbackLabelKey(
  activeOperation: InstallActiveOperation,
): string {
  if (activeOperation === 'CHECKING') return 'readiness.checking';
  if (activeOperation === 'REPAIRING') return 'install.progress.inspecting';
  if (activeOperation === 'UNINSTALLING') return 'install.progress.uninstalling';
  if (activeOperation === 'INSTALLING' || activeOperation === 'UPDATING') {
    return 'install.progress.preparing';
  }
  return 'cta.in_progress';
}

export function isInstallCardOperationActive(activeOperation: InstallActiveOperation): boolean {
  return activeOperation !== 'IDLE';
}

export function isInstallMutationOperation(activeOperation: InstallActiveOperation): boolean {
  return MUTATION_OPS.has(activeOperation);
}
