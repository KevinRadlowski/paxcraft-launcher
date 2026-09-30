import type { LauncherReadiness } from '@sweetcraft/ipc';

/** True when Home Installer must open the first-install location step. */
export function shouldOpenFirstInstallLocationModal(readiness: LauncherReadiness): boolean {
  return readiness === 'NOT_INSTALLED';
}

/** Resolved display path: explicit setting, then storage summary (includes legacy default). */
export function resolveInstallLocationDisplayPath(
  settingsPath: string | undefined,
  summaryPath: string | undefined,
): string {
  return settingsPath ?? summaryPath ?? '';
}

export function normalizeInstallLocationPath(path: string): string {
  return path.trim().replace(/\//g, '\\').toLowerCase();
}

/** Whether confirm must call setLocation before install. */
export function shouldCommitInstallLocation(persistedPath: string, candidatePath: string): boolean {
  if (!candidatePath.trim()) return false;
  if (!persistedPath.trim()) return true;
  return (
    normalizeInstallLocationPath(persistedPath) !== normalizeInstallLocationPath(candidatePath)
  );
}

export interface FirstInstallConfirmDeps {
  readonly persistedPath: string;
  readonly setLocation: (path: string) => Promise<void>;
  readonly install: () => Promise<void>;
}

export type FirstInstallConfirmOutcome =
  | { readonly outcome: 'installed'; readonly persistedPath: string; readonly locationCommitted: boolean }
  | {
      readonly outcome: 'location_error';
      readonly persistedPath: string;
      readonly errorKey: string;
    }
  | {
      readonly outcome: 'install_error';
      readonly persistedPath: string;
      readonly locationCommitted: boolean;
    };

/** Commit location (if needed) then start install — ordering enforced for tests. */
export async function confirmFirstInstallLocation(
  candidatePath: string,
  deps: FirstInstallConfirmDeps,
): Promise<FirstInstallConfirmOutcome> {
  let persisted = deps.persistedPath;
  let locationCommitted = false;
  try {
    if (shouldCommitInstallLocation(persisted, candidatePath)) {
      await deps.setLocation(candidatePath);
      locationCommitted = true;
      persisted = candidatePath;
    }
  } catch (e) {
    const errorKey =
      typeof e === 'object' && e && 'messageKey' in e
        ? String((e as { messageKey: string }).messageKey)
        : 'error.instance.location.invalid';
    return { outcome: 'location_error', persistedPath: deps.persistedPath, errorKey };
  }

  try {
    await deps.install();
    return { outcome: 'installed', persistedPath: persisted, locationCommitted };
  } catch {
    return { outcome: 'install_error', persistedPath: persisted, locationCommitted };
  }
}
