import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { PrimaryActionPresentation } from '../../../core/state/models';
import { ScButtonComponent } from '../button/button.component';
import { ScTranslatePipe } from '../../../core/i18n/translate.pipe';

@Component({
  selector: 'sc-cta',
  standalone: true,
  imports: [ScButtonComponent, ScTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cta-block">
      <sc-button
        class="cta-btn"
        [class.hero]="hero()"
        [variant]="action().variant"
        size="lg"
        [disabled]="!action().enabled"
        (click)="ctaClick.emit(action())"
      >
        @if (action().kind === 'PLAY' || action().kind === 'INSTALL') {
          <span class="play-icon" aria-hidden="true">▶</span>
        }
        {{ action().labelKey | scTranslate }}
      </sc-button>
      @if (showDemoHint()) {
        <p class="hint">{{ 'cta.demo_hint' | scTranslate }}</p>
      }
    </div>
  `,
  styles: [
    `
      .cta-block {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--sc-space-2);
      }

      :host ::ng-deep .cta-btn.hero button.lg {
        min-width: min(22rem, 72vw);
        height: 3.75rem;
        padding-inline: 2rem;
        font-size: 1.125rem;
        border-radius: var(--sc-radius-lg);
        box-shadow: var(--sc-shadow-accent), 0 8px 24px rgba(0, 0, 0, 0.35);
        letter-spacing: 0.02em;
      }

      :host ::ng-deep .cta-btn button.lg {
        min-width: 14rem;
        padding-inline: 1.75rem;
      }

      .play-icon {
        font-size: 0.85em;
        opacity: 0.95;
      }

      .hint {
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
      }
    `,
  ],
})
export class ScCtaComponent {
  readonly action = input.required<PrimaryActionPresentation>();
  readonly showDemoHint = input(true);
  /** Larger product CTA for Home hero. */
  readonly hero = input(false);

  readonly ctaClick = output<PrimaryActionPresentation>();
}
