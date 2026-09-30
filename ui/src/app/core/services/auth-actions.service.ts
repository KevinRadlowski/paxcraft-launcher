import { Injectable, inject, signal } from '@angular/core';
import { LAUNCHER_DESKTOP_GATEWAY } from '../desktop-api/gateway';
import { AppStore } from '../state/app.store';
import { NotificationsService } from './notifications.service';
import { resolveErrorMessageKey } from '../errors/error-messages';

/**
 * Renderer auth actions — presentation orchestration only.
 * Main enforces operation mutex; UI also gates double-clicks.
 */
@Injectable({ providedIn: 'root' })
export class AuthActionsService {
  private readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);
  private readonly store = inject(AppStore);
  private readonly notifications = inject(NotificationsService);
  private readonly busy = signal(false);

  readonly isBusy = this.busy.asReadonly();

  async login(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    // Clear stale terminal error before the new operation (RESTORING).
    this.store.setAuthRestoring();
    try {
      const result = await this.gateway.auth.login();
      this.store.applyAuthStateDto(result.state, result.accounts);
      if (result.state.state === 'AUTHENTICATED' && result.state.account) {
        this.notifications.show('auth.toast.connected', 'success');
      } else if (result.state.error) {
        this.notifications.show(result.state.error.messageKey, 'error');
      }
    } catch (e) {
      const code =
        typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : 'AUTH_SESSION_ERROR';
      const key =
        typeof e === 'object' && e && 'messageKey' in e
          ? String((e as { messageKey: string }).messageKey)
          : resolveErrorMessageKey(code);
      this.store.setAuthError({ code, messageKey: key });
      this.notifications.show(key, 'error');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Explicit reconnect after REAUTH_REQUIRED — same IPC as login (user-initiated).
   */
  async reconnect(): Promise<void> {
    await this.login();
  }

  /**
   * Retry after ERROR — must execute a new login with current backend fixture/scenario.
   * Must not merely restore (restore cannot seed JoueurDemo after failed login).
   */
  async retryAfterError(): Promise<void> {
    await this.login();
  }

  async restore(accountId?: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.store.setAuthRestoring();
    try {
      const result = await this.gateway.auth.restore(accountId);
      this.store.applyAuthStateDto(result.state, result.accounts);
    } catch (e) {
      const code =
        typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : 'AUTH_SESSION_ERROR';
      this.store.setAuthError({
        code,
        messageKey: resolveErrorMessageKey(code),
      });
    } finally {
      this.busy.set(false);
    }
  }

  async logout(accountId: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.gateway.auth.logout(accountId);
      this.store.applyAuthStateDto(result.state, result.accounts);
      this.notifications.show('auth.toast.signed_out', 'info');
    } catch (e) {
      const code =
        typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : 'AUTH_SESSION_ERROR';
      this.notifications.show(resolveErrorMessageKey(code), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  async select(accountId: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const selected = await this.gateway.accounts.select(accountId);
      this.store.applyAuthStateDto(selected.state, selected.accounts);
      // Selection alone never authenticates — restore validates the session.
      this.store.setAuthRestoring();
      const restored = await this.gateway.auth.restore(accountId);
      this.store.applyAuthStateDto(restored.state, restored.accounts);
    } catch (e) {
      const code =
        typeof e === 'object' && e && 'code' in e
          ? String((e as { code: string }).code)
          : 'AUTH_SESSION_ERROR';
      const key =
        typeof e === 'object' && e && 'messageKey' in e
          ? String((e as { messageKey: string }).messageKey)
          : resolveErrorMessageKey(code);
      if (code !== 'AUTH_OPERATION_BUSY') {
        this.store.setAuthError({ code, messageKey: key });
      }
      this.notifications.show(key, 'error');
    } finally {
      this.busy.set(false);
    }
  }
}
