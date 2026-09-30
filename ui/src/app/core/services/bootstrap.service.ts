import { Injectable, inject } from '@angular/core';

import { LAUNCHER_DESKTOP_GATEWAY } from '../desktop-api/gateway';

import { AppStore } from '../state/app.store';

import { runBootstrap } from '../state/bootstrap-logic';

import { InstallActionsService } from './install-actions.service';

import { PlayActionsService } from './play-actions.service';

import { shouldRefreshPlayOnAuthTransition } from './auth-play-convergence';

import { applyReducedMotionPreference } from '../state/reduced-motion';

import { resolveAuthProgressMessageKey } from '../i18n/progress-messages';



@Injectable({ providedIn: 'root' })

export class BootstrapService {

  private readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);

  private readonly store = inject(AppStore);

  private readonly installActions = inject(InstallActionsService);

  private readonly playActions = inject(PlayActionsService);



  async initialize(): Promise<void> {

    await runBootstrap(this.store, {

      kind: this.gateway.kind === 'dev' ? 'dev' : 'electron',

      getInfo: () => this.gateway.app.getInfo(),

      getStatus: () => this.gateway.install.getStatus(),

      listAccounts: () => this.gateway.accounts.list(),

      getSettings: () => this.gateway.settings.get(),

      getAuthState: () => this.gateway.auth.getState(),

      restoreAuth: () => this.gateway.auth.restore(),

    });

    applyReducedMotionPreference(this.store.effectiveSettings().reducedMotion);



    this.installActions.subscribeEvents();

    this.playActions.subscribeEvents();



    void this.playActions.refreshStatus().catch(() => undefined);



    this.gateway.events?.onAuthStateChanged((dto) => {
      const previous = this.store.effectiveAuthState();
      this.store.applyAuthStateDto(dto);
      if (shouldRefreshPlayOnAuthTransition(previous, dto.state)) {
        void this.playActions.refreshStatus().catch(() => undefined);
      }
    });

    this.gateway.events?.onAuthProgress((p) => {

      if (p.phase === 'AUTHENTICATED' || p.phase === 'FAILED') {

        this.store.setAuthProgressKey(null);

        return;

      }

      this.store.setAuthProgressKey(
        resolveAuthProgressMessageKey(p.messageKey, p.phase),
      );

    });



    // Install status can refresh independently when bootstrap status probe failed.

    if (!this.store.status()) {

      void this.installActions.refreshStatus().catch(() => undefined);

    }

  }

}


