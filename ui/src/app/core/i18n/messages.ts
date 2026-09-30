import fr from '../../../assets/i18n/fr.json';

export type MessageKey = keyof typeof fr;

const MESSAGES: Record<string, string> = fr;

function resolveMessageText(key: string): string {
  if (MESSAGES[key] !== undefined) return MESSAGES[key];
  if (key.startsWith('auth.progress.')) {
    return MESSAGES['auth.progress.generic'] ?? key;
  }
  if (key.startsWith('play.phase.')) {
    return MESSAGES['play.phase.generic'] ?? key;
  }
  return key;
}

export function translate(key: string, params?: Record<string, string | number>): string {
  let text = resolveMessageText(key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return text;
}

export { MESSAGES };
