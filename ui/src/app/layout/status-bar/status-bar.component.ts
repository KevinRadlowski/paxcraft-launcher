import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppStore } from '../../core/state/app.store';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import { ScProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';

@Component({
  selector: 'sc-status-bar',
  standalone: true,
  imports: [ScTranslatePipe, ScProgressBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="statusbar" role="contentinfo">
      <div class="left">
        @if (store.loading()) {
          <span>{{ 'status.initializing' | scTranslate }}</span>
          <sc-progress-bar [value]="40" label="Chargement" />
        } @else {
          @if (store.error(); as errKey) {
            <span class="dot danger" aria-hidden="true"></span>
            <span class="error">{{ errKey | scTranslate }}</span>
          } @else {
            <span class="dot ok" aria-hidden="true"></span>
            <span class="ok">{{ 'status.ready' | scTranslate }}</span>
          }
        }
      </div>

      <div class="center muted">
        @if (store.info(); as info) {
          <span>{{ info.name }} v{{ info.version }} · {{ 'shell.brand.line' | scTranslate }}</span>
        }
      </div>

      <div class="right" aria-hidden="true"></div>
    </footer>
  `,
  styles: [
    `
      .statusbar {
        height: var(--sc-statusbar-height);
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        padding: 0 var(--sc-space-5);
        background: var(--sc-bg-sidebar);
        border-top: 1px solid var(--sc-border-default);
        font-size: var(--sc-text-xs);
        color: var(--sc-text-secondary);
        gap: var(--sc-space-4);
      }

      .left,
      .right,
      .center {
        display: flex;
        align-items: center;
        gap: var(--sc-space-2);
        min-width: 0;
      }

      .left {
        justify-content: flex-start;
      }

      .center {
        justify-content: center;
        text-align: center;
      }

      .right {
        justify-content: flex-end;
      }

      .left sc-progress-bar {
        width: 5rem;
      }

      .dot {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .dot.ok {
        background: var(--sc-success);
      }

      .dot.danger {
        background: var(--sc-danger);
      }

      .ok {
        color: var(--sc-success);
      }

      .error {
        color: var(--sc-text-danger);
      }

      .muted {
        color: var(--sc-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .slogan {
        font-style: normal;
        color: var(--sc-text-muted);
        white-space: nowrap;
      }

      @media (max-width: 1100px) {
        .center,
        .slogan {
          display: none;
        }
        .statusbar {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class StatusBarComponent {
  protected readonly store = inject(AppStore);
}
