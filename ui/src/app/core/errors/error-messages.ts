/** Maps backend / IPC error codes to French i18n message keys. */
export const ERROR_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  NETWORK_ERROR: 'error.network',
  HTTP_ERROR: 'error.network',
  HTTP_TIMEOUT: 'error.network',
  INTERNAL_ERROR: 'error.internal',
  BOOTSTRAP_FAILED: 'error.bootstrap_failed',
  DESKTOP_BRIDGE_UNAVAILABLE: 'error.desktop_bridge_unavailable',
  IPC_UNTRUSTED_SENDER: 'error.ipc_untrusted_sender',
  IPC_INVALID_PAYLOAD: 'error.ipc_invalid',
  IPC_INVALID_RESPONSE: 'error.ipc_invalid',

  PLAY_INSTALL_REQUIRED: 'error.play_install_required',
  PLAY_UPDATE_REQUIRED: 'error.play_update_required',
  PLAY_REPAIR_REQUIRED: 'error.play_repair_required',

  INSTANCE_BUSY: 'error.instance_busy',
  INSTANCE_RECOVERY_REQUIRED: 'error.instance_recovery',
  INSTANCE_STATE_INVALID: 'error.instance_recovery',

  AUTH_LOGIN_REQUIRED: 'error.auth_login_required',
  AUTH_REAUTH_REQUIRED: 'error.auth_reauth_required',
  AUTH_ACCOUNT_REQUIRED: 'error.auth_account_required',
  AUTH_ACCOUNT_NOT_FOUND: 'error.auth_account_required',
  AUTH_ACCOUNT_MISMATCH: 'error.auth_account_mismatch',
  AUTH_SESSION_ERROR: 'error.auth_error',
  AUTH_REQUIRED: 'error.auth_required',
  AUTH_REQUEST_ABORTED: 'error.auth_aborted',
  AUTH_OPERATION_BUSY: 'error.auth_operation_busy',
  AUTH_ACCOUNT_METADATA_WARNING: 'error.auth_account_metadata_warning',
  AUTH_HTTP_TIMEOUT: 'error.network',
  AUTH_HTTP_ERROR: 'error.network',
  AUTH_STORE_ERROR: 'error.auth_error',
  AUTH_SECURE_STORAGE_UNAVAILABLE: 'error.auth_error',
  LIVE_AUTH_NOT_ENABLED: 'error.auth_live_disabled',
  MICROSOFT_CLIENT_ID_MISSING: 'error.auth_error',

  MINECRAFT_APP_NOT_AUTHORIZED: 'error.minecraft_app_not_authorized',
  MINECRAFT_NOT_OWNED: 'error.minecraft_not_owned',
  MINECRAFT_ACCOUNT_SUSPENDED: 'error.minecraft_account_suspended',
  INVALID_MINECRAFT_AUTH: 'error.auth_error',

  GAME_ALREADY_RUNNING: 'error.game_already_running',
  GAME_PROCESS_LOCK_INVALID: 'error.game_lock_invalid',
  GAME_PROCESS_LOCKED: 'error.game_already_running',
  GAME_PROCESS_SPAWN_FAILED: 'error.game_spawn_failed',

  RECOVERY_REQUIRED: 'error.install.recovery',
  INTEGRITY_ERROR: 'error.install.integrity',
  TRUST_ERROR: 'error.install.trust',
  FILESYSTEM_ERROR: 'error.install.filesystem',
  STATE_CORRUPT: 'error.install.state_corrupt',
  INSTANCE_NOT_INSTALLED: 'error.install.not_installed',
  INSTANCE_ALREADY_INSTALLED: 'error.install.already_installed',
  UNINSTALL_FAILED: 'error.install.uninstall_failed',
  INSTALL_STATUS_ERROR: 'error.install.status_check',
  SETTINGS_INVALID: 'error.settings.invalid',
  INSTANCE_LOCATION_NOT_EMPTY: 'error.instance.location.not_empty',
  INSTANCE_OWNERSHIP_NOT_PROVEN: 'error.instance.location.ownership_not_proven',
  INSTANCE_LOCATION_INVALID: 'error.instance.location.invalid',
  INSTANCE_MOVE_FAILED: 'error.instance.location.move_failed',
  INSTANCE_MOVE_PRESERVED: 'error.instance.location.move_preserved',
  INSTANCE_MOVE_VERIFY_FAILED: 'error.instance.location.move_verify_failed',
  INSTANCE_MOVE_COPY_FAILED: 'error.instance.location.move_copy_failed',
  INSTANCE_LOCATION_UNAVAILABLE: 'error.instance.location.unavailable',
};

export function resolveErrorMessageKey(code: string): string {
  return ERROR_MESSAGE_KEYS[code] ?? 'error.generic';
}

/**
 * Remap network failures on pack status-check path only (not install/update/repair mutations).
 * Used solely by InstallActionsService.applyStatusFailure — does not change global NETWORK_ERROR mapping.
 */
export function remapStatusNetworkMessageKey(code: string, messageKey: string): string {
  if (
    code === 'NETWORK_ERROR' ||
    code === 'HTTP_ERROR' ||
    code === 'HTTP_TIMEOUT' ||
    messageKey === 'error.install.network' ||
    messageKey === 'error.network'
  ) {
    return 'error.install.status_network';
  }
  return messageKey;
}
