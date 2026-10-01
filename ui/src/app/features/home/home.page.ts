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
import { ScBadgeComponent } from '../../shared/components/badge/badge.component';
import { ScCtaComponent } from '../../shared/components/cta/cta.component';
import { ScButtonComponent } from '../../shared/components/button/button.component';
import { ScProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import type { PrimaryActionPresentation } from '../../core/state/models';
import { HOME_ASSETS } from './home-assets';
import { HomeServerStatusService } from './home-server-status.service';
import { SWEETCRAFT_WEBSITE_URL } from '../../core/product-links';

const SITE_URL = SWEETCRAFT_WEBSITE_URL ?? '';

@Component({
  selector: 'sc-home-page',
  standalone: true,
  imports: [
    RouterLink,
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

      <section class="hero" aria-labelledby="home-hero-title">
        <div
          class="hero-media"
          [style.background-image]="'url(' + assets.hero + ')'"
          aria-hidden="true"
        ></div>
        <div class="hero-veil" aria-hidden="true"></div>
        <div class="hero-copy">
          <p class="eyebrow">{{ 'home.hero.eyebrow' | scTranslate }}</p>
          <h1 id="home-hero-title" class="hero-title">{{ 'home.hero.title' | scTranslate }}</h1>
          <p class="subtitle">{{ 'home.hero.subtitle' | scTranslate }}</p>
        </div>
      </section>

      <section class="install-block" data-testid="card-install" [attr.data-readiness]="store.effectiveReadiness()">
        <header class="install-head">
          <div>
            <h2>{{ 'home.card.install.title' | scTranslate }}</h2>
            <p class="install-state" [class.state-ok]="store.effectiveReadiness() === 'READY'">
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
            @if (metaLine(); as meta) {
              <p class="meta mono">{{ meta }}</p>
            }
          </div>
          <div class="install-cta">
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
        </header>

        @if (showInstallProgress()) {
          <div class="progress-panel" aria-live="polite" aria-busy="true">
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
          </div>
        }

        @if (showPlayPhase()) {
          <div class="progress-panel" aria-live="polite" aria-busy="true">
            <h3>{{ 'play.progress.title' | scTranslate }}</h3>
            <p class="muted">{{ playPhaseLabelKey() | scTranslate }}</p>
          </div>
        }

        @if (recoveryMessageKey(); as recoveryKey) {
          <div class="alert" role="alert"><p>{{ recoveryKey | scTranslate }}</p></div>
        }
        @if (store.statusError(); as statusErr) {
          <div class="alert" role="alert"><p>{{ statusErr.messageKey | scTranslate }}</p></div>
        }
        @if (store.operationError(); as opErr) {
          <div class="alert" role="alert"><p>{{ opErr.messageKey | scTranslate }}</p></div>
        }
        @if (store.authError(); as authErr) {
          <div class="alert" role="alert"><p>{{ authErr.messageKey | scTranslate }}</p></div>
        }
        @if (store.playError(); as playErr) {
          <div class="alert" role="alert"><p>{{ playErr.messageKey | scTranslate }}</p></div>
        }

        <div class="install-actions">
          @if (store.effectiveReadiness() === 'REPAIR_REQUIRED') {
            <sc-button variant="secondary" size="sm" [disabled]="!canMutateInstall()" (click)="repair()">
              {{ 'cta.repair' | scTranslate }}
            </sc-button>
          } @else if (store.effectiveReadiness() === 'UPDATE_AVAILABLE') {
            <sc-button variant="secondary" size="sm" [disabled]="!canMutateInstall()" (click)="updateNow()">
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
        </div>
      </section>

      <section class="secondary" aria-label="Compte et communaut?">
        <article class="panel" data-testid="card-account">
          <header class="panel-head">
            <h2>{{ 'home.card.account.title' | scTranslate }}</h2>
          </header>
          @if (store.effectiveAuthState() === 'AUTHENTICATED' && account(); as acc) {
            <div class="account-row">
              <div class="avatar" aria-hidden="true">{{ avatarLetter(acc.minecraftUsername) }}</div>
              <div class="account-meta">
                <p class="primary">{{ acc.minecraftUsername }}</p>
                <p class="status-line">
                  <span class="dot ok"></span>
                  <span>{{ 'home.card.account.connected' | scTranslate }}</span>
                </p>
              </div>
            </div>
            <div class="panel-actions">
              <a class="link-btn" routerLink="/account">{{ 'home.card.account.manage' | scTranslate }}</a>
              <sc-button variant="ghost" size="sm" [disabled]="playBlocksAuth()" (click)="logout()">
                {{ 'home.card.account.logout' | scTranslate }}
              </sc-button>
            </div>
          } @else if (store.effectiveAuthState() === 'RESTORING') {
            <p class="muted">{{ (store.authProgressKey() || 'auth.progress.restoring') | scTranslate }}</p>
          } @else {
            <p class="primary">{{ 'home.account.none' | scTranslate }}</p>
            <p class="muted small">{{ 'home.card.account.hint' | scTranslate }}</p>
            <div class="panel-actions">
              <sc-button variant="secondary" size="sm" (click)="signIn()">
                {{ 'cta.sign_in_microsoft' | scTranslate }}
              </sc-button>
            </div>
          }
        </article>

        <article class="panel" data-testid="community-panel">
          <header class="panel-head">
            <h2>{{ 'home.community.title' | scTranslate }}</h2>
          </header>
          <p class="muted">{{ 'home.community.body' | scTranslate }}</p>
          @if (siteUrl) {
            <div class="panel-actions">
              <a class="link-btn" [href]="siteUrl" target="_blank" rel="noopener noreferrer">
                {{ 'home.community.site' | scTranslate }}
              </a>
            </div>
          }
        </article>
      </section>

      <section class="server-strip" data-testid="rail-server" aria-label="État serveur">
        <div class="server-strip-body">
          <h2>{{ 'home.rail.server' | scTranslate }}</h2>
          @if (displayServerAddress(); as addr) {
            <p class="mono server" data-testid="server-address">{{ addr }}</p>
          } @else {
            <p class="server" data-testid="server-address">{{ 'home.server.unconfigured' | scTranslate }}</p>
          }
          <p class="status-line">
            <span
              class="dot"
              [class.ok]="serverStatus().state === 'ONLINE'"
              [class.offline]="serverStatus().state === 'OFFLINE'"
              [class.unknown]="serverStatus().state === 'UNKNOWN'"
            ></span>
            <span>{{ serverStateLabelKey() | scTranslate }}</span>
          </p>
          <div class="server-metrics" data-testid="server-telemetry">
            @if (playersLine(); as players) {
              <p class="metric mono">{{ players }} {{ 'home.server.players' | scTranslate }}</p>
            }
            @if (latencyLine(); as latency) {
              <p class="metric mono">{{ latency }}</p>
            }
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: var(--sc-home-gap);
        width: 100%;
        max-width: 72rem;
        margin: 0 auto;
      }

      .hero {
        position: relative;
        min-height: 11.5rem;
        border-radius: var(--sc-radius-xl);
        overflow: hidden;
        border: 1px solid var(--sc-border-default);
        background: var(--sc-surface-1);
      }

      .hero-media {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center 40%;
      }

      .hero-veil {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          105deg,
          rgba(16, 23, 31, 0.92) 0%,
          rgba(16, 23, 31, 0.72) 42%,
          rgba(16, 23, 31, 0.35) 100%
        );
      }

      .hero-copy {
        position: relative;
        z-index: 1;
        padding: var(--sc-space-6) var(--sc-space-6);
        max-width: 36rem;
      }

      .eyebrow {
        margin: 0 0 var(--sc-space-2);
        font-size: 0.7rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--sc-text-accent);
        font-weight: var(--sc-weight-semibold);
      }

      .hero-title {
        margin: 0;
        font-size: clamp(1.45rem, 2.4vw, 1.85rem);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.02em;
        color: var(--sc-text-primary);
      }

      .tagline {
        margin: var(--sc-space-2) 0 0;
        font-size: var(--sc-text-lg);
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
      }

      .subtitle {
        margin: var(--sc-space-2) 0 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.5;
      }

      .install-block,
      .panel,
      .server-strip {
        border-radius: var(--sc-radius-lg);
        border: 1px solid var(--sc-border-default);
        background: var(--sc-surface-1);
        box-shadow: var(--sc-shadow-card);
      }

      .install-block {
        padding: var(--sc-space-5);
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-4);
      }

      .install-head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-4);
        justify-content: space-between;
        align-items: flex-start;
      }

      .install-head h2,
      .panel-head h2,
      .server-strip h2 {
        margin: 0 0 var(--sc-space-2);
        font-size: var(--sc-text-sm);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--sc-text-secondary);
        font-weight: var(--sc-weight-semibold);
      }

      .install-state {
        margin: 0;
        font-size: var(--sc-text-xl);
        font-weight: var(--sc-weight-semibold);
        color: var(--sc-text-primary);
      }

      .install-state.state-ok {
        color: var(--sc-success);
      }

      .install-cta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sc-space-3);
      }

      .meta {
        margin: var(--sc-space-2) 0 0;
        color: var(--sc-text-muted);
        font-size: var(--sc-text-xs);
      }

      .status-line {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: var(--sc-space-2) 0 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
      }

      .dot {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 50%;
        background: var(--sc-text-muted);
        flex-shrink: 0;
      }
      .dot.ok { background: var(--sc-success); }
      .dot.warn { background: var(--sc-warning); }
      .dot.danger, .dot.offline { background: var(--sc-danger); }
      .dot.unknown { background: var(--sc-text-muted); }

      .muted { color: var(--sc-text-secondary); margin: 0; }
      .small { font-size: var(--sc-text-sm); }
      .primary { margin: 0; color: var(--sc-text-primary); font-weight: var(--sc-weight-medium); }

      .progress-panel { display: flex; flex-direction: column; gap: var(--sc-space-2); }
      .progress-details { display: flex; flex-direction: column; gap: var(--sc-space-1); }
      .progress-detail, .progress-detail-strong { margin: 0; font-size: var(--sc-text-sm); }
      .progress-detail-strong { font-weight: var(--sc-weight-semibold); }

      .alert {
        padding: var(--sc-space-3) var(--sc-space-4);
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(245, 158, 11, 0.35);
        background: var(--sc-warning-muted);
        color: var(--sc-text-secondary);
      }
      .alert p { margin: 0; }

      .install-actions,
      .panel-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-2);
        align-items: center;
      }

      .secondary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--sc-home-gap);
      }

      .panel { padding: var(--sc-space-5); display: flex; flex-direction: column; gap: var(--sc-space-3); min-width: 0; }

      .account-row {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
      }

      .avatar {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: var(--sc-radius-md);
        display: grid;
        place-items: center;
        background: rgba(210, 167, 120, 0.16);
        border: 1px solid rgba(210, 167, 120, 0.35);
        color: var(--sc-text-accent);
        font-weight: var(--sc-weight-bold);
        flex-shrink: 0;
      }

      .link-btn {
        display: inline-flex;
        align-items: center;
        padding: 0.45rem 0.85rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid var(--sc-border-default);
        color: var(--sc-text-primary);
        text-decoration: none;
        font-size: var(--sc-text-sm);
        background: var(--sc-surface-2);
      }
      .link-btn:hover { border-color: var(--sc-border-accent); color: var(--sc-text-accent); text-decoration: none; }

      .server-strip {
        padding: var(--sc-space-4) var(--sc-space-5);
      }
      .server { margin: 0; color: var(--sc-text-secondary); font-size: var(--sc-text-sm); }
      .server-metrics { display: flex; flex-wrap: wrap; gap: var(--sc-space-3); margin-top: var(--sc-space-2); }
      .metric { margin: 0; font-size: var(--sc-text-xs); color: var(--sc-text-secondary); }

      @media (max-width: 900px) {
        .secondary { grid-template-columns: 1fr; }
        .install-head { flex-direction: column; }
        .install-cta { width: 100%; }
      }

      @media (max-width: 700px) {
        .hero-copy { padding: var(--sc-space-5); }
        .install-actions { flex-direction: column; align-items: stretch; }
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

  displayServerAddress(): string {
    const raw = this.store.serverAddress()?.trim() ?? '';
    if (!raw || raw === 'not-configured' || /sweetcraft/i.test(raw)) {
      return ''; // presentation: label via i18n, not DTO sentinel
    }
    return raw;
  }

  /** Human label key unused in template — kept for callers/tests. */
  serverDisplayLabelKey(): string {
    const raw = this.store.serverAddress()?.trim() ?? '';
    if (!raw || raw === 'not-configured' || /sweetcraft/i.test(raw)) {
      return 'home.server.unconfigured';
    }
    return 'home.server.label';
  }

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
