import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationsService } from '../../../core/services/notifications.service';
import { ScTranslatePipe } from '../../../core/i18n/translate.pipe';

@Component({
  selector: 'sc-toast-container',
  standalone: true,
  imports: [ScTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (notifications.toasts().length > 0) {
      <div class="container" aria-live="polite" aria-atomic="false">
        @for (toast of notifications.toasts(); track toast.id) {
          <div
            [class]="'toast ' + toast.variant"
            [attr.role]="toast.variant === 'danger' ? 'alert' : 'status'"
          >
            <span>{{ toast.messageKey | scTranslate: toast.params }}</span>
            <button
              type="button"
              class="close"
              [attr.aria-label]="'toast.close' | scTranslate"
              (click)="notifications.dismiss(toast.id)"
            >
              ×
            </button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .container {
        position: fixed;
        bottom: calc(var(--sc-statusbar-height) + var(--sc-space-4));
        right: var(--sc-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-3);
        z-index: 1000;
        max-width: 22rem;
      }

      .toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sc-space-3);
        padding: var(--sc-space-3) var(--sc-space-4);
        border-radius: var(--sc-radius-lg);
        border: 1px solid var(--sc-border-default);
        background: var(--sc-bg-overlay);
        backdrop-filter: blur(12px);
        box-shadow: var(--sc-shadow-lg);
        font-size: var(--sc-text-sm);
      }

      .close {
        flex-shrink: 0;
        width: 1.75rem;
        height: 1.75rem;
        border: none;
        border-radius: var(--sc-radius-md);
        background: transparent;
        color: var(--sc-text-secondary);
        font-size: 1.25rem;
        line-height: 1;
        cursor: pointer;
      }

      .close:hover {
        color: var(--sc-text-primary);
        background: rgba(255, 255, 255, 0.06);
      }

      .close:focus-visible {
        outline: 2px solid var(--sc-accent, #a855f7);
        outline-offset: 2px;
      }

      .info {
        border-color: rgba(56, 189, 248, 0.3);
      }

      .success {
        border-color: rgba(34, 197, 94, 0.3);
      }

      .warning {
        border-color: rgba(245, 158, 11, 0.3);
      }

      .danger {
        border-color: rgba(239, 68, 68, 0.3);
      }
    `,
  ],
})
export class ScToastContainerComponent {
  protected readonly notifications = inject(NotificationsService);
}
