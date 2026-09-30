import { Injectable, effect, inject, signal } from '@angular/core';

import { AppStore } from '../state/app.store';
import {
  createInstallElapsedTickerController,
  isInstallOperationActive,
} from '../../shared/install-elapsed-display';

/**
 * 1 Hz renderer tick while an install/check mutation is active.
 * Drives elapsed display between sparse backend progress events.
 */
@Injectable({ providedIn: 'root' })
export class InstallElapsedTickerService {
  private readonly store = inject(AppStore);
  private readonly controller = createInstallElapsedTickerController({
    isActive: () => isInstallOperationActive(this.store.effectiveActiveOperation()),
    onTick: () => this.tick.update((n) => n + 1),
  });

  /** Incremented each second during active operations — subscribe in progress computeds. */
  readonly tick = signal(0);

  constructor() {
    effect(() => {
      this.store.effectiveActiveOperation();
      this.controller.sync();
    });
  }

  disposeForTests(): void {
    this.controller.dispose();
  }
}
