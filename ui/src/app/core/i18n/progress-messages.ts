import { MESSAGES } from './messages';

function hasMessage(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(MESSAGES, key);
}

/** Resolve auth progress UI key — never returns an unmapped raw phase key. */
export function resolveAuthProgressMessageKey(
  messageKey?: string | null,
  phase?: string,
): string {
  if (messageKey && hasMessage(messageKey)) return messageKey;
  if (phase) {
    const derived = `auth.progress.${phase.toLowerCase()}`;
    if (hasMessage(derived)) return derived;
  }
  return 'auth.progress.generic';
}

/** Resolve play phase UI key — never returns an unmapped raw phase key. */
export function resolvePlayPhaseMessageKey(
  phaseKey?: string | null,
  playState?: string,
): string {
  if (phaseKey && hasMessage(phaseKey)) return phaseKey;
  if (playState === 'LAUNCHING' && hasMessage('play.phase.launching')) {
    return 'play.phase.launching';
  }
  if (playState === 'RUNNING' && hasMessage('play.phase.running')) {
    return 'play.phase.running';
  }
  return 'play.phase.generic';
}
