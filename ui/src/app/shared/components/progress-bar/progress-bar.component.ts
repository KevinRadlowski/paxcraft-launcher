import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'sc-progress-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="track"
      role="progressbar"
      [class.indeterminate]="indeterminate()"
      [attr.aria-valuemin]="indeterminate() ? null : 0"
      [attr.aria-valuemax]="indeterminate() ? null : 100"
      [attr.aria-valuenow]="indeterminate() ? null : value()"
      [attr.aria-busy]="indeterminate() ? true : null"
      [attr.aria-label]="label()"
    >
      <div class="fill" [style.width.%]="indeterminate() ? 100 : value()"></div>
    </div>
  `,
  styles: [
    `
      .track {
        width: 100%;
        height: 0.375rem;
        background: var(--sc-surface-3);
        border-radius: var(--sc-radius-full);
        overflow: hidden;
      }

      .fill {
        height: 100%;
        background: var(--sc-accent-gradient);
        border-radius: var(--sc-radius-full);
        /* No width transition: authoritative updates arrive ~100ms; a 280ms
           transition lagged behind and caused visible micro-stutter (G.6.2A). */
      }

      .track.indeterminate .fill {
        width: 40% !important;
        animation: sc-indeterminate 1.2s ease-in-out infinite;
      }

      @keyframes sc-indeterminate {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(250%);
        }
      }
    `,
  ],
})
export class ScProgressBarComponent {
  readonly value = input(0);
  readonly label = input('Progression');
  readonly indeterminate = input(false);
}
