import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LAUNCHER_DESKTOP_GATEWAY } from '../../core/desktop-api/gateway';
import { AppStore } from '../../core/state/app.store';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import { HomeServerStatusService } from '../../features/home/home-server-status.service';

@Component({
  selector: 'sc-title-bar',
  standalone: true,
  imports: [ScTranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="titlebar" role="banner">
      <div class="drag">
        <p class="tagline" aria-hidden="true">{{ 'shell.tagline.en' | scTranslate }}</p>
      </div>

      <div class="meta" aria-label="Identité serveur">
        <span class="pill" [attr.data-state]="serverStatus().state">
          <span
            class="dot"
            [class.ok]="serverStatus().state === 'ONLINE'"
            [class.offline]="serverStatus().state === 'OFFLINE'"
            aria-hidden="true"
          ></span>
          <span class="addr"
            >{{ 'status.server' | scTranslate }} :
            @if (displayServerAddress(); as addr) {
              {{ addr }}
            } @else {
              {{ 'home.server.unconfigured' | scTranslate }}
            }</span
          >
          <span class="sep" aria-hidden="true">·</span>
          <span class="state">{{ stateLabelKey() | scTranslate }}</span>
          @if (latencyLabel(); as lat) {
            <span class="sep" aria-hidden="true">·</span>
            <span class="lat mono">{{ lat }}</span>
          }
        </span>
      </div>

      <div class="controls" role="toolbar" [attr.aria-label]="'titlebar.controls' | scTranslate">
        <a
          class="tool"
          routerLink="/settings"
          [attr.aria-label]="'nav.settings' | scTranslate"
          [attr.title]="'nav.settings' | scTranslate"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.49.49 0 0 0 14.9 2h-3.8a.49.49 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L3.72 8.48a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L3.84 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.39.3.59.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
            />
          </svg>
        </a>
        <button
          type="button"
          class="control"
          (click)="gateway.app.minimize()"
          [attr.aria-label]="'titlebar.minimize' | scTranslate"
        >
          ─
        </button>
        <button
          type="button"
          class="control"
          (click)="gateway.app.maximize()"
          [attr.aria-label]="'titlebar.maximize' | scTranslate"
        >
          ▢
        </button>
        <button
          type="button"
          class="control close"
          (click)="gateway.app.close()"
          [attr.aria-label]="'titlebar.close' | scTranslate"
        >
          ✕
        </button>
      </div>
    </header>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .titlebar {
        height: var(--sc-titlebar-height);
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: var(--sc-space-4);
        padding: 0 var(--sc-space-2) 0 var(--sc-space-4);
        background: rgba(16, 23, 31, 0.96);
        border-bottom: 1px solid var(--sc-border-default);
        -webkit-app-region: drag;
        user-select: none;
      }

      .drag {
        min-width: 0;
      }

      .tagline {
        font-size: 0.8rem;
        color: var(--sc-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: 0.02em;
      }

      .meta,
      .controls {
        -webkit-app-region: no-drag;
        display: flex;
        align-items: center;
        gap: var(--sc-space-2);
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.28rem 0.85rem;
        border-radius: var(--sc-radius-full);
        background: var(--sc-surface-1);
        border: 1px solid var(--sc-border-default);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        font-size: var(--sc-text-xs);
        color: var(--sc-text-primary);
        max-width: min(34rem, 48vw);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .sep {
        color: var(--sc-text-muted);
      }

      .state,
      .lat {
        color: var(--sc-text-secondary);
      }

      .dot {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 50%;
        background: var(--sc-text-muted);
        flex-shrink: 0;
      }

      .dot.ok {
        background: var(--sc-success);
        box-shadow: 0 0 8px rgba(46, 204, 113, 0.5);
      }

      .dot.offline {
        background: var(--sc-danger);
      }

      .tool {
        width: 2.25rem;
        height: var(--sc-titlebar-height);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--sc-text-secondary);
        text-decoration: none;
      }

      .tool:hover {
        color: var(--sc-text-primary);
        background: var(--sc-surface-hover);
        text-decoration: none;
      }

      .control {
        width: 2.75rem;
        height: var(--sc-titlebar-height);
        border: none;
        background: transparent;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        transition: background var(--sc-duration-fast) var(--sc-ease-out);
      }

      .control:hover {
        background: var(--sc-surface-hover);
        color: var(--sc-text-primary);
      }

      .control.close:hover {
        background: var(--sc-danger);
        color: white;
      }

      @media (max-width: 1100px) {
        .tagline {
          display: none;
        }
        /* Keep 3 columns — collapsing to 2 misplaces window controls near the sidebar. */
        .titlebar {
          grid-template-columns: minmax(1.5rem, 1fr) auto auto;
        }
      }
    `,
  ],
})
export class TitleBarComponent {
  protected readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);
  protected readonly store = inject(AppStore);
  private readonly serverSvc = inject(HomeServerStatusService);

  readonly serverStatus = this.serverSvc.status;

  readonly stateLabelKey = computed(() => {
    switch (this.serverStatus().state) {
      case 'ONLINE':
        return 'home.server.state.online';
      case 'OFFLINE':
        return 'home.server.state.offline';
      default:
        return 'home.server.state.unknown';
    }
  });

  readonly latencyLabel = computed(() => {
    const s = this.serverStatus();
    if (s.state !== 'ONLINE' || s.latencyMs == null) return null;
    return `${s.latencyMs} ms`;
  });

  displayServerAddress(): string {
    const raw = this.store.serverAddress()?.trim() ?? '';
    if (!raw || raw === 'not-configured' || /sweetcraft/i.test(raw)) {
      return '';
    }
    return raw;
  }
}
