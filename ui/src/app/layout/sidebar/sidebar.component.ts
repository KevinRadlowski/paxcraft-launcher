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
          <img [src]="mark" width="44" height="44" alt="" />
        </div>
        <div class="brand-text">
          <span class="brand-name">SweetCraft</span>
          <span class="brand-sub">LAUNCHER</span>
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
        <div class="xnosweet-block" aria-label="XNOSWEET">
          <!-- Official mark slot: only render <img> when a real brand file is provided.
               Current text fallback avoids broken-image icons. -->
          <p class="xnosweet-wordmark">XNOSWEET</p>
          <ul class="xnosweet-meta" aria-hidden="true">
            <li>GAMING</li>
            <li>COMMUNITY</li>
            <li>CREATIVE</li>
          </ul>
        </div>
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
        gap: var(--sc-space-8);
        padding: var(--sc-space-6) var(--sc-space-4);
        background:
          radial-gradient(ellipse 120% 42% at 50% -8%, rgba(217, 27, 181, 0.2), transparent 55%),
          linear-gradient(180deg, rgba(18, 18, 28, 0.98) 0%, var(--sc-bg-sidebar) 100%);
        border-right: 1px solid rgba(196, 181, 253, 0.12);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        padding: 0.15rem var(--sc-space-2) 0.35rem;
      }

      .logo-wrap {
        display: grid;
        place-items: center;
        width: 3.1rem;
        height: 3.1rem;
        border-radius: var(--sc-radius-lg);
        background:
          radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.16), transparent 45%),
          rgba(217, 27, 181, 0.14);
        box-shadow:
          0 0 28px rgba(217, 27, 181, 0.35),
          inset 0 1px 0 rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(217, 27, 181, 0.42);
      }

      .logo-wrap img {
        width: 2.5rem;
        height: 2.5rem;
      }

      .brand-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 0.2rem;
      }

      .brand-name {
        font-weight: var(--sc-weight-bold);
        font-size: 1.12rem;
        letter-spacing: -0.03em;
      }

      .brand-sub {
        font-size: 0.7rem;
        letter-spacing: 0.22em;
        color: #c4b5fd;
        font-weight: var(--sc-weight-semibold);
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
        gap: var(--sc-space-2);
      }

      a {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        padding: 0.85rem var(--sc-space-4);
        border-radius: var(--sc-radius-md);
        color: var(--sc-text-secondary);
        text-decoration: none;
        font-weight: var(--sc-weight-medium);
        font-size: 0.95rem;
        border: 1px solid transparent;
        transition:
          background var(--sc-duration-normal) var(--sc-ease-out),
          color var(--sc-duration-normal) var(--sc-ease-out),
          box-shadow var(--sc-duration-normal) var(--sc-ease-out),
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
        box-shadow: 0 0 26px rgba(217, 27, 181, 0.3);
      }

      .icon {
        width: 1.2rem;
        height: 1.2rem;
        flex-shrink: 0;
        opacity: 0.92;
      }

      .footer {
        margin-top: auto;
        padding: var(--sc-space-4) var(--sc-space-2) 0;
        border-top: 1px solid rgba(196, 181, 253, 0.12);
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-3);
      }

      .xnosweet-block {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .xnosweet-wordmark {
        margin: 0;
        font-size: 0.78rem;
        font-weight: var(--sc-weight-bold);
        letter-spacing: 0.18em;
        color: #c4b5fd;
        text-transform: uppercase;
      }

      .xnosweet-meta {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        list-style: none;
        margin: 0;
        padding: 0;
        font-size: 0.62rem;
        letter-spacing: 0.16em;
        color: #9b8fb8;
        text-transform: uppercase;
      }

      .version {
        font-family: var(--sc-font-mono);
        font-size: 0.7rem;
        color: var(--sc-text-muted);
      }
    `,
  ],
})
export class SidebarComponent {
  private readonly store = inject(AppStore);

  readonly version = computed(() => this.store.info()?.version ?? null);
  readonly mark = HOME_ASSETS.sweetcraftMark;

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
