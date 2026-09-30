import type { UiError as SharedUiError } from '@sweetcraft/ipc';

export type UiError = SharedUiError;

export function createUiError(
  code: string,
  messageKey: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): UiError {
  return { code, messageKey, details };
}

export function isUiError(value: unknown): value is UiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'messageKey' in value &&
    typeof (value as UiError).code === 'string' &&
    typeof (value as UiError).messageKey === 'string'
  );
}
