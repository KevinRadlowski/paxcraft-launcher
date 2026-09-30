import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStore } from '../../core/state/app.store';
import { AuthActionsService } from '../../core/services/auth-actions.service';
import { InstallActionsService } from '../../core/services/install-actions.service';
import { ModalService } from '../../core/services/modal.service';
import { PlayActionsService } from '../../core/services/play-actions.service';
import { resolvePlayPhaseMessageKey } from '../../core/i18n/progress-messages';
import { translate } from '../../core/i18n/messages';
import {
  installProgressLabelKey,
  mapPrimaryAction,
  readinessBadgeKey,
  readinessBadgeVariant,
} from '../../shared/cta-mapping';
import { buildInstallProgressDetails } from '../../shared/install-progress-format';
import { resolveInstallDisplayElapsedMs } from '../../shared/install-elapsed-display';
import {
  installProgressFallbackLabelKey,
  resolveInstallCardPresentation,
} from '../../shared/install-card-presentation';
import { InstallElapsedTickerService } from '../../core/services/install-elapsed-ticker.service';
import { heroStatusPresentation } from './home-hero-status';
import { ScHeroComponent } from '../../shared/components/hero/hero.component';
import { ScBadgeComponent } from '../../shared/components/badge/badge.component';
import { ScCtaComponent } from '../../shared/components/cta/cta.component';
import { ScButtonComponent } from '../../shared/components/button/button.component';
import { ScProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import type { PrimaryActionPresentation } from '../../core/state/models';
import { HOME_ASSETS } from './home-assets';
import { HomeServerStatusService } from './home-server-status.service';
import { SWEETCRAFT_WEBSITE_URL } from '../../core/product-links';

const SITE_URL = SWEETCRAFT_WEBSITE_URL;

@Component({
  selector: 'sc-home-page',
  standalone: true,
  imports: [
    RouterLink,
    ScHeroComponent,
    ScBadgeComponent,
    ScCtaComponent,
    ScButtonComponent,
    ScProgressBarComponent,
    ScTranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="home-page">
      <div
        data-testid="home-assets"
        hidden
        [attr.data-hero]="assets.hero"
        [attr.data-server-card]="assets.serverCard"
        [attr.data-community-card]="assets.communityCard"
        [attr.data-pack-art]="assets.packArt"
        [attr.data-install-art]="assets.installArt"
        [attr.data-ambient-right]="assets.ambientRight"
      ></div>
      <div
        class="ambient-right"
        aria-hidden="true"
        [style.background-image]="'url(' + assets.ambientRight + ')'"
      ></div>
      <p class="ambient-copy" aria-hidden="true">Build. Explore. Survive. Together.</p>
      <div class="layout">
        <div class="main">
          <sc-hero [imageUrl]="assets.hero">
            <p class="eyebrow">{{ 'home.hero.eyebrow' | scTranslate }}</p>
            <h1 class="brand" aria-label="SweetCraft">
              <span class="brand-sweet">Sweet</span><span class="brand-craft">Craft</span>
            </h1>
            <p class="tagline sc-script">{{ 'home.hero.tagline' | scTranslate }}</p>
            <p class="subtitle">{{ 'home.hero.subtitle' | scTranslate }}</p>

            <div class="hero-cta">
              <sc-cta
                [action]="primaryAction()"
                [showDemoHint]="false"
                [hero]="true"
                (ctaClick)="onCta($event)"
              />
              <sc-badge class="status-pill" [variant]="heroBadgeVariant()">{{
                heroBadgeKey() | scTranslate
              }}</sc-badge>
            </div>

            @if (metaLine(); as meta) {
              <p class="meta mono">{{ meta }}</p>
            }
          </sc-hero>

          @if (showInstallProgress()) {
            <section class="panel progress-panel" aria-live="polite" aria-busy="true">
              <h2>{{ 'install.progress.title' | scTranslate }}</h2>
              <p class="muted">{{ progressLabelKey() | scTranslate }}</p>
              <sc-progress-bar
                [value]="progressPercent()"
                [indeterminate]="progressIndeterminate()"
                [label]="progressLabelKey() | scTranslate"
              />
              @if (progressDetails(); as details) {
                <div class="progress-details" aria-live="polite">
                  @if (details.scopeLine) {
                    <p class="progress-detail-strong">{{ details.scopeLine }}</p>
                  }
                  @if (details.bytesLine) {
                    <p class="muted progress-detail">{{ details.bytesLine }}</p>
                  }
                  @if (details.filesLine) {
                    <p class="muted progress-detail">{{ details.filesLine }} {{ 'install.progress.detail.files_unit' | scTranslate }}</p>
                  }
                  @if (details.speedLine) {
                    <p class="muted progress-detail">{{ details.speedLine }}</p>
                  }
                  @if (details.etaLine) {
                    <p class="muted progress-detail">{{ details.etaLine }}</p>
                  }
                  @if (details.elapsedLine) {
                    <p class="muted progress-detail">{{ details.elapsedLine }}</p>
                  }
                </div>
              }
            </section>
          }

          @if (showPlayPhase()) {
            <section class="panel progress-panel" aria-live="polite" aria-busy="true">
              <h2>{{ 'play.progress.title' | scTranslate }}</h2>
              <p class="muted">{{ playPhaseLabelKey() | scTranslate }}</p>
            </section>
          }

          @if (recoveryMessageKey(); as recoveryKey) {
            <section class="panel alert" role="alert">
              <p>{{ recoveryKey | scTranslate }}</p>
            </section>
          }

          @if (store.statusError(); as statusErr) {
            <section class="panel alert" role="alert">
              <p>{{ statusErr.messageKey | scTranslate }}</p>
            </section>
          }

          @if (store.operationError(); as opErr) {
            <section class="panel alert" role="alert">
              <p>{{ opErr.messageKey | scTranslate }}</p>
            </section>
          }

          @if (store.authError(); as authErr) {
            <section class="panel alert" role="alert">
              <p>{{ authErr.messageKey | scTranslate }}</p>
            </section>
          }

          @if (store.playError(); as playErr) {
            <section class="panel alert" role="alert">
              <p>{{ playErr.messageKey | scTranslate }}</p>
            </section>
          }

          <section class="cards" aria-label="État du launcher">
            <article class="card card-account" data-testid="card-account">
              <header class="card-head">
                <h2>{{ 'home.card.account.title' | scTranslate }}</h2>
              </header>
              @if (store.effectiveAuthState() === 'AUTHENTICATED' && account(); as acc) {
                <div class="account-row">
                  <div class="avatar" aria-hidden="true">{{ avatarLetter(acc.minecraftUsername) }}</div>
                  <div class="account-meta">
                    <p class="primary">{{ acc.minecraftUsername }}</p>
                    <p class="status-line">
                      <span class="dot ok"></span>
                      <span class="pill success">{{ 'home.card.account.connected' | scTranslate }}</span>
                    </p>
                  </div>
                </div>
                <div class="card-actions">
                  <a class="link-btn" routerLink="/account">{{
                    'home.card.account.manage' | scTranslate
                  }}</a>
                  <sc-button
                    variant="ghost"
                    size="sm"
                    [disabled]="playBlocksAuth()"
                    (click)="logout()"
                  >
                    {{ 'home.card.account.logout' | scTranslate }}
                  </sc-button>
                </div>
              } @else if (store.effectiveAuthState() === 'RESTORING') {
                <div class="account-row">
                  <div class="avatar placeholder" aria-hidden="true">?</div>
                  <p class="muted">{{
                    (store.authProgressKey() || 'auth.progress.restoring') | scTranslate
                  }}</p>
                </div>
              } @else {
                <div class="account-row">
                  <div class="avatar placeholder" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                      />
                    </svg>
                  </div>
                  <div class="account-meta">
                    <p class="primary">{{ 'home.account.none' | scTranslate }}</p>
                    <p class="muted small">{{ 'home.card.account.hint' | scTranslate }}</p>
                  </div>
                </div>
                <div class="card-actions">
                  <sc-button variant="secondary" size="sm" (click)="signIn()">
                    {{ 'cta.sign_in_microsoft' | scTranslate }}
                  </sc-button>
                </div>
              }
            </article>

            <article class="card card-pack" data-testid="card-pack">
              <header class="card-head">
                <h2>{{ 'home.card.pack.title' | scTranslate }}</h2>
                <div
                  class="card-art pack-art"
                  [style.background-image]="'url(' + assets.packArt + ')'"
                  aria-hidden="true"
                ></div>
              </header>
              @if (installedVersion(); as pack) {
                <p class="primary mono">{{ pack }}</p>
                <p class="status-line">
                  <span class="dot" [class.ok]="packUpToDate()" [class.warn]="!packUpToDate()"></span>
                  <span class="pill" [class.success]="packUpToDate()" [class.warn]="!packUpToDate()">{{
                    packStatusKey() | scTranslate
                  }}</span>
                </p>
              } @else {
                <p class="primary">{{ 'home.card.pack.not_installed_title' | scTranslate }}</p>
                <p class="muted small">{{ 'home.card.pack.none' | scTranslate }}</p>
              }
              @if (latestVersion(); as latest) {
                <p class="muted small">
                  {{ 'install.versions.latest' | scTranslate }}:
                  <span class="mono">{{ latest }}</span>
                </p>
              }
              <div class="card-actions">
                <sc-button
                  variant="secondary"
                  size="sm"
                  [disabled]="store.isInstallMutationBusy() || install.isBusy()"
                  (click)="verify()"
                >
                  {{ 'home.card.pack.verify' | scTranslate }}
                </sc-button>
              </div>
            </article>

            <article
              class="card card-install"
              [attr.data-readiness]="store.effectiveReadiness()"
              data-testid="card-install"
            >
              <header class="card-head">
                <h2>{{ 'home.card.install.title' | scTranslate }}</h2>
                <div
                  class="card-art install-art"
                  [style.background-image]="'url(' + assets.installArt + ')'"
                  aria-hidden="true"
                ></div>
              </header>
              <p class="primary install-state" [class.state-ok]="store.effectiveReadiness() === 'READY'">
                {{ installHeadlineKey() | scTranslate }}
              </p>
              <p class="status-line">
                <span
                  class="dot"
                  [class.ok]="store.effectiveReadiness() === 'READY'"
                  [class.warn]="installWarn()"
                  [class.danger]="installDanger()"
                ></span>
                <span class="muted">{{ installSupportKey() | scTranslate }}</span>
              </p>
              @if (showInstallProgress()) {
                <sc-progress-bar
                  class="card-progress"
                  [value]="progressPercent()"
                  [indeterminate]="progressIndeterminate()"
                  [label]="progressLabelKey() | scTranslate"
                />
                @if (progressDetails(); as details) {
                  <div class="progress-details compact" aria-live="polite">
                    @if (details.bytesLine) {
                      <p class="muted progress-detail">{{ details.bytesLine }}</p>
                    }
                    @if (details.filesLine) {
                      <p class="muted progress-detail">{{ details.filesLine }} {{ 'install.progress.detail.files_unit' | scTranslate }}</p>
                    }
                    @if (details.elapsedLine) {
                      <p class="muted progress-detail">{{ details.elapsedLine }}</p>
                    }
                  </div>
                }
              }
              <div class="card-actions">
                @if (store.effectiveReadiness() === 'REPAIR_REQUIRED') {
                  <sc-button
                    variant="secondary"
                    size="sm"
                    [disabled]="!canMutateInstall()"
                    (click)="repair()"
                  >
                    {{ 'cta.repair' | scTranslate }}
                  </sc-button>
                } @else if (store.effectiveReadiness() === 'NOT_INSTALLED') {
                  <sc-button
                    variant="secondary"
                    size="sm"
                    [disabled]="!canMutateInstall()"
                    (click)="installNow()"
                  >
                    {{ 'cta.install' | scTranslate }}
                  </sc-button>
                } @else if (store.effectiveReadiness() === 'UPDATE_AVAILABLE') {
                  <sc-button
                    variant="secondary"
                    size="sm"
                    [disabled]="!canMutateInstall()"
                    (click)="updateNow()"
                  >
                    {{ 'cta.update' | scTranslate }}
                  </sc-button>
                } @else {
                  <sc-button
                    variant="ghost"
                    size="sm"
                    [disabled]="store.isInstallMutationBusy() || install.isBusy()"
                    (click)="verify()"
                  >
                    {{ 'home.card.install.check' | scTranslate }}
                  </sc-button>
                }
                @if (canOpenInstanceFolder() || showUninstallAction()) {
                  @if (canOpenInstanceFolder()) {
                    <sc-button
                      variant="ghost"
                      size="sm"
                      data-testid="open-instance-folder"
                      [disabled]="!canOpenInstanceFolderEnabled()"
                      (click)="openInstanceFolder()"
                    >
                      {{ 'home.card.install.open_folder' | scTranslate }}
                    </sc-button>
                  }
                  @if (showUninstallAction()) {
                    <sc-button
                      variant="danger"
                      size="sm"
                      data-testid="uninstall-instance"
                      [disabled]="!canUninstall()"
                      (click)="confirmUninstall()"
                    >
                      {{ 'home.card.install.uninstall' | scTranslate }}
                    </sc-button>
                  }
                }
              </div>
            </article>
          </section>

          <section class="community" data-testid="community-panel">
            <div class="community-art" aria-hidden="true">
              <div
                class="community-thumb"
                [style.background-image]="'url(' + assets.communityCard + ')'"
              ></div>
            </div>
            <div class="community-copy">
              <h2>{{ 'home.community.title' | scTranslate }}</h2>
              <p class="muted">{{ 'home.community.body' | scTranslate }}</p>
              <div class="community-actions">
                <a class="site-btn" [href]="siteUrl" target="_blank" rel="noopener noreferrer">
                  {{ 'home.community.site' | scTranslate }}
                </a>
                <a class="ghost-btn" routerLink="/account">{{ 'home.community.secondary' | scTranslate }}</a>
              </div>
            </div>
            <ul class="pillars">
              <li>
                <span class="pillar-icon" aria-hidden="true">✦</span>
                {{ 'home.community.pillar.help' | scTranslate }}
              </li>
              <li>
                <span class="pillar-icon" aria-hidden="true">✦</span>
                {{ 'home.community.pillar.events' | scTranslate }}
              </li>
              <li>
                <span class="pillar-icon" aria-hidden="true">✦</span>
                {{ 'home.community.pillar.share' | scTranslate }}
              </li>
              <li>
                <span class="pillar-icon" aria-hidden="true">✦</span>
                {{ 'home.community.pillar.vibes' | scTranslate }}
              </li>
            </ul>
          </section>
        </div>

        <aside class="rail" aria-label="Contexte" data-testid="home-rail">
          <article class="card rail-card">
            <h2>{{ 'home.rail.account' | scTranslate }}</h2>
            @if (store.effectiveAuthState() === 'AUTHENTICATED' && account(); as acc) {
              <div class="account-row compact">
                <div class="avatar sm" aria-hidden="true">{{ avatarLetter(acc.minecraftUsername) }}</div>
                <div>
                  <p class="name">{{ acc.minecraftUsername }}</p>
                  <p class="status-line">
                    <span class="dot ok"></span>
                    {{ 'home.card.account.connected' | scTranslate }}
                  </p>
                </div>
              </div>
              <sc-button
                variant="ghost"
                size="sm"
                [disabled]="playBlocksAuth()"
                (click)="logout()"
              >
                {{ 'home.card.account.logout' | scTranslate }}
              </sc-button>
            } @else {
              <p class="muted">{{ 'home.account.none' | scTranslate }}</p>
              <a class="link-btn" routerLink="/account">{{ 'nav.account' | scTranslate }}</a>
            }
          </article>

          <article class="card rail-card server-card" data-testid="rail-server">
            <div class="server-layout">
              <div class="server-body">
                <h2>{{ 'home.rail.server' | scTranslate }}</h2>
                <p class="primary">SweetCraft</p>
                <p class="mono server" data-testid="server-address">{{ store.serverAddress() }}</p>
                <p class="status-line">
                  <span
                    class="dot"
                    [class.ok]="serverStatus().state === 'ONLINE'"
                    [class.offline]="serverStatus().state === 'OFFLINE'"
                    [class.unknown]="serverStatus().state === 'UNKNOWN'"
                  ></span>
                  <span
                    class="pill"
                    [class.success]="serverStatus().state === 'ONLINE'"
                    [class.offline]="serverStatus().state === 'OFFLINE'"
                  >{{ serverStateLabelKey() | scTranslate }}</span>
                </p>
                <div class="server-metrics" data-testid="server-telemetry">
                  @if (playersLine(); as players) {
                    <p class="metric mono">
                      <span class="metric-label" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                      </span>
                      {{ players }} {{ 'home.server.players' | scTranslate }}
                    </p>
                  }
                  @if (latencyLine(); as latency) {
                    <p class="metric mono">
                      <span class="metric-label" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                      </span>
                      {{ latency }}
                    </p>
                  }
                </div>
                <a class="link-btn" [href]="siteUrl" target="_blank" rel="noopener noreferrer">
                  {{ 'home.community.site' | scTranslate }}
                </a>
              </div>
              <div
                class="server-art"
                [style.background-image]="'url(' + assets.serverCard + ')'"
                aria-hidden="true"
              ></div>
            </div>
          </article>

          <article class="card rail-card about-card" data-testid="rail-about">
            <div
              class="about-ambient"
              [style.background-image]="'url(' + assets.ambientRight + ')'"
              aria-hidden="true"
            ></div>
            <div class="about-content">
              <h2>{{ 'home.rail.about.title' | scTranslate }}</h2>
              <p class="primary small-primary">{{ 'home.rail.about.modpack' | scTranslate }}</p>
              <p class="muted small">{{ 'home.rail.about.body' | scTranslate }}</p>
              <ul class="about-tags">
                <li class="about-tag">{{ 'home.rail.about.item.adventure' | scTranslate }}</li>
                <li class="about-tag">{{ 'home.rail.about.item.build' | scTranslate }}</li>
                <li class="about-tag">{{ 'home.rail.about.item.explore' | scTranslate }}</li>
                <li class="about-tag">{{ 'home.rail.about.item.survive' | scTranslate }}</li>
              </ul>
              <p class="xnosweet">{{ 'shell.brand.line' | scTranslate }}</p>
            </div>
          </article>
        </aside>
      </div>
    </div>
  `,
  styles: [
    `
      .page {
        position: relative;
        width: 100%;
        max-width: none;
        margin: 0;
      }

      .ambient-right {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 42%;
        height: 55%;
        pointer-events: none;
        opacity: 0.42;
        background-color: transparent;
        background-size: cover;
        background-position: right bottom;
        background-repeat: no-repeat;
        z-index: 0;
        -webkit-mask-image: linear-gradient(to left, #000 28%, transparent 92%),
          linear-gradient(to top, #000 35%, transparent 95%);
        mask-image: linear-gradient(to left, #000 28%, transparent 92%),
          linear-gradient(to top, #000 35%, transparent 95%);
        -webkit-mask-composite: source-in;
        mask-composite: intersect;
      }

      .ambient-copy {
        position: absolute;
        right: 1.25rem;
        bottom: 1rem;
        z-index: 0;
        pointer-events: none;
        margin: 0;
        max-width: 11rem;
        text-align: right;
        font-size: 0.65rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(196, 181, 253, 0.32);
        line-height: 1.45;
      }

      .layout {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(17rem, 0.38fr);
        gap: var(--sc-home-gap);
        align-items: start;
        width: 100%;
      }

      .main {
        display: flex;
        flex-direction: column;
        gap: var(--sc-home-gap);
        min-width: 0;
      }

      .eyebrow {
        font-size: 0.7rem;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: #c4b5fd;
        font-weight: var(--sc-weight-semibold);
      }

      .brand {
        font-size: clamp(2.6rem, 5.2vw, 3.75rem);
        line-height: 1;
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.03em;
        margin: 0;
      }

      .brand-sweet {
        color: #f8f5ff;
      }

      .brand-craft {
        background: linear-gradient(135deg, #c084fc 0%, #e879f9 45%, #d91bb5 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      .tagline {
        font-size: clamp(1.05rem, 1.6vw, 1.35rem);
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
        opacity: 0.95;
      }

      .sc-script {
        font-style: italic;
        letter-spacing: 0.02em;
      }

      .subtitle {
        color: var(--sc-text-secondary);
        max-width: 30rem;
        line-height: var(--sc-leading-relaxed);
        font-size: var(--sc-text-sm);
      }

      .hero-cta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sc-space-4);
        margin-top: var(--sc-space-2);
      }

      .status-pill {
        align-self: center;
      }

      .meta {
        font-size: var(--sc-text-xs);
        color: rgba(243, 240, 248, 0.78);
        margin-top: var(--sc-space-1);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--sc-home-gap);
      }

      .card,
      .panel {
        padding: var(--sc-space-5);
        background: rgba(18, 18, 28, 0.9);
        border: 1px solid rgba(196, 181, 253, 0.14);
        border-radius: var(--sc-radius-xl);
        box-shadow: var(--sc-shadow-card);
        display: flex;
        flex-direction: column;
        min-height: 12.5rem;
        position: relative;
        overflow: hidden;
      }

      .card::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.9;
      }

      .card-account::before {
        background: radial-gradient(ellipse 80% 60% at 0% 0%, rgba(138, 27, 217, 0.16), transparent 55%);
      }

      .card-pack::before {
        background: radial-gradient(ellipse 80% 60% at 100% 0%, rgba(46, 204, 113, 0.1), transparent 55%);
      }

      .card-install::before {
        background: radial-gradient(ellipse 80% 60% at 50% 100%, rgba(217, 27, 181, 0.12), transparent 55%);
      }

      .card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--sc-space-3);
        margin-bottom: var(--sc-space-3);
        position: relative;
      }

      .card h2,
      .panel h2,
      .rail-card h2 {
        font-size: 0.72rem;
        color: var(--sc-text-secondary);
        font-weight: var(--sc-weight-semibold);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin: 0;
      }

      .card-art {
        width: 3.25rem;
        height: 3.25rem;
        border-radius: var(--sc-radius-lg);
        background-color: #12121c;
        background-image: radial-gradient(circle at 40% 35%, rgba(168, 85, 247, 0.35), #12121c 70%);
        background-size: cover;
        background-position: center;
        border: 1px solid rgba(196, 181, 253, 0.35);
        flex-shrink: 0;
      }

      .pack-art {
        background-position: center 45%;
      }

      .install-art {
        background-position: center 40%;
      }

      .account-row {
        display: flex;
        gap: var(--sc-space-3);
        align-items: center;
        position: relative;
      }

      .account-row.compact {
        margin-bottom: var(--sc-space-3);
      }

      .avatar {
        width: 3rem;
        height: 3rem;
        border-radius: var(--sc-radius-lg);
        display: grid;
        place-items: center;
        background: var(--sc-accent-soft);
        border: 1px solid var(--sc-border-accent);
        font-weight: var(--sc-weight-bold);
        flex-shrink: 0;
        box-shadow: 0 0 18px rgba(217, 27, 181, 0.18);
      }

      .avatar.sm {
        width: 2.35rem;
        height: 2.35rem;
        font-size: var(--sc-text-sm);
      }

      .avatar.placeholder {
        color: var(--sc-text-accent);
      }

      .account-meta {
        min-width: 0;
      }

      .name,
      .primary {
        font-weight: var(--sc-weight-semibold);
        font-size: var(--sc-text-lg);
        line-height: 1.25;
        position: relative;
      }

      .small-primary {
        font-size: var(--sc-text-base);
        margin-bottom: var(--sc-space-2);
      }

      .install-state {
        font-size: clamp(1.35rem, 2vw, 1.75rem);
        letter-spacing: -0.02em;
      }

      .install-state.state-ok {
        color: var(--sc-success);
      }

      .status-line {
        display: flex;
        align-items: center;
        gap: var(--sc-space-2);
        font-size: var(--sc-text-sm);
        color: var(--sc-text-secondary);
        margin-top: var(--sc-space-2);
        position: relative;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        padding: 0.12rem 0.55rem;
        border-radius: var(--sc-radius-full);
        border: 1px solid var(--sc-border-subtle);
        background: rgba(255, 255, 255, 0.04);
        font-size: var(--sc-text-xs);
        font-weight: var(--sc-weight-medium);
      }

      .pill.success {
        color: var(--sc-success);
        border-color: rgba(46, 204, 113, 0.35);
        background: var(--sc-success-muted);
      }

      .pill.warn {
        color: var(--sc-warning);
        border-color: rgba(245, 158, 11, 0.35);
        background: var(--sc-warning-muted);
      }

      .pill.offline {
        color: rgba(248, 113, 113, 0.95);
        border-color: rgba(248, 113, 113, 0.3);
        background: rgba(248, 113, 113, 0.08);
      }

      .dot {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 50%;
        background: var(--sc-text-muted);
        flex-shrink: 0;
      }

      .dot.ok {
        background: var(--sc-success);
        box-shadow: 0 0 8px rgba(46, 204, 113, 0.55);
      }

      .dot.warn {
        background: var(--sc-warning);
      }

      .dot.danger {
        background: var(--sc-danger);
      }

      .dot.offline {
        background: rgba(248, 113, 113, 0.85);
      }

      .dot.unknown {
        background: var(--sc-text-muted);
      }

      .muted {
        color: var(--sc-text-secondary);
        position: relative;
      }

      .small {
        font-size: var(--sc-text-xs);
        margin-top: var(--sc-space-2);
      }

      .card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-2);
        margin-top: auto;
        padding-top: var(--sc-space-4);
        position: relative;
      }

      .card-progress {
        margin-top: var(--sc-space-3);
        position: relative;
      }

      .link-btn,
      .site-btn,
      .ghost-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem 0.9rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid var(--sc-border-default);
        background: var(--sc-surface-2);
        color: var(--sc-text-primary);
        font-size: var(--sc-text-sm);
        font-weight: var(--sc-weight-medium);
        text-decoration: none;
      }

      .link-btn:hover,
      .site-btn:hover,
      .ghost-btn:hover {
        background: var(--sc-surface-hover);
        text-decoration: none;
      }

      .site-btn {
        background: var(--sc-accent-gradient);
        border-color: transparent;
        box-shadow: var(--sc-shadow-accent);
      }

      .ghost-btn {
        background: transparent;
      }

      .alert {
        border-color: rgba(245, 158, 11, 0.35);
        color: var(--sc-text-secondary);
        min-height: 0;
      }

      .progress-panel {
        min-height: 0;
      }

      .progress-panel .muted {
        margin-bottom: var(--sc-space-3);
      }

      .progress-details {
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-1);
        margin-top: var(--sc-space-3);
      }

      .progress-details.compact {
        margin-top: var(--sc-space-2);
      }

      .progress-detail {
        margin: 0;
        font-size: 0.875rem;
      }

      .progress-detail-strong {
        margin: 0;
        font-size: 0.9rem;
        font-weight: 600;
      }

      .community {
        display: grid;
        grid-template-columns: 9.5rem minmax(0, 1.3fr) minmax(11rem, 0.9fr);
        gap: var(--sc-space-6);
        align-items: center;
        padding: var(--sc-space-5);
        border-radius: var(--sc-radius-xl);
        border: 1px solid rgba(196, 181, 253, 0.16);
        background:
          radial-gradient(ellipse 50% 80% at 0% 50%, rgba(217, 27, 181, 0.14), transparent 60%),
          linear-gradient(120deg, rgba(18, 18, 28, 0.95), rgba(40, 16, 48, 0.78));
        box-shadow: var(--sc-shadow-card);
      }

      .community-art {
        align-self: stretch;
      }

      .community-thumb {
        width: 100%;
        height: 100%;
        min-height: 7.5rem;
        border-radius: var(--sc-radius-lg);
        background-color: #12121c;
        background-image: radial-gradient(ellipse at 60% 40%, rgba(217, 27, 181, 0.22), #12121c 75%);
        background-size: cover;
        background-position: 55% center;
        border: 1px solid var(--sc-border-subtle);
        box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.35);
      }

      .community-copy h2 {
        font-size: var(--sc-text-xl);
        color: var(--sc-text-primary);
        text-transform: none;
        letter-spacing: -0.02em;
        margin-bottom: var(--sc-space-2);
        font-weight: var(--sc-weight-bold);
      }

      .community-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-3);
        margin-top: var(--sc-space-4);
      }

      .pillars {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--sc-space-2);
      }

      .pillars li {
        display: flex;
        align-items: center;
        gap: var(--sc-space-2);
        padding: 0.6rem 0.85rem;
        border-radius: var(--sc-radius-md);
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(196, 181, 253, 0.12);
        font-size: var(--sc-text-sm);
        color: var(--sc-text-secondary);
      }

      .pillar-icon {
        color: var(--sc-text-accent);
      }

      .rail {
        display: flex;
        flex-direction: column;
        gap: var(--sc-home-gap);
        position: sticky;
        top: 0;
        min-height: 0;
      }

      .rail-card {
        min-height: 0;
      }

      .server-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(5.25rem, 34%);
        gap: var(--sc-space-3);
        align-items: stretch;
        position: relative;
      }

      .server-body {
        display: flex;
        flex-direction: column;
        min-width: 0;
        position: relative;
      }

      .server-art {
        width: 100%;
        min-height: 6rem;
        border-radius: var(--sc-radius-md);
        background-color: #12121c;
        background-image: radial-gradient(ellipse at 70% 50%, rgba(138, 27, 217, 0.35), #12121c 70%);
        background-size: cover;
        background-position: 72% center;
        border: 1px solid rgba(196, 181, 253, 0.35);
        flex-shrink: 0;
      }

      .server {
        margin: var(--sc-space-1) 0 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        word-break: normal;
      }

      .server-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-2) var(--sc-space-3);
        margin-top: var(--sc-space-2);
        min-height: 0;
      }

      .server-metrics .metric {
        margin: 0;
        font-size: var(--sc-text-xs);
        color: var(--sc-text-secondary);
      }

      .server-body .link-btn {
        margin-top: var(--sc-space-3);
        align-self: flex-start;
      }

      .about-card {
        position: relative;
        overflow: hidden;
        isolation: isolate;
        background:
          radial-gradient(ellipse 90% 70% at 100% 0%, rgba(217, 27, 181, 0.16), transparent 55%),
          radial-gradient(ellipse 70% 50% at 0% 100%, rgba(138, 27, 217, 0.12), transparent 60%),
          rgba(18, 18, 28, 0.92);
      }

      .about-ambient {
        position: absolute;
        inset: 0;
        opacity: 0.18;
        background-size: cover;
        background-position: 80% bottom;
        pointer-events: none;
        z-index: 0;
        -webkit-mask-image: linear-gradient(120deg, transparent 20%, #000 75%);
        mask-image: linear-gradient(120deg, transparent 20%, #000 75%);
      }

      .about-content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }

      .about-card h2 {
        font-size: 0.78rem;
        letter-spacing: 0.12em;
        color: #e9e2ff;
      }

      .about-card .small-primary {
        margin-top: var(--sc-space-2);
        background: linear-gradient(135deg, #f8f5ff 0%, #e879f9 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      .about-tags {
        margin: var(--sc-space-3) 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .about-tag {
        display: inline-flex;
        align-items: center;
        padding: 0.28rem 0.65rem;
        border-radius: var(--sc-radius-full);
        border: 1px solid rgba(196, 181, 253, 0.28);
        background: rgba(196, 181, 253, 0.1);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        color: #e9e2ff;
        font-size: 0.68rem;
        font-weight: var(--sc-weight-semibold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .xnosweet {
        margin-top: auto;
        padding-top: var(--sc-space-3);
        border-top: 1px solid rgba(196, 181, 253, 0.18);
        font-size: var(--sc-text-xs);
        letter-spacing: 0.08em;
        color: #c4b5fd;
        text-transform: uppercase;
      }

      @media (max-width: 1279px) {
        .server {
          white-space: normal;
          overflow: visible;
          text-overflow: unset;
          word-break: break-word;
        }
      }

      /* Keep two-column Home longer; stack later than before */
      @media (max-width: 1359px) {
        .layout {
          grid-template-columns: minmax(0, 1fr) minmax(15rem, 0.34fr);
          gap: 1rem;
        }
      }

      @media (max-width: 1279px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .rail {
          position: static;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 1100px) {
        .cards {
          grid-template-columns: 1fr;
        }
        .community {
          grid-template-columns: 1fr;
        }
        .community-thumb {
          min-height: 9rem;
        }
        .rail {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 960px) {
        .rail {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class HomePageComponent implements OnInit, OnDestroy {
  protected readonly store = inject(AppStore);
  protected readonly install = inject(InstallActionsService);
  private readonly modal = inject(ModalService);
  private readonly auth = inject(AuthActionsService);
  private readonly play = inject(PlayActionsService);
  private readonly serverStatusSvc = inject(HomeServerStatusService);
  private readonly elapsedTicker = inject(InstallElapsedTickerService);

  readonly assets = HOME_ASSETS;
  readonly siteUrl = SITE_URL;
  readonly serverStatus = this.serverStatusSvc.status;
  readonly account = this.store.activeAccount;

  ngOnInit(): void {
    this.serverStatusSvc.start();
    void this.install.refreshStorageSummary();
  }

  ngOnDestroy(): void {
    this.serverStatusSvc.stop();
  }

  serverStateLabelKey(): string {
    switch (this.serverStatus().state) {
      case 'ONLINE':
        return 'home.server.state.online';
      case 'OFFLINE':
        return 'home.server.state.offline';
      default:
        return 'home.server.state.unknown';
    }
  }

  playersLine(): string | null {
    const status = this.serverStatus();
    if (status.state !== 'ONLINE' || status.playersOnline == null) return null;
    if (status.playersMax != null) return `${status.playersOnline} / ${status.playersMax}`;
    return String(status.playersOnline);
  }

  latencyLine(): string | null {
    const status = this.serverStatus();
    if (status.state !== 'ONLINE' || status.latencyMs == null) return null;
    return `${status.latencyMs} ms`;
  }

  readonly primaryAction = computed(() =>
    mapPrimaryAction(this.store.effectiveReadiness(), this.store.effectiveAuthState(), {
      activeOperation: this.store.effectiveActiveOperation(),
      installBusy: this.install.isBusy(),
      playState: this.store.effectivePlayState(),
      playBusy: this.play.isBusy(),
    }),
  );

  readonly badgeKey = computed(() => readinessBadgeKey(this.store.effectiveReadiness()));
  readonly badgeVariant = computed(() => readinessBadgeVariant(this.store.effectiveReadiness()));

  /** Hero pill — Play LAUNCHING/RUNNING overrides READY install label (presentation only). */
  readonly heroBadgeKey = computed(
    () =>
      heroStatusPresentation(this.store.effectiveReadiness(), this.store.effectivePlayState())
        .labelKey,
  );
  readonly heroBadgeVariant = computed(
    () =>
      heroStatusPresentation(this.store.effectiveReadiness(), this.store.effectivePlayState())
        .variant,
  );

  /** Human-facing install headline — active operation overrides underlying readiness. */
  readonly installHeadlineKey = computed(
    () =>
      resolveInstallCardPresentation(
        this.store.effectiveReadiness(),
        this.store.effectiveActiveOperation(),
      ).headlineKey,
  );

  readonly installSupportKey = computed(
    () =>
      resolveInstallCardPresentation(
        this.store.effectiveReadiness(),
        this.store.effectiveActiveOperation(),
      ).supportKey,
  );

  readonly installWarn = computed(() => {
    const r = this.store.effectiveReadiness();
    return r === 'UPDATE_AVAILABLE' || r === 'REPAIR_REQUIRED';
  });

  readonly installDanger = computed(() => {
    const r = this.store.effectiveReadiness();
    return r === 'RECOVERY_REQUIRED' || r === 'ERROR' || r === 'INCOMPATIBLE_STATE';
  });

  readonly installedVersion = computed(
    () => this.store.status()?.installedVersion ?? this.store.status()?.packVersion ?? null,
  );
  readonly latestVersion = computed(() => this.store.status()?.latestVersion ?? null);
  readonly minecraftVersion = computed(() => this.store.status()?.minecraftVersion ?? null);
  readonly fabricVersion = computed(() => this.store.status()?.fabricVersion ?? null);

  readonly metaLine = computed(() => {
    const parts: string[] = [];
    const mc = this.minecraftVersion();
    const fab = this.fabricVersion();
    const pack = this.installedVersion();
    if (mc) parts.push(`Minecraft ${mc}`);
    if (fab) parts.push(`Fabric ${fab}`);
    if (pack) parts.push(`Pack ${pack}`);
    return parts.length ? parts.join('  ·  ') : null;
  });

  readonly packUpToDate = computed(() => {
    const readiness = this.store.effectiveReadiness();
    return readiness === 'READY';
  });

  readonly packStatusKey = computed(() => {
    const readiness = this.store.effectiveReadiness();
    if (readiness === 'UPDATE_AVAILABLE') return 'home.card.pack.update';
    if (readiness === 'READY') return 'home.card.pack.uptodate';
    if (readiness === 'NOT_INSTALLED') return 'home.card.pack.none';
    return this.badgeKey();
  });

  readonly showInstallProgress = computed(
    () =>
      this.store.isInstallMutationBusy() ||
      this.install.isBusy() ||
      this.store.effectiveActiveOperation() === 'CHECKING',
  );

  readonly progressLabelKey = computed(() => {
    const progress = this.store.installProgress() ?? this.store.status()?.progress;
    if (progress) return installProgressLabelKey(progress.phase);
    const active = this.store.effectiveActiveOperation();
    if (active === 'UNINSTALLING' && this.store.uninstallMode() === 'COMPLETE') {
      return 'install.progress.uninstalling_complete';
    }
    return installProgressFallbackLabelKey(active);
  });

  readonly progressPercent = computed(() => {
    const progress = this.store.installProgress() ?? this.store.status()?.progress;
    if (!progress || progress.indeterminate) return 0;
    return progress.percent ?? 0;
  });

  readonly progressIndeterminate = computed(() => {
    const progress = this.store.installProgress() ?? this.store.status()?.progress;
    if (progress) return progress.indeterminate;
    return true;
  });

  readonly progressDetails = computed(() => {
    this.elapsedTicker.tick();
    const active = this.store.effectiveActiveOperation();
    const displayElapsedMs = resolveInstallDisplayElapsedMs({
      operationStartedAt: this.store.installOperationStartedAt(),
      nowMs: Date.now(),
      activeOperation: active,
    });
    const elapsedLabels = {
      downloadScope: translate('install.progress.detail.download_scope'),
      filesScope: translate('install.progress.detail.files_scope'),
      elapsed: (duration: string) =>
        translate('install.progress.detail.elapsed', { duration }),
      eta: (duration: string) =>
        translate('install.progress.detail.eta_phase', { duration }),
    };
    const progress = this.store.installProgress() ?? this.store.status()?.progress;
    if (!progress) {
      const details = buildInstallProgressDetails(
        { phase: 'PREPARING', operation: 'status', indeterminate: true },
        elapsedLabels,
        { displayElapsedMs },
      );
      return details.elapsedLine ? { elapsedLine: details.elapsedLine } : null;
    }
    const details = buildInstallProgressDetails(progress, elapsedLabels, {
      displayElapsedMs,
    });
    if (
      !details.scopeLine &&
      !details.bytesLine &&
      !details.filesLine &&
      !details.speedLine &&
      !details.etaLine &&
      !details.elapsedLine
    ) {
      return null;
    }
    return details;
  });

  readonly recoveryMessageKey = computed(() => {
    const readiness = this.store.effectiveReadiness();
    if (readiness !== 'RECOVERY_REQUIRED' && readiness !== 'INCOMPATIBLE_STATE') return null;
    return this.store.status()?.messageKey ?? 'install.message.recovery_required';
  });

  readonly showPlayPhase = computed(() => {
    const state = this.store.effectivePlayState();
    return state === 'LAUNCHING' || state === 'RUNNING';
  });

  readonly playPhaseLabelKey = computed(() => {
    const status = this.store.playStatus();
    const state = this.store.effectivePlayState();
    return resolvePlayPhaseMessageKey(status?.phaseKey, state);
  });

  readonly playBlocksAuth = computed(() => {
    const s = this.store.effectivePlayState();
    return s === 'RUNNING' || s === 'LAUNCHING';
  });

  readonly canMutateInstall = computed(() => {
    if (this.store.isInstallMutationBusy() || this.install.isBusy()) return false;
    if (this.playBlocksAuth()) return false;
    return true;
  });

  readonly canOpenInstanceFolder = computed(
    () => this.install.instanceDirectoryAvailable() === true,
  );

  readonly canOpenInstanceFolderEnabled = computed(
    () =>
      this.canOpenInstanceFolder() &&
      !this.store.isInstallMutationBusy() &&
      !this.install.isBusy(),
  );

  readonly showUninstallAction = computed(() => this.canOpenInstanceFolder());

  readonly canUninstall = computed(
    () => this.canMutateInstall() && this.showUninstallAction(),
  );

  avatarLetter(name: string): string {
    return (name.trim().charAt(0) || '?').toUpperCase();
  }

  signIn(): void {
    void this.auth.login();
  }

  logout(): void {
    const id = this.account()?.accountId;
    if (!id) return;
    void this.auth.logout(id);
  }

  verify(): void {
    void this.install.refreshStatus();
  }

  installNow(): void {
    void this.install.beginFirstInstall();
  }

  updateNow(): void {
    void this.install.update();
  }

  repair(): void {
    void this.install.repair();
  }

  openInstanceFolder(): void {
    void this.install.openInstanceFolder();
  }

  confirmUninstall(): void {
    if (!this.canUninstall()) return;
    this.modal.open({
      titleKey: 'install.uninstall.choice.title',
      bodyKey: 'install.uninstall.choice.lead',
      cancelKey: 'install.uninstall.confirm.cancel',
      icon: 'info',
      sections: [
        {
          titleKey: 'install.uninstall.safe.title',
          bodyKey: 'install.uninstall.safe.body',
          actionKey: 'install.uninstall.safe.action',
          actionVariant: 'secondary',
          onAction: () => {
            void this.install.uninstall('SAFE');
          },
        },
        {
          titleKey: 'install.uninstall.complete.title',
          bodyKey: 'install.uninstall.complete.body',
          actionKey: 'install.uninstall.complete.action',
          actionVariant: 'danger',
          onAction: () => {
            this.confirmCompleteUninstall();
          },
        },
      ],
    });
  }

  confirmCompleteUninstall(): void {
    if (!this.canUninstall()) return;
    this.modal.open({
      titleKey: 'install.uninstall.complete.confirm.title',
      bodyKey: 'install.uninstall.complete.confirm.body',
      cancelKey: 'install.uninstall.confirm.cancel',
      confirmKey: 'install.uninstall.complete.confirm.action',
      confirmVariant: 'danger',
      icon: 'security',
      onConfirm: () => {
        void this.install.uninstall('COMPLETE');
      },
    });
  }

  onCta(action: PrimaryActionPresentation): void {
    if (action.kind === 'SIGN_IN' || action.kind === 'REAUTH') {
      void this.auth.login();
      return;
    }
    if (action.kind === 'INSTALL') {
      void this.install.beginFirstInstall();
      return;
    }
    if (action.kind === 'UPDATE') {
      void this.install.update();
      return;
    }
    if (action.kind === 'REPAIR') {
      void this.install.repair();
      return;
    }
    if (action.kind === 'VERIFY') {
      void this.install.refreshStatus();
      return;
    }
    if (action.kind === 'PLAY') {
      void this.play.start();
    }
  }
}
