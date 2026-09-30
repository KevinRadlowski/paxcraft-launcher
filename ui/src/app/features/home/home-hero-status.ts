import type { LauncherReadiness, PlayLifecycleState } from '@sweetcraft/ipc';
import { readinessBadgeKey, readinessBadgeVariant } from '../../shared/cta-mapping';

export type HeroStatusVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface HeroStatusPresentation {
  readonly labelKey: string;
  readonly variant: HeroStatusVariant;
}

/**
 * Hero status pill composition.
 * Install readiness remains the base; active Play overrides READY presentation only.
 * Does not change CTA mapping or install state.
 */
export function heroStatusPresentation(
  readiness: LauncherReadiness,
  playState?: PlayLifecycleState,
): HeroStatusPresentation {
  if (playState === 'LAUNCHING') {
    return { labelKey: 'home.hero.status.launching', variant: 'info' };
  }
  if (playState === 'RUNNING') {
    return { labelKey: 'home.hero.status.running', variant: 'info' };
  }
  return {
    labelKey: readinessBadgeKey(readiness),
    variant: readinessBadgeVariant(readiness),
  };
}
