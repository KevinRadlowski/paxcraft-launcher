import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import type { AuthState, LauncherReadiness, SafeDiagnosticsDto } from '@sweetcraft/ipc';
import { AppStore } from '../../core/state/app.store';
import { LAUNCHER_DESKTOP_GATEWAY } from '../../core/desktop-api/gateway';
import { getDevGatewayInstance } from '../../core/desktop-api/provide-gateway';
import { DevLauncherDesktopGateway } from '../../core/desktop-api/dev.gateway';
import { NotificationsService } from '../../core/services/notifications.service';
import { AuthActionsService } from '../../core/services/auth-actions.service';
import { InstallActionsService } from '../../core/services/install-actions.service';
import { PlayActionsService } from '../../core/services/play-actions.service';
import { ScBadgeComponent } from '../../shared/components/badge/badge.component';
import { ScButtonComponent } from '../../shared/components/button/button.component';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import { mapPrimaryAction } from '../../shared/cta-mapping';
import {
  authLabelKey as resolveAuthLabelKey,
  authTone as resolveAuthTone,
  playLabelKey as resolvePlayLabelKey,
  playTone as resolvePlayTone,
  readinessLabelKey as resolveReadinessLabelKey,
  readinessTone as resolveReadinessTone,
} from './diagnostics-presentation';
import {
  DEFAULT_FAKE_AUTH_FIXTURE,
  FAKE_AUTH_FIXTURE_IDS,
  createFakeAuthFixtureFormState,
  fakeAuthFixtureAppliedMessageKey,
  fakeAuthFixtureAppliedParams,
  fixturePayloadToApply,
  isFakeAuthFixtureId,
  markFakeAuthFixtureApplied,
  selectFakeAuthFixture,
  type FakeAuthFixtureFormState,
  type FakeAuthFixtureId,
} from './fake-auth-fixture-form';
import {
  DEFAULT_FAKE_INSTALL_FIXTURE,
  FAKE_INSTALL_FIXTURE_IDS,
  createFakeInstallFixtureFormState,
  fakeInstallFixtureAppliedMessageKey,
  fakeInstallFixtureAppliedParams,
  fixturePayloadToApply as installFixturePayloadToApply,
  isFakeInstallFixtureId,
  markFakeInstallFixtureApplied,
  selectFakeInstallFixture,
  type FakeInstallFixtureFormState,
  type FakeInstallFixtureId,
} from './fake-install-fixture-form';
import {
  DEFAULT_FAKE_PLAY_FIXTURE,
  FAKE_PLAY_FIXTURE_IDS,
  createFakePlayFixtureFormState,
  fakePlayFixtureAppliedMessageKey,
  fakePlayFixtureAppliedParams,
  fixturePayloadToApply as playFixturePayloadToApply,
  isFakePlayFixtureId,
  markFakePlayFixtureApplied,
  selectFakePlayFixture,
  type FakePlayFixtureFormState,
  type FakePlayFixtureId,
} from './fake-play-fixture-form';

const READINESS_OPTIONS: LauncherReadiness[] = [
  'NOT_INSTALLED',
  'UPDATE_AVAILABLE',
  'REPAIR_REQUIRED',
  'READY',
  'BUSY',
  'CHECKING',
  'ERROR',
  'RECOVERY_REQUIRED',
  'INCOMPATIBLE_STATE',
  'UNKNOWN',
];

const AUTH_OPTIONS: AuthState[] = [
  'UNKNOWN',
  'SIGNED_OUT',
  'RESTORING',
  'AUTHENTICATED',
  'REAUTH_REQUIRED',
  'ERROR',
];

@Component({
  selector: 'sc-diagnostics-page',
  standalone: true,
  imports: [ScBadgeComponent, ScButtonComponent, ScTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="diagnostics-page">
      <header class="page-head">
        <h1>{{ 'diagnostics.title' | scTranslate }}</h1>
        <p class="page-lead">{{ 'diagnostics.subtitle' | scTranslate }}</p>
      </header>

      <section class="status-grid" [attr.aria-label]="'diagnostics.states.aria' | scTranslate">
        <article class="status-card" [attr.data-tone]="installTone()" data-testid="diagnostics-status-install">
          <p class="status-label">{{ 'diagnostics.field.install' | scTranslate }}</p>
          <p class="status-value">{{ installLabelKey() | scTranslate }}</p>
          <p class="status-code mono">{{ installCode() }}</p>
        </article>
        <article class="status-card" [attr.data-tone]="accountTone()" data-testid="diagnostics-status-auth">
          <p class="status-label">{{ 'diagnostics.field.auth' | scTranslate }}</p>
          <p class="status-value">{{ authLabelKey() | scTranslate }}</p>
          <p class="status-code mono">{{ authCode() }}</p>
        </article>
        <article class="status-card" [attr.data-tone]="launchTone()" data-testid="diagnostics-status-play">
          <p class="status-label">{{ 'diagnostics.field.play' | scTranslate }}</p>
          <p class="status-value">{{ playLabelKey() | scTranslate }}</p>
          <p class="status-code mono">{{ playCode() }}</p>
        </article>
      </section>

      <section class="panel support" aria-labelledby="diagnostics-support-heading" data-testid="diagnostics-support">
        <div class="section-head">
          <div>
            <h2 id="diagnostics-support-heading">{{ 'diagnostics.support.title' | scTranslate }}</h2>
            <p class="muted">{{ 'diagnostics.support.subtitle' | scTranslate }}</p>
          </div>
          <sc-button
            variant="primary"
            [disabled]="copyBusy()"
            (click)="copyDiagnostics()"
            [attr.aria-label]="'diagnostics.copy' | scTranslate"
          >
            {{ 'diagnostics.copy' | scTranslate }}
          </sc-button>
        </div>
        @if (diagError()) {
          <p class="error" role="alert">{{ diagError()! | scTranslate }}</p>
        } @else if (!diagnostics()) {
          <p class="muted" role="status">{{ 'diagnostics.loading' | scTranslate }}</p>
        }
        <p class="preview">
          {{ 'diagnostics.cta_preview' | scTranslate }}
          <strong>{{ previewAction().labelKey | scTranslate }}</strong>
        </p>
      </section>

      <details class="fold" data-testid="diagnostics-technical" open>
        <summary>
          <span class="fold-title">{{ 'diagnostics.technical.title' | scTranslate }}</span>
          <span class="fold-body">{{ 'diagnostics.technical.subtitle' | scTranslate }}</span>
        </summary>
        <div class="fold-panel">
          @if (diagnostics(); as d) {
            <dl class="tech-grid" aria-live="polite">
              <div>
                <dt>{{ 'diagnostics.field.version' | scTranslate }}</dt>
                <dd class="mono">{{ d.launcherVersion }}</dd>
              </div>
              <div>
                <dt>{{ 'diagnostics.field.build_id' | scTranslate }}</dt>
                <dd class="mono">{{ d.buildId ?? '—' }}</dd>
              </div>
              @if (d.buildCommit) {
                <div>
                  <dt>{{ 'diagnostics.field.build_commit' | scTranslate }}</dt>
                  <dd class="mono">{{ d.buildCommit }}</dd>
                </div>
              }
              <div>
                <dt>{{ 'diagnostics.field.environment' | scTranslate }}</dt>
                <dd class="mono">{{ d.environment }}</dd>
              </div>
              <div>
                <dt>{{ 'diagnostics.field.platform' | scTranslate }}</dt>
                <dd class="mono">{{ d.platform }} {{ d.architecture }}</dd>
              </div>
              <div>
                <dt>{{ 'diagnostics.field.pack' | scTranslate }}</dt>
                <dd class="mono">{{ d.installedPackVersion ?? '—' }}</dd>
              </div>
              <div>
                <dt>{{ 'diagnostics.field.memory' | scTranslate }}</dt>
                <dd class="mono">{{ d.memoryMiB != null ? d.memoryMiB + ' MiB' : '—' }}</dd>
              </div>
              <div>
                <dt>{{ 'diagnostics.field.support_id' | scTranslate }}</dt>
                <dd class="mono">{{ d.supportId }}</dd>
              </div>
              @if (d.appIdBlocked) {
                <div>
                  <dt>{{ 'diagnostics.field.appid' | scTranslate }}</dt>
                  <dd class="mono">BLOCKED</dd>
                </div>
              }
            </dl>
          } @else {
            <p class="muted" role="status">{{ 'diagnostics.loading' | scTranslate }}</p>
          }
        </div>
      </details>

      <details class="fold fold-dev" data-testid="diagnostics-dev-tools">
        <summary>
          <span class="fold-title">{{ 'diagnostics.dev_tools.title' | scTranslate }}</span>
          <span class="fold-body">{{ 'diagnostics.dev_tools.subtitle' | scTranslate }}</span>
        </summary>
        <div class="fold-panel">
          @if (!showDevTools()) {
            <sc-badge variant="neutral">{{ 'diagnostics.dev_tools.production' | scTranslate }}</sc-badge>
          } @else {
            <section class="dev-block" aria-labelledby="diagnostics-demo-heading">
              <div class="section-head">
                <div>
                  <h3 id="diagnostics-demo-heading">{{ 'diagnostics.demo.title' | scTranslate }}</h3>
                  <p class="muted">{{ 'diagnostics.demo.subtitle' | scTranslate }}</p>
                </div>
                @if (!isDevGateway()) {
                  <sc-badge variant="neutral">{{ 'diagnostics.demo.not_available' | scTranslate }}</sc-badge>
                }
              </div>
              @if (isDevGateway()) {
                <div class="controls">
                  <label>
                    {{ 'diagnostics.demo.readiness' | scTranslate }}
                    <select (change)="onReadinessChange($event)">
                      @for (r of readinessOptions; track r) {
                        <option [value]="r" [selected]="selectedReadiness() === r">{{ r }}</option>
                      }
                    </select>
                  </label>
                  <label>
                    {{ 'diagnostics.demo.auth' | scTranslate }}
                    <select (change)="onAuthChange($event)">
                      @for (a of authOptions; track a) {
                        <option [value]="a" [selected]="selectedAuth() === a">{{ a }}</option>
                      }
                    </select>
                  </label>
                  <sc-button variant="primary" (click)="applyDemo()">
                    {{ 'diagnostics.demo.apply' | scTranslate }}
                  </sc-button>
                </div>
              }
            </section>

            <section class="dev-block" aria-labelledby="diagnostics-fake-auth-heading">
              <div class="section-head">
                <div>
                  <h3 id="diagnostics-fake-auth-heading">{{ 'diagnostics.fake_auth.title' | scTranslate }}</h3>
                  <p class="muted">{{ 'diagnostics.fake_auth.subtitle' | scTranslate }}</p>
                </div>
                @if (!fakeAuthHarness()) {
                  <sc-badge variant="neutral">{{ 'diagnostics.fake_auth.not_available' | scTranslate }}</sc-badge>
                }
              </div>
              @if (fakeAuthHarness()) {
                <div class="controls">
                  <label>
                    {{ 'diagnostics.fake_auth.fixture' | scTranslate }}
                    <select data-testid="fake-auth-fixture-select" (change)="onFixtureChange($event)">
                      @for (f of fakeFixtures; track f) {
                        <option [value]="f" [selected]="selectedFixture() === f">{{ f }}</option>
                      }
                    </select>
                  </label>
                  @if (lastAppliedFixture(); as last) {
                    <p class="last-applied">
                      {{ 'diagnostics.fake_auth.last_applied' | scTranslate: { fixture: last } }}
                    </p>
                  }
                  <sc-button variant="primary" [disabled]="auth.isBusy()" (click)="applyFakeFixture()">
                    {{ 'diagnostics.fake_auth.apply' | scTranslate }}
                  </sc-button>
                </div>
              }
            </section>

            <section class="dev-block" aria-labelledby="diagnostics-fake-install-heading">
              <div class="section-head">
                <div>
                  <h3 id="diagnostics-fake-install-heading">{{ 'diagnostics.fake_install.title' | scTranslate }}</h3>
                  <p class="muted">{{ 'diagnostics.fake_install.subtitle' | scTranslate }}</p>
                </div>
                @if (!fakeInstallHarness()) {
                  <sc-badge variant="neutral">{{ 'diagnostics.fake_install.not_available' | scTranslate }}</sc-badge>
                }
              </div>
              @if (fakeInstallHarness()) {
                <div class="controls">
                  <label>
                    {{ 'diagnostics.fake_install.fixture' | scTranslate }}
                    <select data-testid="fake-install-fixture-select" (change)="onInstallFixtureChange($event)">
                      @for (f of fakeInstallFixtures; track f) {
                        <option [value]="f" [selected]="selectedInstallFixture() === f">{{ f }}</option>
                      }
                    </select>
                  </label>
                  @if (lastAppliedInstallFixture(); as last) {
                    <p class="last-applied">
                      {{ 'diagnostics.fake_install.last_applied' | scTranslate: { fixture: last } }}
                    </p>
                  }
                  <sc-button variant="primary" [disabled]="install.isBusy()" (click)="applyFakeInstallFixture()">
                    {{ 'diagnostics.fake_install.apply' | scTranslate }}
                  </sc-button>
                </div>
              }
            </section>

            <section class="dev-block" aria-labelledby="diagnostics-fake-play-heading">
              <div class="section-head">
                <div>
                  <h3 id="diagnostics-fake-play-heading">{{ 'diagnostics.fake_play.title' | scTranslate }}</h3>
                  <p class="muted">{{ 'diagnostics.fake_play.subtitle' | scTranslate }}</p>
                </div>
                @if (!fakePlayHarness()) {
                  <sc-badge variant="neutral">{{ 'diagnostics.fake_play.not_available' | scTranslate }}</sc-badge>
                }
              </div>
              @if (fakePlayHarness()) {
                <div class="controls">
                  <label>
                    {{ 'diagnostics.fake_play.fixture' | scTranslate }}
                    <select data-testid="fake-play-fixture-select" (change)="onPlayFixtureChange($event)">
                      @for (f of fakePlayFixtures; track f) {
                        <option [value]="f" [selected]="selectedPlayFixture() === f">{{ f }}</option>
                      }
                    </select>
                  </label>
                  @if (lastAppliedPlayFixture(); as last) {
                    <p class="last-applied">
                      {{ 'diagnostics.fake_play.last_applied' | scTranslate: { fixture: last } }}
                    </p>
                  }
                  <sc-button variant="primary" [disabled]="play.isBusy()" (click)="applyFakePlayFixture()">
                    {{ 'diagnostics.fake_play.apply' | scTranslate }}
                  </sc-button>
                  @if (store.effectivePlayState() === 'RUNNING') {
                    <sc-button variant="secondary" (click)="simulatePlayExit()">
                      {{ 'diagnostics.fake_play.simulate_exit' | scTranslate }}
                    </sc-button>
                  }
                </div>
              }
            </section>
          }
        </div>
      </details>
    </div>

  `,
  styles: [
    `
      .page {
        width: 100%;
        max-width: none;
        display: flex;
        flex-direction: column;
        gap: var(--sc-home-gap, 1.25rem);
      }
      .page-head { display: flex; flex-direction: column; gap: var(--sc-space-2); }
      .page-head h1 {
        margin: 0;
        font-size: clamp(1.65rem, 2.6vw, 2rem);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.02em;
      }
      .page-lead {
        margin: 0;
        max-width: 40rem;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.45;
      }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--sc-home-gap, 1.25rem);
      }
      .status-card {
        padding: var(--sc-space-4) var(--sc-space-5);
        border-radius: var(--sc-radius-xl);
        border: 1px solid var(--sc-border-default);
        background: var(--sc-surface-1);
        box-shadow: var(--sc-shadow-card);
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
      }
      .status-card[data-tone='ok'] { border-color: rgba(46, 204, 113, 0.35); }
      .status-card[data-tone='warn'] { border-color: rgba(245, 158, 11, 0.4); }
      .status-card[data-tone='error'] { border-color: rgba(239, 68, 68, 0.4); }
      .status-label {
        margin: 0;
        font-size: var(--sc-text-xs);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--sc-text-muted);
      }
      .status-value {
        margin: 0;
        font-size: var(--sc-text-lg);
        font-weight: var(--sc-weight-semibold);
        color: var(--sc-text-primary);
      }
      .status-code {
        margin: 0;
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
      }
      .panel {
        padding: var(--sc-space-4) var(--sc-space-5);
        background: var(--sc-surface-1);
        border: 1px solid var(--sc-border-default);
        border-radius: var(--sc-radius-xl);
        box-shadow: var(--sc-shadow-card);
      }
      .panel h2, .dev-block h3 {
        margin: 0 0 var(--sc-space-1);
        font-size: var(--sc-text-lg);
        font-weight: var(--sc-weight-semibold);
      }
      .muted {
        margin: 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.45;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--sc-space-4);
        margin-bottom: var(--sc-space-3);
      }
      .preview {
        margin: var(--sc-space-3) 0 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
      }
      .error {
        color: var(--sc-text-danger, #f87171);
        font-size: var(--sc-text-sm);
      }
      .fold {
        border-radius: var(--sc-radius-xl);
        border: 1px solid var(--sc-border-default);
        background: var(--sc-surface-1);
        box-shadow: var(--sc-shadow-card);
        overflow: hidden;
      }
      .fold > summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: var(--sc-space-4) var(--sc-space-5);
        user-select: none;
      }
      .fold > summary::-webkit-details-marker { display: none; }
      .fold-title {
        font-size: var(--sc-text-lg);
        font-weight: var(--sc-weight-semibold);
        color: var(--sc-text-primary);
      }
      .fold-body { font-size: var(--sc-text-sm); color: var(--sc-text-secondary); }
      .fold-panel {
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-4);
        padding: 0 var(--sc-space-5) var(--sc-space-4);
        border-top: 1px solid var(--sc-border-subtle);
        padding-top: var(--sc-space-3);
      }
      .tech-grid {
        margin: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--sc-space-2) var(--sc-space-5);
      }
      .tech-grid > div {
        display: flex;
        justify-content: space-between;
        gap: var(--sc-space-3);
        font-size: var(--sc-text-sm);
        padding: 0.35rem 0;
        border-bottom: 1px solid var(--sc-border-subtle);
      }
      .tech-grid dt { color: var(--sc-text-secondary); }
      .tech-grid dd { margin: 0; text-align: right; color: var(--sc-text-primary); }
      .mono { font-family: var(--sc-font-mono); }
      .dev-block {
        padding: var(--sc-space-3) 0;
        border-top: 1px solid var(--sc-border-subtle);
      }
      .dev-block:first-child { border-top: none; padding-top: 0; }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-4);
        align-items: flex-end;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
        font-size: var(--sc-text-sm);
        color: var(--sc-text-secondary);
      }
      select {
        padding: var(--sc-space-2) var(--sc-space-3);
        background: var(--sc-surface-2);
        border: 1px solid var(--sc-border-default);
        border-radius: var(--sc-radius-md);
        color: var(--sc-text-primary);
        min-width: 12rem;
      }
      .last-applied {
        margin: 0;
        font-size: var(--sc-text-sm);
        color: var(--sc-text-muted);
        font-family: var(--sc-font-mono);
      }
      @media (max-width: 1100px) {
        /* Min window 1100×700: keep 3-col row; densify vertical padding/gaps. */
        .status-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--sc-space-2);
        }
        .status-card {
          padding: 0.45rem 0.65rem;
          gap: 0.1rem;
          border-radius: var(--sc-radius-lg);
        }
        .status-value {
          font-size: var(--sc-text-base);
          line-height: 1.15;
        }
        .status-label {
          letter-spacing: 0.04em;
          line-height: 1.1;
        }
        .status-code {
          line-height: 1.2;
        }
        .tech-grid { grid-template-columns: 1fr; }
        .page { gap: var(--sc-space-3); }
        .page-head { gap: var(--sc-space-1); }
        .page-head h1 { font-size: 1.45rem; }
      }
      @media (max-width: 720px) {
        /* Stacked status cards: compact vertical footprint. */
        .status-grid {
          grid-template-columns: 1fr;
          gap: var(--sc-space-1);
        }
        .status-card {
          flex-direction: row;
          flex-wrap: wrap;
          align-items: baseline;
          column-gap: var(--sc-space-3);
          row-gap: 0.1rem;
          padding: 0.4rem 0.65rem;
        }
        .status-label { flex: 0 0 auto; }
        .status-value { flex: 1 1 auto; }
        .status-code { flex: 0 0 100%; }
      }

    `,
  ],
})
export class DiagnosticsPageComponent implements OnInit {
  protected readonly store = inject(AppStore);
  protected readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);
  private readonly notifications = inject(NotificationsService);
  protected readonly auth = inject(AuthActionsService);
  protected readonly install = inject(InstallActionsService);
  protected readonly play = inject(PlayActionsService);

  readonly readinessOptions = READINESS_OPTIONS;
  readonly authOptions = AUTH_OPTIONS;
  readonly fakeFixtures = FAKE_AUTH_FIXTURE_IDS;
  readonly fakeInstallFixtures = FAKE_INSTALL_FIXTURE_IDS;
  readonly fakePlayFixtures = FAKE_PLAY_FIXTURE_IDS;

  readonly diagnostics = signal<SafeDiagnosticsDto | null>(null);
  readonly diagError = signal<string | null>(null);
  readonly copyBusy = signal(false);

  readonly selectedReadiness = signal<LauncherReadiness>('NOT_INSTALLED');
  readonly selectedAuth = signal<AuthState>('SIGNED_OUT');

  /** Single source of truth for dropdown + Apply. Defaults to SUCCESS (matches FakeAuthBackend). */
  private readonly fixtureForm = signal<FakeAuthFixtureFormState>(
    createFakeAuthFixtureFormState(DEFAULT_FAKE_AUTH_FIXTURE),
  );

  private readonly installFixtureForm = signal<FakeInstallFixtureFormState>(
    createFakeInstallFixtureFormState(DEFAULT_FAKE_INSTALL_FIXTURE),
  );

  private readonly playFixtureForm = signal<FakePlayFixtureFormState>(
    createFakePlayFixtureFormState(DEFAULT_FAKE_PLAY_FIXTURE),
  );

  readonly selectedFixture = computed(() => this.fixtureForm().selectedFixture);
  readonly lastAppliedFixture = computed(() => this.fixtureForm().lastAppliedFixture);
  readonly selectedInstallFixture = computed(() => this.installFixtureForm().selectedFixture);
  readonly lastAppliedInstallFixture = computed(
    () => this.installFixtureForm().lastAppliedFixture,
  );
  readonly selectedPlayFixture = computed(() => this.playFixtureForm().selectedFixture);
  readonly lastAppliedPlayFixture = computed(() => this.playFixtureForm().lastAppliedFixture);

  readonly isDevGateway = computed(() => this.gateway.kind === 'dev');

  readonly fakeAuthHarness = computed(
    () => this.store.info()?.features?.fakeAuthHarness === true,
  );

  readonly fakeInstallHarness = computed(
    () => this.store.info()?.features?.fakeInstallHarness === true,
  );

  readonly fakePlayHarness = computed(
    () => this.store.info()?.features?.fakePlayHarness === true,
  );

  /** Production packaged: no fake / demo controls. */
  readonly showDevTools = computed(
    () =>
      this.isDevGateway() ||
      this.fakeAuthHarness() ||
      this.fakeInstallHarness() ||
      this.fakePlayHarness() ||
      this.store.info()?.environment === 'development',
  );

  readonly previewAction = computed(() =>
    mapPrimaryAction(this.store.effectiveReadiness(), this.store.effectiveAuthState(), {
      activeOperation: this.store.effectiveActiveOperation(),
      installBusy: this.install.isBusy(),
      playState: this.store.effectivePlayState(),
      playBusy: this.play.isBusy(),
    }),
  );

  readonly installLabelKey = computed(() =>
    resolveReadinessLabelKey(this.store.effectiveReadiness()),
  );
  readonly authLabelKey = computed(() =>
    resolveAuthLabelKey(this.store.effectiveAuthState()),
  );
  readonly playLabelKey = computed(() =>
    resolvePlayLabelKey(this.store.effectivePlayState()),
  );
  readonly installTone = computed(() =>
    resolveReadinessTone(this.store.effectiveReadiness()),
  );
  readonly accountTone = computed(() =>
    resolveAuthTone(this.store.effectiveAuthState()),
  );
  readonly launchTone = computed(() =>
    resolvePlayTone(this.store.effectivePlayState()),
  );
  readonly installCode = computed(() => this.store.effectiveReadiness());
  readonly authCode = computed(() => this.store.effectiveAuthState());
  readonly playCode = computed(() => this.store.effectivePlayState());

  ngOnInit(): void {
    void this.refreshDiagnostics();
  }

  async refreshDiagnostics(): Promise<void> {
    this.diagError.set(null);
    try {
      const dto = await this.gateway.diagnostics.get();
      this.diagnostics.set(dto);
    } catch {
      this.diagError.set('diagnostics.error.load');
      this.diagnostics.set(null);
    }
  }

  async copyDiagnostics(): Promise<void> {
    if (this.copyBusy()) return;
    this.copyBusy.set(true);
    try {
      await this.gateway.diagnostics.copy();
      await this.refreshDiagnostics();
      this.notifications.show('diagnostics.copy.success', 'success');
    } catch {
      this.notifications.show('diagnostics.copy.error', 'error');
    } finally {
      this.copyBusy.set(false);
    }
  }

  onReadinessChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as LauncherReadiness;
    this.selectedReadiness.set(value);
  }

  onAuthChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as AuthState;
    this.selectedAuth.set(value);
  }

  onFixtureChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.fixtureForm.update((s) => selectFakeAuthFixture(s, raw));
  }

  onInstallFixtureChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.installFixtureForm.update((s) => selectFakeInstallFixture(s, raw));
  }

  onPlayFixtureChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.playFixtureForm.update((s) => selectFakePlayFixture(s, raw));
  }

  /** Test/helper: set selection without DOM (authoritative model). */
  setSelectedFixtureForTests(fixture: FakeAuthFixtureId): void {
    this.fixtureForm.update((s) => selectFakeAuthFixture(s, fixture));
  }

  /** Value that Apply will send — component state only. */
  fixtureToSubmit(): FakeAuthFixtureId {
    return fixturePayloadToApply(this.fixtureForm());
  }

  installFixtureToSubmit(): FakeInstallFixtureId {
    return installFixturePayloadToApply(this.installFixtureForm());
  }

  setSelectedInstallFixtureForTests(fixture: FakeInstallFixtureId): void {
    this.installFixtureForm.update((s) => selectFakeInstallFixture(s, fixture));
  }

  playFixtureToSubmit(): FakePlayFixtureId {
    return playFixturePayloadToApply(this.playFixtureForm());
  }

  setSelectedPlayFixtureForTests(fixture: FakePlayFixtureId): void {
    this.playFixtureForm.update((s) => selectFakePlayFixture(s, fixture));
  }

  applyDemo(): void {
    const dev = getDevGatewayInstance(this.gateway) as DevLauncherDesktopGateway | null;
    if (!dev) {
      return;
    }

    dev.setDemoReadiness(this.selectedReadiness());
    dev.setDemoAuthState(this.selectedAuth());

    this.store.applyDemoFixture({
      readiness: this.selectedReadiness(),
      authState: this.selectedAuth(),
    });
  }

  async applyFakeFixture(): Promise<void> {
    if (!this.gateway.dev?.setAuthFixture) return;
    const fixture = this.fixtureToSubmit();
    if (!isFakeAuthFixtureId(fixture)) {
      this.notifications.show('error.ipc_invalid', 'error');
      return;
    }
    try {
      await this.gateway.dev.setAuthFixture(fixture);
      this.fixtureForm.update((s) => markFakeAuthFixtureApplied(s, fixture));
      this.notifications.show(
        fakeAuthFixtureAppliedMessageKey(),
        'info',
        undefined,
        fakeAuthFixtureAppliedParams(fixture),
      );
    } catch {
      this.notifications.show('error.ipc_invalid', 'error');
    }
  }

  async applyFakeInstallFixture(): Promise<void> {
    if (!this.gateway.dev?.setInstallFixture) return;
    const fixture = this.installFixtureToSubmit();
    if (!isFakeInstallFixtureId(fixture)) {
      this.notifications.show('error.ipc_invalid', 'error');
      return;
    }
    try {
      await this.gateway.dev.setInstallFixture(fixture);
      this.installFixtureForm.update((s) => markFakeInstallFixtureApplied(s, fixture));
      const status = await this.gateway.install.getStatus();
      this.store.applyInstallStatus(status);
      this.notifications.show(
        fakeInstallFixtureAppliedMessageKey(),
        'info',
        undefined,
        fakeInstallFixtureAppliedParams(fixture),
      );
    } catch {
      this.notifications.show('error.ipc_invalid', 'error');
    }
  }

  async applyFakePlayFixture(): Promise<void> {
    if (!this.gateway.dev?.setPlayFixture) return;
    const fixture = this.playFixtureToSubmit();
    if (!isFakePlayFixtureId(fixture)) {
      this.notifications.show('error.ipc_invalid', 'error');
      return;
    }
    try {
      await this.gateway.dev.setPlayFixture(fixture);
      this.playFixtureForm.update((s) => markFakePlayFixtureApplied(s, fixture));
      const status = await this.gateway.play.getStatus();
      this.store.applyPlayStatus(status);
      this.notifications.show(
        fakePlayFixtureAppliedMessageKey(),
        'info',
        undefined,
        fakePlayFixtureAppliedParams(fixture),
      );
    } catch {
      this.notifications.show('error.ipc_invalid', 'error');
    }
  }

  async simulatePlayExit(): Promise<void> {
    if (!this.gateway.dev?.simulatePlayExit) return;
    try {
      const status = await this.gateway.dev.simulatePlayExit({ exitCode: 0 });
      this.store.applyPlayStatus(status);
      this.notifications.show('play.message.exited', 'info');
    } catch {
      this.notifications.show('error.play.generic', 'error');
    }
  }
}
