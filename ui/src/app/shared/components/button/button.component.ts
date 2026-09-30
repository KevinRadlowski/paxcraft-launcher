import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ScButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ScButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'sc-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [class]="classes()"
      [type]="type()"
      [disabled]="disabled()"
      [attr.aria-disabled]="disabled()"
      (click)="onClick($event)"
    >
      <ng-content />
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--sc-space-2);
        border: 1px solid transparent;
        border-radius: var(--sc-radius-md);
        font-weight: var(--sc-weight-semibold);
        letter-spacing: 0.01em;
        transition:
          background var(--sc-duration-normal) var(--sc-ease-out),
          border-color var(--sc-duration-normal) var(--sc-ease-out),
          box-shadow var(--sc-duration-normal) var(--sc-ease-out),
          transform var(--sc-duration-fast) var(--sc-ease-out);
      }

      button:not(:disabled):active {
        transform: scale(0.98);
      }

      button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .sm {
        padding: var(--sc-space-2) var(--sc-space-3);
        font-size: var(--sc-text-sm);
      }

      .md {
        padding: var(--sc-space-3) var(--sc-space-5);
        font-size: var(--sc-text-base);
      }

      .lg {
        padding: var(--sc-space-4) var(--sc-space-8);
        font-size: var(--sc-text-lg);
        border-radius: var(--sc-radius-lg);
      }

      .primary {
        background: var(--sc-accent-gradient);
        color: var(--sc-text-primary);
        box-shadow: var(--sc-shadow-glow);
      }

      .primary:not(:disabled):hover {
        filter: brightness(1.08);
      }

      .secondary {
        background: var(--sc-surface-2);
        border-color: var(--sc-border-default);
        color: var(--sc-text-primary);
      }

      .secondary:not(:disabled):hover {
        background: var(--sc-surface-hover);
      }

      .danger {
        background: var(--sc-danger-muted);
        border-color: rgba(239, 68, 68, 0.35);
        color: #fca5a5;
      }

      .ghost {
        background: transparent;
        border-color: var(--sc-border-subtle);
        color: var(--sc-text-secondary);
      }

      .ghost:not(:disabled):hover {
        background: var(--sc-surface-1);
        color: var(--sc-text-primary);
      }
    `,
  ],
})
export class ScButtonComponent {
  readonly variant = input<ScButtonVariant>('primary');
  readonly size = input<ScButtonSize>('md');
  readonly disabled = input(false);
  readonly type = input<'button' | 'submit'>('button');
  readonly clicked = output<void>();

  classes(): string {
    return `${this.variant()} ${this.size()}`;
  }

  onClick(event: MouseEvent): void {
    if (this.disabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.clicked.emit();
  }
}
