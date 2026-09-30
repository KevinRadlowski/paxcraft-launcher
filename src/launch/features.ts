/**
 * Features used by Minecraft argument rules.
 * Only explicitly configured features are true; defaults are all false.
 */
export interface LaunchFeatures {
  has_custom_resolution: boolean;
  is_demo_user: boolean;
  has_quick_plays_support: boolean;
  is_quick_play_singleplayer: boolean;
  is_quick_play_multiplayer: boolean;
  is_quick_play_realms: boolean;
}

export const DEFAULT_LAUNCH_FEATURES: Readonly<LaunchFeatures> = Object.freeze({
  has_custom_resolution: false,
  is_demo_user: false,
  has_quick_plays_support: false,
  is_quick_play_singleplayer: false,
  is_quick_play_multiplayer: false,
  is_quick_play_realms: false
});

export function mergeLaunchFeatures(partial?: Partial<LaunchFeatures>): LaunchFeatures {
  return { ...DEFAULT_LAUNCH_FEATURES, ...partial };
}

export function featuresAsRuleMap(features: LaunchFeatures): Record<string, boolean> {
  return { ...features };
}
