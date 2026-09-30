import { Injectable, computed, inject, signal } from '@angular/core';

import type {
  InstallActiveOperation,
  LauncherStatusDto,
  StorageSummaryDto,
  UninstallMode,
} from '@sweetcraft/ipc';

import { LAUNCHER_DESKTOP_GATEWAY } from '../desktop-api/gateway';

import { AppStore } from '../state/app.store';

import { NotificationsService } from './notifications.service';

import { PlayActionsService } from './play-actions.service';

import { ModalService } from './modal.service';

import { resolveErrorMessageKey, remapStatusNetworkMessageKey } from '../errors/error-messages';

import {
  confirmFirstInstallLocation,
  resolveInstallLocationDisplayPath,
  shouldOpenFirstInstallLocationModal,
} from '../../features/home/install-location-flow';



type MutationKind = 'install' | 'update' | 'repair' | 'uninstall';



const SUCCESS_TOAST: Record<Exclude<MutationKind, 'uninstall'>, string> = {

  install: 'install.toast.success_install',

  update: 'install.toast.success_update',

  repair: 'install.toast.success_repair',

};



const ACTIVE_OP: Record<MutationKind, InstallActiveOperation> = {

  install: 'INSTALLING',

  update: 'UPDATING',

  repair: 'REPAIRING',

  uninstall: 'UNINSTALLING',

};



/**

 * Renderer install actions — presentation orchestration only.

 * Main enforces operation mutex; UI also gates double-clicks.

 */

@Injectable({ providedIn: 'root' })

export class InstallActionsService {

  private readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);

  private readonly store = inject(AppStore);

  private readonly notifications = inject(NotificationsService);

  private readonly playActions = inject(PlayActionsService);

  private readonly modal = inject(ModalService);

  private readonly busy = signal(false);

  private readonly storageSummarySignal = signal<StorageSummaryDto | null>(null);

  private eventsBound = false;



  readonly isBusy = this.busy.asReadonly();

  readonly storageSummary = this.storageSummarySignal.asReadonly();

  readonly instanceDirectoryAvailable = computed(
    () => this.storageSummarySignal()?.instanceAvailable === true,
  );



  subscribeEvents(): void {

    if (this.eventsBound) return;

    this.eventsBound = true;



    this.gateway.events?.onInstallProgress((progress) => {

      this.store.setInstallProgress(progress);

    });

    this.gateway.events?.onLauncherStatusChanged((status) => {

      this.store.applyInstallStatus(status);

      void this.refreshPlayAfterInstallChange(status);

    });

  }



  async refreshStatus(): Promise<void> {

    if (this.busy()) return;

    this.busy.set(true);

    this.store.clearOperationError();

    this.store.beginInstallOperation('CHECKING');

    try {

      const status = await this.gateway.install.getStatus();

      this.store.applyInstallStatus(status);

      this.store.setStatusError(null);

      this.store.clearPackNetworkFooterError();

    } catch (e) {

      this.applyStatusFailure(e);

    } finally {

      this.busy.set(false);

    }

  }



  async install(): Promise<void> {

    await this.runMutation('install');

  }



  /** NOT_INSTALLED: location modal first; other readiness states delegate to install(). */
  async beginFirstInstall(): Promise<void> {
    const readiness = this.store.effectiveReadiness();
    if (!shouldOpenFirstInstallLocationModal(readiness)) {
      await this.install();
      return;
    }
    if (this.busy()) return;

    await this.refreshStorageSummary();
    const persistedPath = resolveInstallLocationDisplayPath(
      this.store.effectiveSettings().sweetcraftInstancePath,
      this.storageSummarySignal()?.instancePath,
    );
    let candidatePath = persistedPath;

    const showModal = (errorKey: string | null = null): void => {
      const config = {
        titleKey: 'install.location.title',
        bodyKey: 'install.location.body',
        cancelKey: 'install.location.cancel',
        confirmKey: 'install.location.confirm',
        confirmVariant: 'primary' as const,
        icon: 'info' as const,
        installLocation: {
          labelKey: 'install.location.path_label',
          path: candidatePath,
          hintKey: 'install.location.hint',
          modifyKey: 'install.location.modify',
          errorKey,
          onModify: async () => {
            try {
              const pick = await this.gateway.instance.chooseLocation();
              if (pick.cancelled || !pick.path) return;
              candidatePath = pick.path;
              showModal(null);
            } catch (e) {
              showModal(this.normalizeError(e).messageKey);
            }
          },
        },
        onConfirm: async () => {
          this.modal.close();
          const result = await confirmFirstInstallLocation(candidatePath, {
            persistedPath,
            setLocation: async (path) => {
              const loc = await this.gateway.instance.setLocation(path);
              const settings = this.store.effectiveSettings();
              this.store.setSettings({
                ...settings,
                sweetcraftInstancePath: loc.sweetcraftInstancePath,
              });
              await this.refreshStorageSummary();
            },
            install: () => this.runMutation('install'),
          });
          if (result.outcome === 'location_error') {
            showModal(result.errorKey);
          }
        },
      };
      if (this.modal.modal()) {
        this.modal.update(config);
      } else {
        this.modal.open(config);
      }
    };

    showModal();
  }



  async update(): Promise<void> {

    await this.runMutation('update');

  }



  async repair(): Promise<void> {

    await this.runMutation('repair');

  }



  async refreshStorageSummary(): Promise<void> {

    if (!this.gateway.storage?.getSummary) return;

    try {

      this.storageSummarySignal.set(await this.gateway.storage.getSummary());

    } catch {

      this.storageSummarySignal.set({

        instanceAvailable: false,

        logsAvailable: false,

        launcherDataAvailable: false,

      });

    }

  }



  async uninstall(mode: UninstallMode = 'SAFE'): Promise<void> {

    await this.runMutation('uninstall', mode);

  }



  async openInstanceFolder(): Promise<void> {

    try {

      const result = await this.gateway.storage.openInstance();

      if (result.unavailable || !result.opened) {

        this.notifications.show('settings.data.unavailable_toast', 'warning');

      }

    } catch {

      this.notifications.show('settings.data.unavailable_toast', 'warning');

    }

  }



  private async runMutation(kind: MutationKind, uninstallMode: UninstallMode = 'SAFE'): Promise<void> {

    if (this.busy()) return;

    this.busy.set(true);

    this.store.clearOperationError();

    if (kind === 'uninstall') {
      this.store.setUninstallMode(uninstallMode);
    }

    this.store.beginInstallOperation(ACTIVE_OP[kind]);

    try {

      let status: LauncherStatusDto;

      if (kind === 'install') status = await this.gateway.install.install();

      else if (kind === 'update') status = await this.gateway.install.update();

      else if (kind === 'repair') status = await this.gateway.install.repair();

      else status = await this.gateway.install.uninstall(uninstallMode);



      this.store.applyInstallStatus(status);

      this.store.setStatusError(null);

      await this.refreshPlayAfterInstallChange(status);

      await this.refreshStorageSummary();

      if (kind === 'uninstall') {
        this.notifications.show(
          uninstallMode === 'COMPLETE'
            ? 'install.toast.success_uninstall_complete'
            : 'install.toast.success_uninstall',
          'success',
        );
      } else {
        this.notifications.show(SUCCESS_TOAST[kind], 'success');
      }

    } catch (e) {

      const err = this.normalizeError(e);

      this.store.setOperationError(err);

      this.notifications.show(err.messageKey, 'error');

      try {

        const status = await this.gateway.install.getStatus();

        this.store.applyInstallStatus(status);

      } catch {

        // best-effort refresh after failure

      }

      await this.refreshStorageSummary();

    } finally {

      if (kind === 'uninstall') {
        this.store.setUninstallMode(null);
      }

      this.busy.set(false);

    }

  }



  /** Play eligibility only changes when install is idle and pack-ready. */
  private shouldRefreshPlayAfterInstallStatus(status: LauncherStatusDto): boolean {
    return (
      status.activeOperation === 'IDLE' &&
      (status.readiness === 'READY' || status.readiness === 'NOT_INSTALLED')
    );
  }

  /** Reconcile play eligibility after pack install/update/repair may have changed readiness. */
  private async refreshPlayAfterInstallChange(
    status?: LauncherStatusDto | Pick<LauncherStatusDto, 'readiness' | 'activeOperation'>,
  ): Promise<void> {
    const snapshot =
      status ??
      ({
        readiness: this.store.effectiveReadiness(),
        activeOperation: this.store.activeOperation(),
      } as Pick<LauncherStatusDto, 'readiness' | 'activeOperation'>);
    if (!this.shouldRefreshPlayAfterInstallStatus(snapshot as LauncherStatusDto)) return;
    await this.playActions.refreshStatus();
  }

  private applyStatusFailure(err: unknown): void {

    const normalized = this.normalizeError(err);

    const messageKey = remapStatusNetworkMessageKey(normalized.code, normalized.messageKey);

    const statusErr = { code: normalized.code, messageKey };

    this.store.setStatusError(statusErr);

    this.store.applyInstallStatus({

      readiness: 'ERROR',

      serverAddress: this.store.serverAddress(),

      messageKey,

      activeOperation: 'IDLE',

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



