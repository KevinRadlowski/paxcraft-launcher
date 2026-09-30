import { Injectable, inject, signal } from '@angular/core';
import type { SettingsDto, SettingsUpdateDto } from '@sweetcraft/ipc';
import { LAUNCHER_DESKTOP_GATEWAY } from '../desktop-api/gateway';
import { AppStore } from '../state/app.store';
import { NotificationsService } from './notifications.service';
import { resolveErrorMessageKey } from '../errors/error-messages';
import { applyReducedMotionPreference } from '../state/reduced-motion';

@Injectable({ providedIn: 'root' })
export class SettingsActionsService {
  private readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);
  private readonly store = inject(AppStore);
  private readonly notifications = inject(NotificationsService);
  private readonly busy = signal(false);

  readonly isBusy = this.busy.asReadonly();

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const settings = await this.gateway.settings.get();
      this.store.setSettings(settings);
      applyReducedMotionPreference(settings.reducedMotion);
    } catch {
      // keep last known settings
    } finally {
      this.busy.set(false);
    }
  }

  async update(patch: SettingsUpdateDto): Promise<SettingsDto | null> {
    if (this.busy()) return null;
    this.busy.set(true);
    try {
      const settings = await this.gateway.settings.update(patch);
      this.store.setSettings(settings);
      applyReducedMotionPreference(settings.reducedMotion);
      this.notifications.show('settings.toast.saved', 'success');
      return settings;
    } catch (e) {
      const messageKey =
        typeof e === 'object' && e && 'messageKey' in e
          ? String((e as { messageKey: string }).messageKey)
          : resolveErrorMessageKey(
              typeof e === 'object' && e && 'code' in e
                ? String((e as { code: string }).code)
                : 'SETTINGS_INVALID',
            );
      this.notifications.show(messageKey, 'error');
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
