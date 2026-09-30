import { Injectable, inject, signal } from '@angular/core';
import type { PlayStatusDto } from '@sweetcraft/ipc';
import { LAUNCHER_DESKTOP_GATEWAY } from '../desktop-api/gateway';
import { AppStore } from '../state/app.store';
import { NotificationsService } from './notifications.service';
import { resolveErrorMessageKey } from '../errors/error-messages';

/**
 * Renderer play actions — presentation orchestration only.
 * Main enforces play mutex; UI also gates double-clicks.
 */
@Injectable({ providedIn: 'root' })
export class PlayActionsService {
  private readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);
  private readonly store = inject(AppStore);
  private readonly notifications = inject(NotificationsService);
  private readonly busy = signal(false);
  private eventsBound = false;

  readonly isBusy = this.busy.asReadonly();

  subscribeEvents(): void {
    if (this.eventsBound) return;
    this.eventsBound = true;

    this.gateway.events?.onPlayStatusChanged((status) => {
      this.store.applyPlayStatus(status);
    });
  }

  async refreshStatus(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const status = await this.gateway.play.getStatus();
      this.store.applyPlayStatus(status);
    } catch (e) {
      this.applyStatusFailure(e);
    } finally {
      this.busy.set(false);
    }
  }

  async start(): Promise<void> {
    if (this.busy() || this.store.isPlayBusy()) return;
    this.busy.set(true);
    this.store.clearPlayError();
    try {
      const status = await this.gateway.play.start();
      this.store.applyPlayStatus(status);
    } catch (e) {
      const err = this.normalizeError(e);
      this.store.setPlayError(err);
      this.notifications.show(err.messageKey, 'error');
      try {
        const status = await this.gateway.play.getStatus();
        this.store.applyPlayStatus(status);
      } catch {
        // best-effort refresh after failure
      }
    } finally {
      this.busy.set(false);
    }
  }

  private applyStatusFailure(err: unknown): void {
    const normalized = this.normalizeError(err);
    this.store.setPlayError(normalized);
    this.store.applyPlayStatus({
      state: 'ERROR',
      messageKey: normalized.messageKey,
      error: normalized,
    });
  }

  private normalizeError(err: unknown): { code: string; messageKey: string } {
    const code =
      typeof err === 'object' && err && 'code' in err
        ? String((err as { code: string }).code)
        : 'INTERNAL_ERROR';
    const messageKey =
      typeof err === 'object' && err && 'messageKey' in err
        ? String((err as { messageKey: string }).messageKey)
        : resolveErrorMessageKey(code);
    return { code, messageKey };
  }
}
