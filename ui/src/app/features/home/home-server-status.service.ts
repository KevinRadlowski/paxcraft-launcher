import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import type { ServerStatusDto } from '@sweetcraft/ipc';
import { LAUNCHER_DESKTOP_GATEWAY } from '../../core/desktop-api/gateway';

const POLL_INTERVAL_MS = 45_000;

const INITIAL: ServerStatusDto = {
  state: 'UNKNOWN',
  latencyMs: null,
  playersOnline: null,
  playersMax: null,
  versionLabel: null,
  checkedAt: '',
  address: 'not-configured',
};

/**
 * Minecraft server status poller (root singleton).
 * Home and Settings acquire via start()/stop() (refCount); title-bar may read status().
 */
@Injectable({ providedIn: 'root' })
export class HomeServerStatusService implements OnDestroy {
  private readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private refreshing = false;
  private refCount = 0;

  readonly status = signal<ServerStatusDto>(INITIAL);
  readonly loading = signal(false);

  /** Acquire poller (Home enter). */
  start(): void {
    this.refCount++;
    if (this.active) return;
    this.active = true;
    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, POLL_INTERVAL_MS);
  }

  /** Release poller (Home leave). */
  stop(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ngOnDestroy(): void {
    this.refCount = 0;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refresh(): Promise<void> {
    if (!this.active || this.refreshing) return;
    this.refreshing = true;
    this.loading.set(true);
    try {
      const dto = await this.gateway.server.getStatus();
      if (this.active) this.status.set(dto);
    } catch {
      if (this.active) {
        this.status.set({
          ...INITIAL,
          state: 'UNKNOWN',
          checkedAt: new Date().toISOString(),
        });
      }
    } finally {
      this.refreshing = false;
      this.loading.set(false);
    }
  }
}
