import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { AuthState } from '@sweetcraft/ipc';
import { ScBadgeComponent } from '../badge/badge.component';
import { ScTranslatePipe } from '../../../core/i18n/translate.pipe';

@Component({
  selector: 'sc-account-chip',
  standalone: true,
  imports: [ScBadgeComponent, ScTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chip">
      <div class="avatar" aria-hidden="true">{{ initials() }}</div>
      <div class="meta">
        <span class="name">{{ username() || ('home.account.none' | scTranslate) }}</span>
        <sc-badge [variant]="badgeVariant()">{{ stateLabelKey() | scTranslate }}</sc-badge>
      </div>
    </div>
  `,
  styles: [
    `
      .chip {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        padding: var(--sc-space-3) var(--sc-space-4);
        background: var(--sc-surface-2);
        border: 1px solid var(--sc-border-subtle);
        border-radius: var(--sc-radius-lg);
      }

      .avatar {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: var(--sc-radius-md);
        display: grid;
        place-items: center;
        font-weight: var(--sc-weight-bold);
        font-size: var(--sc-text-sm);
        background: var(--sc-accent-gradient);
        color: var(--sc-text-primary);
      }

      .meta {
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-1);
      }

      .name {
        font-weight: var(--sc-weight-medium);
      }
    `,
  ],
})
export class ScAccountChipComponent {
  readonly username = input<string | null>(null);
  readonly authState = input<AuthState>('SIGNED_OUT');

  readonly initials = computed(() => {
    const name = this.username();
    if (!name) {
      return '?';
    }
    return name.slice(0, 2).toUpperCase();
  });

  readonly stateLabelKey = computed(() => {
    switch (this.authState()) {
      case 'AUTHENTICATED':
        return 'account.state.authenticated';
      case 'RESTORING':
        return 'account.state.restoring';
      case 'UNKNOWN':
        return 'account.state.unknown';
      case 'REAUTH_REQUIRED':
        return 'account.state.reauth_required';
      case 'ERROR':
        return 'account.state.error';
      case 'SIGNED_OUT':
        return 'account.state.signed_out';
      default:
        return 'account.state.unknown';
    }
  });

  readonly badgeVariant = computed(() => {
    switch (this.authState()) {
      case 'AUTHENTICATED':
        return 'success' as const;
      case 'RESTORING':
        return 'info' as const;
      case 'UNKNOWN':
        return 'neutral' as const;
      case 'REAUTH_REQUIRED':
        return 'warning' as const;
      case 'ERROR':
        return 'danger' as const;
      case 'SIGNED_OUT':
        return 'neutral' as const;
      default:
        return 'neutral' as const;
    }
  });
}
