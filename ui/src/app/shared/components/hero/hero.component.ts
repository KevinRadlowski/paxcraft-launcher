import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'sc-hero',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero" [class.has-image]="!!imageUrl()">
      <div
        class="sc-hero-media media"
        [style.background-image]="backgroundStyle()"
        aria-hidden="true"
      ></div>
      <div class="wash" aria-hidden="true"></div>
      <div class="overlay" aria-hidden="true"></div>
      <div class="content">
        <ng-content />
      </div>
    </section>
  `,
  styles: [
    `
      .hero {
        position: relative;
        min-height: clamp(26rem, 48vh, 32.5rem);
        border-radius: var(--sc-radius-xl);
        overflow: hidden;
        border: 1px solid var(--sc-border-subtle);
        box-shadow: var(--sc-shadow-lg), 0 0 60px rgba(138, 27, 217, 0.12);
        isolation: isolate;
      }

      .media {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse 70% 100% at 0% 50%, rgba(138, 27, 217, 0.22), transparent 60%),
          radial-gradient(ellipse 55% 90% at 100% 20%, rgba(217, 27, 181, 0.2), transparent 55%),
          linear-gradient(135deg, #1a1030 0%, #0b0b12 55%, #1a0820 100%);
        background-size: cover;
        background-position: 62% center;
        filter: saturate(1.28) contrast(1.1) brightness(1.16);
        transform: scale(1.02);
        transition: transform var(--sc-duration-slow) var(--sc-ease-out);
      }

      .hero.has-image:hover .media {
        transform: scale(1.045);
      }

      .wash {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse 50% 55% at 22% 70%, rgba(217, 27, 181, 0.2), transparent 70%),
          radial-gradient(ellipse 55% 70% at 78% 42%, rgba(168, 85, 247, 0.22), transparent 70%),
          radial-gradient(ellipse 40% 45% at 18% 28%, rgba(243, 240, 248, 0.08), transparent 60%);
        pointer-events: none;
      }

      .overlay {
        position: absolute;
        inset: 0;
        background:
          linear-gradient(
            90deg,
            rgba(7, 7, 13, 0.72) 0%,
            rgba(7, 7, 13, 0.34) 32%,
            rgba(7, 7, 13, 0.04) 56%,
            rgba(7, 7, 13, 0.1) 100%
          ),
          linear-gradient(180deg, rgba(7, 7, 13, 0.02) 0%, rgba(7, 7, 13, 0.16) 50%, rgba(7, 7, 13, 0.62) 100%);
        box-shadow: inset 0 -48px 90px rgba(0, 0, 0, 0.28);
      }

      .content {
        position: relative;
        z-index: 1;
        padding: clamp(1.5rem, 3.2vw, 2.75rem);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-height: inherit;
        gap: var(--sc-space-3);
        max-width: min(38rem, 92%);
      }

      @media (max-width: 1365px) {
        .hero {
          min-height: clamp(22rem, 42vh, 28rem);
        }
      }
    `,
  ],
})
export class ScHeroComponent {
  readonly imageUrl = input<string | null>(null);

  backgroundStyle(): string {
    const url = this.imageUrl();
    if (!url) {
      return 'none';
    }
    return `url('${url}')`;
  }
}
