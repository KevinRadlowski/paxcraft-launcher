import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'sc-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="skeleton" [style.width]="width()" [style.height]="height()" aria-hidden="true"></div>`,
  styles: [
    `
      .skeleton {
        border-radius: var(--sc-radius-md);
        background: linear-gradient(
          90deg,
          var(--sc-surface-2) 0%,
          var(--sc-surface-3) 50%,
          var(--sc-surface-2) 100%
        );
        background-size: 200% 100%;
        animation: shimmer 1.4s var(--sc-ease-in-out) infinite;
      }

      @keyframes shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .skeleton {
          animation: none;
        }
      }
    `,
  ],
})
export class ScSkeletonComponent {
  readonly width = input('100%');
  readonly height = input('1rem');
}
