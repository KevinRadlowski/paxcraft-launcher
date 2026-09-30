/** Applies Main-persisted reducedMotion to document root (runtime, no restart). */
export function applyReducedMotionPreference(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('sc-reduced-motion', enabled === true);
  document.documentElement.dataset['scReducedMotion'] = enabled ? '1' : '0';
}
