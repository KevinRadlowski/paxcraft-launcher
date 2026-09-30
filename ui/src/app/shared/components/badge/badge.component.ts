import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ScBadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

@Component({
  selector: 'sc-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="'badge ' + variant()" role="status">
      <ng-content />
    </span>
  `,
  styles: [
    `
      .badge {
        display: inline-flex;
        align-items: center;
        padding: var(--sc-space-1) var(--sc-space-3);
        border-radius: var(--sc-radius-full);
        font-size: var(--sc-text-xs);
        font-weight: var(--sc-weight-medium);
        letter-spacing: 0.02em;
        text-transform: uppercase;
        border: 1px solid transparent;
      }

      .neutral {
        background: var(--sc-surface-3);
        color: var(--sc-text-secondary);
        border-color: var(--sc-border-subtle);
      }

      .success {
        background: var(--sc-success-muted);
        color: var(--sc-success);
      }

      .warning {
        background: var(--sc-warning-muted);
        color: var(--sc-warning);
      }

      .danger {
        background: var(--sc-danger-muted);
        color: var(--sc-danger);
      }

      .info {
        background: var(--sc-info-muted);
        color: var(--sc-info);
      }
    `,
  ],
})
export class ScBadgeComponent {
  readonly variant = input<ScBadgeVariant>('neutral');
}
