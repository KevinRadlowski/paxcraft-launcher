import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AppStore } from '../../core/state/app.store';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import { HOME_ASSETS } from '../../features/home/home-assets';

interface NavItem {
  readonly path: string;
  readonly labelKey: string;
  readonly iconPath: string;
}

@Component({
  selector: 'sc-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, ScTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="sidebar" aria-label="Navigation principale">
      <div class="brand">
        <div class="logo-wrap" aria-hidden="true">
          <img [src]="mark" width="40" height="40" alt="" />
        </div>
        <div class="brand-text">
          <span class="brand-name">{{ 'shell.product.name' | scTranslate }}</span>
          <span class="brand-sub">{{ 'shell.product.by' | scTranslate }}</span>
        </div>
      </div>

      <nav class="nav">
        <ul>
          @for (item of items; track item.path) {
            <li>
              <a
                [routerLink]="item.path"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: item.path === '/home' }"
              >
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path [attr.d]="item.iconPath" fill="currentColor" />
                </svg>
                <span>{{ item.labelKey | scTranslate }}</span>
              </a>
            </li>
          }
        </ul>
      </nav>

      <div class="footer">
        <p class="community-sig">{{ 'shell.community.sig' | scTranslate }}</p>
        @if (version(); as v) {
          <p class="version">v{{ v }}</p>
        }
      </div>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .sidebar {
        width: var(--sc-sidebar-width);
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-6);
        padding: var(--sc-space-5) var(--sc-space-3);
        background: linear-gradient(180deg, #131c2b 0%, var(--sc-bg-sidebar) 100%);
        border-right: 1px solid var(--sc-border-default);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        padding: 0.1rem var(--sc-space-2) 0.25rem;
      }

      .logo-wrap {
        display: grid;
        place-items: center;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: var(--sc-radius-md);
        background: rgba(210, 167, 120, 0.1);
        border: 1px solid rgba(210, 167, 120, 0.35);
        overflow: hidden;
        flex-shrink: 0;
      }

      .logo-wrap img {
        width: 2.25rem;
        height: 2.25rem;
        object-fit: contain;
      }

      .brand-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 0.15rem;
      }

      .brand-name {
        font-weight: var(--sc-weight-bold);
        font-size: 1.05rem;
        letter-spacing: -0.02em;
        color: var(--sc-text-primary);
      }

      .brand-sub {
        font-size: 0.62rem;
        letter-spacing: 0.14em;
        color: var(--sc-text-accent);
        font-weight: var(--sc-weight-semibold);
        text-transform: uppercase;
      }

      .nav {
        flex: 1;
        min-height: 0;
      }

      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-1);
      }

      a {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        padding: 0.7rem var(--sc-space-3);
        border-radius: var(--sc-radius-md);
        color: var(--sc-text-secondary);
        text-decoration: none;
        font-weight: var(--sc-weight-medium);
        font-size: 0.9rem;
        border: 1px solid transparent;
        transition:
          background var(--sc-duration-normal) var(--sc-ease-out),
          color var(--sc-duration-normal) var(--sc-ease-out),
          border-color var(--sc-duration-normal) var(--sc-ease-out);
      }

      a:hover {
        background: var(--sc-surface-hover);
        color: var(--sc-text-primary);
        text-decoration: none;
      }

      a.active {
        background: var(--sc-nav-active-gradient);
        color: var(--sc-text-primary);
        border-color: var(--sc-border-accent);
      }

      a.active .icon {
        color: var(--sc-text-accent);
      }

      .icon {
        width: 1.15rem;
        height: 1.15rem;
        flex-shrink: 0;
        opacity: 0.92;
      }

      .footer {
        margin-top: auto;
        padding: var(--sc-space-3) var(--sc-space-2) 0;
        border-top: 1px solid var(--sc-border-default);
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
      }

      .community-sig {
        margin: 0;
        font-size: 0.65rem;
        letter-spacing: 0.08em;
        color: var(--sc-text-muted);
        line-height: 1.4;
      }

      .version {
        font-family: var(--sc-font-mono);
        font-size: 0.68rem;
        color: var(--sc-text-muted);
      }
    `,
  ],
})
export class SidebarComponent {
  private readonly store = inject(AppStore);

  readonly version = computed(() => this.store.info()?.version ?? null);
  readonly mark = HOME_ASSETS.paxLogo;

  /** Real routes only — Installer/Jouer remain CTA actions, not screens. */
  readonly items: NavItem[] = [
    {
      path: '/home',
      labelKey: 'nav.home',
      iconPath: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    },
    {
      path: '/account',
      labelKey: 'nav.account',
      iconPath:
        'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    },
    {
      path: '/settings',
      labelKey: 'nav.settings',
      iconPath:
        'M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.49.49 0 0 0 14.9 2h-3.8a.49.49 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L3.72 8.48a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L3.84 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.39.3.59.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
    },
    {
      path: '/diagnostics',
      labelKey: 'nav.diagnostics',
      iconPath:
        'M22 12l-4-4v3H3v2h15v3l4-4zM7.5 6.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 16a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    },
  ];
}
