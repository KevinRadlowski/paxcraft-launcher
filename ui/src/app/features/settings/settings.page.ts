import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  FixedDiskDto,
  FixedDiskInventoryDto,
  StorageSummaryDto,
  SystemInfoDto,
} from '@sweetcraft/ipc';
import { DESKTOP_PRODUCT_NAME, DESKTOP_PRODUCT_VERSION } from '@sweetcraft/product';
import { LAUNCHER_DESKTOP_GATEWAY } from '../../core/desktop-api/gateway';
import { AppStore } from '../../core/state/app.store';
import { SettingsActionsService } from '../../core/services/settings-actions.service';
import { NotificationsService } from '../../core/services/notifications.service';
import { ModalService } from '../../core/services/modal.service';
import { SWEETCRAFT_WEBSITE_URL } from '../../core/product-links';
import { ScHeroComponent } from '../../shared/components/hero/hero.component';
import { ScButtonComponent } from '../../shared/components/button/button.component';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import { HomeServerStatusService } from '../home/home-server-status.service';
import { SETTINGS_ASSETS } from './settings-assets';
import {
  MEMORY_DEFAULT,
  MEMORY_MAX,
  MEMORY_MIN,
  MEMORY_STEP,
  METRIC_RING_RADIUS,
  clampMemory,
  formatDiskFreeSurTotal as formatDiskFreeSurTotalLabel,
  formatMemoryLabel,
  memoryUsedPercent,
  ringStrokeDasharray,
} from './settings-memory';
import {
  DISK_POLL_INTERVAL_MS,
  SYSTEM_POLL_INTERVAL_MS,
  SettingsSystemPoller,
} from './settings-system-poller';
const SITE_URL = SWEETCRAFT_WEBSITE_URL;
@Component({
  selector: 'sc-settings-page',
  standalone: true,
  imports: [FormsModule, ScHeroComponent, ScButtonComponent, ScTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="settings-page">
      <div
        data-testid="settings-assets"
        hidden
        [attr.data-hero]="assets.hero"
        [attr.data-about]="assets.about"
        [attr.data-banner]="assets.banner"
      ></div>
      <sc-hero [imageUrl]="assets.hero">
        <h1 class="hero-title">{{ 'settings.title' | scTranslate }}</h1>
        <p class="hero-script sc-script">{{ 'settings.hero.subtitle' | scTranslate }}</p>
        <p class="hero-body">{{ 'settings.hero.body' | scTranslate }}</p>
      </sc-hero>
      <section class="cards row1" [attr.aria-label]="'settings.aria.row1' | scTranslate">
        <!-- Memory + Performance -->
        <article class="card card-memory" data-testid="settings-memory-card">
          <header class="card-head">
            <div class="card-icon memory" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M2 7h2v10H2V7zm4 0h2v10H6V7zm4-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm14 2h2v10h-2V7z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'settings.card.memory.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'settings.card.memory.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            @if (memoryDirty()) {
              <p class="memory-saved">
                {{ 'settings.memory.saved' | scTranslate }}
                <span class="mono">{{ persistedMemoryLabel() }}</span>
              </p>
            }
            <div class="memory-value" aria-live="polite">{{ memoryLabel() }}</div>
            <div class="slider-meta">
              <span>{{ memoryMin }} Mo</span>
              <span>{{ memoryMax }} Mo</span>
            </div>
            <input
              id="memory-slider"
              type="range"
              class="memory-slider"
              [min]="memoryMin"
              [max]="memoryMax"
              [step]="memoryStep"
              [ngModel]="draftMemory()"
              (ngModelChange)="onMemoryDraft($event)"
              [disabled]="settingsBusy()"
              [attr.aria-valuemin]="memoryMin"
              [attr.aria-valuemax]="memoryMax"
              [attr.aria-valuenow]="draftMemory()"
              [attr.aria-valuetext]="memoryLabel()"
              [attr.aria-label]="'settings.memory' | scTranslate"
            />
            @if (recommendedLabel(); as rec) {
              <p class="advisory" role="status">
                <span class="advisory-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="currentColor"
                      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
                    />
                  </svg>
                </span>
                <span>
                  {{ 'settings.memory.recommend' | scTranslate }}
                  <strong>{{ rec }}</strong>
                </span>
              </p>
            }
            <p class="hint">{{ 'settings.memory.hint' | scTranslate }}</p>
            @if (gameRunning()) {
              <p class="hint next" role="status">
                {{ 'settings.memory.next_launch' | scTranslate }}
              </p>
            }
          </div>
          <div class="card-foot" [class.dirty]="memoryDirty()">
            <sc-button
              variant="primary"
              [disabled]="!memoryDirty() || settingsBusy()"
              (clicked)="saveMemory()"
            >
              {{ 'settings.save' | scTranslate }}
            </sc-button>
            <sc-button
              variant="ghost"
              [disabled]="settingsBusy() || draftMemory() === memoryDefault"
              (clicked)="resetMemory()"
            >
              {{ 'settings.memory.reset' | scTranslate }}
            </sc-button>
          </div>
        </article>
        <!-- Interface -->
        <article class="card card-interface" data-testid="settings-interface-card">
          <header class="card-head">
            <div class="card-icon interface" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M4 4h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'settings.card.interface.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'settings.card.interface.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            <div class="row readonly">
              <span>{{ 'settings.interface.mode' | scTranslate }}</span>
              <span class="pill">{{ 'settings.interface.mode_value' | scTranslate }}</span>
            </div>
            <div class="row readonly">
              <span>{{ 'settings.language' | scTranslate }}</span>
              <span class="pill">{{ 'settings.language.value' | scTranslate }}</span>
            </div>
            @if (environmentLabelKey(); as envKey) {
              <div class="row readonly">
                <span>{{ 'settings.interface.environment' | scTranslate }}</span>
                <span class="pill">{{ envKey | scTranslate }}</span>
              </div>
            }
            <label class="toggle-row" for="reduced-motion">
              <span class="toggle-copy">
                <span class="toggle-title">{{ 'settings.reduced_motion' | scTranslate }}</span>
                <span class="toggle-hint">{{ 'settings.reduced_motion.hint' | scTranslate }}</span>
              </span>
              <span class="switch">
                <input
                  id="reduced-motion"
                  type="checkbox"
                  role="switch"
                  [ngModel]="reducedMotion()"
                  (ngModelChange)="onReducedMotion($event)"
                  [disabled]="settingsBusy()"
                />
                <span class="slider" aria-hidden="true"></span>
              </span>
            </label>
            <p class="info-panel">{{ 'settings.interface.panel' | scTranslate }}</p>
          </div>
        </article>
        <!-- System info -->
        <article class="card card-system" data-testid="settings-system-card">
          <header class="card-head">
            <div class="card-icon system" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M4 6h16v10H4V6zm0 12h7v2H4v-2zm9 0h7v2h-7v-2zM2 4v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4H2z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'settings.card.system.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'settings.card.system.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            @if (systemLoading()) {
              <p class="hint">{{ 'settings.system.loading' | scTranslate }}</p>
            } @else if (!systemInfo()?.available) {
              <p class="hint" role="status">{{ 'settings.system.unavailable' | scTranslate }}</p>
            } @else {
              <div class="metric-rings" role="group" [attr.aria-label]="'settings.system.metrics' | scTranslate">
                @if (ramUsedPercent(); as ramPct) {
                  <div class="metric" [attr.aria-label]="('settings.system.ram_used' | scTranslate) + ' ' + ramPct + '%'">
                    <svg class="metric-svg" viewBox="0 0 80 80" aria-hidden="true">
                      <circle class="ring-track-svg" cx="40" cy="40" [attr.r]="ringRadius" />
                      <circle
                        class="ring-fill-svg ram"
                        cx="40"
                        cy="40"
                        [attr.r]="ringRadius"
                        [attr.stroke-dasharray]="ramRingDash()"
                      />
                    </svg>
                    <div class="metric-copy">
                      <span class="metric-pct mono">{{ ramPct }}%</span>
                      <span class="metric-label">{{ 'settings.system.ram_used' | scTranslate }}</span>
                    </div>
                  </div>
                }
                @if (sweetCraftDisk(); as scDisk) {
                  <div
                    class="metric"
                    data-testid="settings-sweetcraft-drive-ring"
                    [attr.aria-label]="('settings.system.sweetcraft_drive' | scTranslate) + ' ' + scDisk.usedPercent + '%'"
                  >
                    <svg class="metric-svg" viewBox="0 0 80 80" aria-hidden="true">
                      <circle class="ring-track-svg" cx="40" cy="40" [attr.r]="ringRadius" />
                      <circle
                        class="ring-fill-svg disk"
                        cx="40"
                        cy="40"
                        [attr.r]="ringRadius"
                        [attr.stroke-dasharray]="diskRingDash(scDisk.usedPercent)"
                      />
                    </svg>
                    <div class="metric-copy">
                      <span class="metric-pct mono">{{ scDisk.usedPercent }}%</span>
                      <span class="metric-label">{{ 'settings.system.sweetcraft_drive' | scTranslate }}</span>
                      <span class="metric-drive mono">{{ scDisk.drive }}</span>
                    </div>
                  </div>
                }
              </div>
              @if (fixedDisks().length) {
                <div class="storage-block" data-testid="settings-storage-list">
                  <p class="config-title">{{ 'settings.system.storage' | scTranslate }}</p>
                  <ul class="disk-list">
                    @for (d of fixedDisks(); track d.drive) {
                      <li class="disk-row" [attr.data-drive]="d.drive" [attr.data-sweetcraft]="d.isSweetCraftDrive">
                        <div class="disk-row-head">
                          <span class="disk-letter mono">{{ d.drive }}</span>
                          @if (d.isSweetCraftDrive) {
                            <span class="sc-pill">{{ 'settings.system.sweetcraft_pill' | scTranslate }}</span>
                          }
                          <span class="disk-pct mono">{{
                            'settings.system.used_pct' | scTranslate: { pct: d.usedPercent }
                          }}</span>
                        </div>
                        <div class="disk-bar" role="presentation">
                          <div class="disk-bar-fill" [style.width.%]="d.usedPercent"></div>
                        </div>
                        <div class="disk-free mono">
                          {{ formatDiskFreeSurTotal(d.freeGiB, d.totalGiB) }}
                        </div>
                      </li>
                    }
                  </ul>
                </div>
              }
              <p class="config-title">{{ 'settings.system.config' | scTranslate }}</p>
              <dl class="meta">
                @if (systemInfo()?.osLabel; as os) {
                  <div>
                    <dt>{{ 'settings.system.os' | scTranslate }}</dt>
                    <dd>{{ os }}</dd>
                  </div>
                }
                <div>
                  <dt>{{ 'settings.system.platform' | scTranslate }}</dt>
                  <dd class="mono">{{ systemInfo()?.platform }} / {{ systemInfo()?.arch }}</dd>
                </div>
                @if (systemInfo()?.cpuModel; as cpu) {
                  <div>
                    <dt>{{ 'settings.system.cpu' | scTranslate }}</dt>
                    <dd>
                      {{ cpu }}@if (systemInfo()?.cpuCount; as n) {
                        <span class="muted-inline"> · {{ n }}</span>
                      }
                    </dd>
                  </div>
                }
                @if (systemInfo()?.totalMemoryMiB != null) {
                  <div>
                    <dt>{{ 'settings.system.ram' | scTranslate }}</dt>
                    <dd class="mono">{{ formatMiB(systemInfo()!.totalMemoryMiB!) }}</dd>
                  </div>
                }
              </dl>
            }
          </div>
          <div class="card-foot">
            <sc-button variant="secondary" [disabled]="systemLoading()" (clicked)="refreshSystem()">
              {{ 'settings.system.refresh' | scTranslate }}
            </sc-button>
          </div>
        </article>
      </section>
      <section class="cards row2" [attr.aria-label]="'settings.aria.row2' | scTranslate">
        <!-- Network / Server -->
        <article class="card card-network" data-testid="settings-network-card">
          <header class="card-head">
            <div class="card-icon network" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 14.93V19h-2v-2.07A8.001 8.001 0 0 1 4.07 11H6v2H4.07A8.001 8.001 0 0 1 11 4.07V6h2V4.07A8.001 8.001 0 0 1 19.93 11H18v2h1.93A8.001 8.001 0 0 1 13 16.93z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'settings.card.network.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'settings.card.network.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            <div class="server-brand">
              <div class="server-name">SweetCraft</div>
              <div class="mono server-addr">{{ serverAddress }}</div>
            </div>
            <div class="status-pill" [attr.data-state]="serverStatus().state">
              <span class="dot" aria-hidden="true"></span>
              <span>{{ serverStateKey() | scTranslate }}</span>
            </div>
            <div class="telemetry-grid">
              @if (serverStatus().playersOnline != null && serverStatus().playersMax != null) {
                <div class="telemetry-tile">
                  <span class="telemetry-label">{{ 'settings.network.players' | scTranslate }}</span>
                  <span class="telemetry-value mono"
                    >{{ serverStatus().playersOnline }} / {{ serverStatus().playersMax }}</span
                  >
                </div>
              }
              @if (serverStatus().latencyMs != null) {
                <div class="telemetry-tile">
                  <span class="telemetry-label">{{ 'settings.network.latency' | scTranslate }}</span>
                  <span class="telemetry-value mono">{{ serverStatus().latencyMs }} ms</span>
                </div>
              }
              @if (serverStatus().versionLabel; as ver) {
                <div class="telemetry-tile">
                  <span class="telemetry-label">{{ 'settings.network.version' | scTranslate }}</span>
                  <span class="telemetry-value mono">{{ ver }}</span>
                </div>
              }
            </div>
          </div>
          <div class="card-foot">
            <sc-button
              variant="secondary"
              [disabled]="serverLoading()"
              (clicked)="refreshServer()"
            >
              {{ 'settings.network.refresh' | scTranslate }}
            </sc-button>
            <a class="site-btn" [href]="siteUrl" target="_blank" rel="noopener noreferrer">
              {{ 'settings.network.site' | scTranslate }}
            </a>
          </div>
        </article>
        <article class="card card-location" data-testid="settings-location-card">
          <header class="card-head">
            <div class="card-icon data" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'settings.location.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'settings.location.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            <p class="config-title">{{ 'settings.location.current' | scTranslate }}</p>
            <p class="mono path-line" data-testid="settings-instance-path">
              {{ instancePathLabel() }}
            </p>
            @if (instanceLocationUnavailable()) {
              <p class="hint warn" role="alert">{{ 'settings.location.unavailable' | scTranslate }}</p>
            }
            @if (locationBusy()) {
              <p class="hint" role="status">{{ 'settings.location.moving' | scTranslate }}</p>
            }
            <p class="hint">{{ 'settings.location.not_app' | scTranslate }}</p>
          </div>
          <div class="card-foot">
            <sc-button
              variant="secondary"
              [disabled]="locationBusy() || settingsBusy()"
              (clicked)="modifyInstanceLocation()"
            >
              {{ 'settings.location.modify' | scTranslate }}
            </sc-button>
            <sc-button
              variant="ghost"
              [disabled]="!storageSummary()?.instanceAvailable || storageBusy()"
              (clicked)="openInstance()"
            >
              {{ 'settings.location.open' | scTranslate }}
            </sc-button>
          </div>
        </article>
        <!--
          Storage open buttons:
          Root cause (0.6F.4 V2): [disabled]="!storageSummary()?.instanceAvailable"
          because getStorageSummary sets instanceAvailable = fs.existsSync(INSTANCE_ROOT).
          Fake install does NOT create a real INSTANCE_ROOT -> buttons correctly disabled
          when no install. UX fix: show settings.data.unavailable_install when disabled.
          Do NOT fake-enable when path missing. Do NOT create real instance just for testing.
        -->
        <article class="card card-data" data-testid="settings-data-card">
          <header class="card-head">
            <div class="card-icon data" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'settings.card.data.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'settings.card.data.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            <ul class="folder-list">
              <li>
                <div class="folder-meta">
                  <span class="folder-label">{{ 'settings.data.instance' | scTranslate }}</span>
                  <span
                    class="status-avail"
                    [attr.data-avail]="storageSummary()?.instanceAvailable === true"
                  >
                    {{
                      (storageSummary()?.instanceAvailable
                        ? 'settings.data.available'
                        : 'settings.data.unavailable'
                      ) | scTranslate
                    }}
                  </span>
                  @if (!storageSummary()?.instanceAvailable) {
                    <span class="folder-hint">{{ 'settings.data.unavailable_install' | scTranslate }}</span>
                  }
                </div>
                <sc-button
                  variant="ghost"
                  size="sm"
                  [disabled]="!storageSummary()?.instanceAvailable || storageBusy()"
                  (clicked)="openInstance()"
                >
                  {{ 'settings.data.open' | scTranslate }}
                </sc-button>
              </li>
              <li>
                <div class="folder-meta">
                  <span class="folder-label">{{ 'settings.data.logs' | scTranslate }}</span>
                  <span
                    class="status-avail"
                    [attr.data-avail]="storageSummary()?.logsAvailable === true"
                  >
                    {{
                      (storageSummary()?.logsAvailable
                        ? 'settings.data.available'
                        : 'settings.data.unavailable'
                      ) | scTranslate
                    }}
                  </span>
                  @if (!storageSummary()?.logsAvailable) {
                    <span class="folder-hint">{{ 'settings.data.unavailable_install' | scTranslate }}</span>
                  }
                </div>
                <sc-button
                  variant="ghost"
                  size="sm"
                  [disabled]="!storageSummary()?.logsAvailable || storageBusy()"
                  (clicked)="openLogs()"
                >
                  {{ 'settings.data.open' | scTranslate }}
                </sc-button>
              </li>
            </ul>
            <p class="hint">{{ 'settings.data.hint' | scTranslate }}</p>
          </div>
        </article>
        <!-- About -->
        <article class="card card-about" data-testid="settings-about-card">
          <header class="card-head">
            <div class="card-icon about" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
                />
              </svg>
            </div>
            <div>
              <h2 class="about-title">{{ 'settings.card.about.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'settings.card.about.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            <div
              class="about-art"
              [style.background-image]="'url(' + assets.about + ')'"
              role="img"
              [attr.aria-label]="'settings.about.art_alt' | scTranslate"
            ></div>
            <dl class="meta">
              <div>
                <dt>{{ 'settings.about.product' | scTranslate }}</dt>
                <dd>{{ productName }}</dd>
              </div>
              <div>
                <dt>{{ 'settings.about.version' | scTranslate }}</dt>
                <dd><span class="version-badge mono">{{ productVersion }}</span></dd>
              </div>
              @if (aboutBuildId(); as buildId) {
                <div data-testid="settings-about-build-id">
                  <dt>{{ 'settings.about.build_id' | scTranslate }}</dt>
                  <dd><span class="mono">{{ buildId }}</span></dd>
                </div>
              }
              <div>
                <dt>{{ 'settings.about.publisher' | scTranslate }}</dt>
                <dd>{{ 'settings.about.publisher_value' | scTranslate }}</dd>
              </div>
              <div>
                <dt>{{ 'settings.about.brand' | scTranslate }}</dt>
                <dd>{{ 'settings.about.brand_value' | scTranslate }}</dd>
              </div>
              @if (status()?.minecraftVersion; as mc) {
                <div>
                  <dt>{{ 'settings.about.minecraft' | scTranslate }}</dt>
                  <dd class="mono">{{ mc }}</dd>
                </div>
              }
              @if (status()?.fabricVersion; as fab) {
                <div>
                  <dt>{{ 'settings.about.fabric' | scTranslate }}</dt>
                  <dd class="mono">{{ fab }}</dd>
                </div>
              }
              @if (status()?.installedVersion || status()?.packVersion; as pack) {
                <div>
                  <dt>{{ 'settings.about.pack' | scTranslate }}</dt>
                  <dd class="mono">{{ pack }}</dd>
                </div>
              }
            </dl>
          </div>
          <div class="card-foot">
            <a class="site-btn" [href]="siteUrl" target="_blank" rel="noopener noreferrer">
              {{ 'settings.about.site' | scTranslate }}
            </a>
          </div>
        </article>
      </section>
      <section class="banner" data-testid="settings-banner" [attr.aria-label]="'settings.banner.title' | scTranslate">
        <div
          class="banner-art"
          [style.background-image]="'url(' + assets.banner + ')'"
          aria-hidden="true"
        ></div>
        <div class="banner-copy">
          <h2>{{ 'settings.banner.title' | scTranslate }}</h2>
          <p>{{ 'settings.banner.body' | scTranslate }}</p>
          <p class="banner-quote sc-script" aria-hidden="true">
            {{ 'settings.banner.quote' | scTranslate }}
          </p>
          <a class="site-btn" [href]="siteUrl" target="_blank" rel="noopener noreferrer">
            {{ 'settings.banner.cta' | scTranslate }}
          </a>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: var(--sc-home-gap, 1.25rem);
        position: relative;
      }
      :host ::ng-deep sc-hero {
        min-height: clamp(18rem, 34vh, 23rem);
      }
      :host ::ng-deep sc-hero .content {
        padding-bottom: clamp(3.5rem, 10vh, 5.5rem);
      }
      .hero-title {
        margin: 0;
        font-size: clamp(2rem, 4vw, 2.75rem);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.03em;
      }
      .hero-script {
        margin: var(--sc-space-3) 0 0;
        font-size: var(--sc-text-lg);
        color: #f5d0fe;
        letter-spacing: 0.01em;
      }
      .hero-body {
        margin: var(--sc-space-3) 0 0;
        max-width: 34rem;
        color: var(--sc-text-secondary);
        line-height: 1.5;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--sc-home-gap, 1.25rem);
        align-items: start; /* prevent equal-height stretch */
      }
      .card {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-3);
        min-height: 16rem;
        align-self: start;
        padding: var(--sc-space-4) var(--sc-space-5);
        border-radius: var(--sc-radius-xl);
        border: 1px solid rgba(196, 181, 253, 0.14);
        background: rgba(18, 18, 28, 0.9);
        box-shadow: var(--sc-shadow-card);
      }
      .card::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .card-memory::before {
        background: radial-gradient(ellipse 80% 55% at 0% 0%, rgba(56, 189, 248, 0.14), transparent 55%);
      }
      .card-interface::before {
        background: radial-gradient(ellipse 80% 55% at 100% 0%, rgba(192, 132, 252, 0.14), transparent 55%);
      }
      .card-system::before {
        background: radial-gradient(ellipse 80% 55% at 50% 100%, rgba(245, 158, 11, 0.1), transparent 55%);
      }
      .card-network::before {
        background:
          radial-gradient(ellipse 90% 60% at 0% 0%, rgba(46, 204, 113, 0.16), transparent 55%),
          radial-gradient(ellipse 70% 50% at 100% 100%, rgba(56, 189, 248, 0.08), transparent 60%);
      }
      .card-data::before {
        background: radial-gradient(ellipse 80% 55% at 100% 0%, rgba(217, 27, 181, 0.12), transparent 55%);
      }
      .card-about::before {
        background:
          radial-gradient(ellipse 90% 60% at 50% 0%, rgba(138, 27, 217, 0.22), transparent 55%),
          radial-gradient(ellipse 60% 40% at 100% 100%, rgba(217, 27, 181, 0.12), transparent 60%);
      }
      .card-head {
        display: flex;
        gap: var(--sc-space-3);
        align-items: flex-start;
        position: relative;
      }
      .card-icon {
        width: 2.25rem;
        height: 2.25rem;
        border-radius: var(--sc-radius-md);
        display: grid;
        place-items: center;
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(196, 181, 253, 0.18);
        color: #e9d5ff;
      }
      .card-head h2 {
        margin: 0;
        font-size: var(--sc-text-lg);
        font-weight: var(--sc-weight-semibold);
      }
      .about-title {
        font-size: clamp(1.15rem, 1.8vw, 1.35rem) !important;
        font-weight: var(--sc-weight-bold) !important;
        letter-spacing: -0.02em;
      }
      .card-body {
        margin: 0.25rem 0 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.45;
      }
      .card-main {
        flex: 0 1 auto; /* stop swallowing empty space */
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-3);
        min-height: 0;
        position: relative;
      }
      .card-foot {
        margin-top: var(--sc-space-2); /* NOT auto — buttons stay under content */
        padding-top: 0;
        position: relative;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sc-space-2);
      }
      .card-foot.dirty {
        gap: var(--sc-space-3);
      }
      .memory-saved {
        margin: 0;
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
        line-height: 1.35;
      }
      .memory-value {
        font-family: var(--sc-font-mono);
        font-size: clamp(1.55rem, 2.4vw, 1.95rem);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.02em;
        color: var(--sc-text-primary);
        line-height: 1.15;
      }
      .slider-meta {
        display: flex;
        justify-content: space-between;
        font-size: var(--sc-text-xs);
        color: rgba(148, 163, 184, 0.72);
      }
      .memory-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 0.45rem;
        border-radius: 999px;
        background: linear-gradient(90deg, #d91bb5 0%, #c084fc 48%, #a855f7 100%);
        outline: none;
        cursor: pointer;
      }
      .memory-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 1.15rem;
        height: 1.15rem;
        border-radius: 50%;
        background: #f5d0fe;
        border: 2px solid #e879f9;
        box-shadow: 0 0 0 3px rgba(217, 27, 181, 0.22), 0 0 14px rgba(217, 27, 181, 0.55);
        cursor: pointer;
      }
      .memory-slider::-moz-range-thumb {
        width: 1.15rem;
        height: 1.15rem;
        border-radius: 50%;
        background: #f5d0fe;
        border: 2px solid #e879f9;
        box-shadow: 0 0 0 3px rgba(217, 27, 181, 0.22), 0 0 14px rgba(217, 27, 181, 0.55);
        cursor: pointer;
      }
      .memory-slider:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .memory-slider:focus-visible {
        outline: 2px solid rgba(192, 132, 252, 0.85);
        outline-offset: 4px;
      }
      .advisory {
        margin: 0;
        display: flex;
        gap: 0.55rem;
        align-items: flex-start;
        padding: 0.6rem 0.75rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(168, 85, 247, 0.35);
        border-left: 3px solid #f59e0b;
        background: linear-gradient(
          120deg,
          rgba(168, 85, 247, 0.1),
          rgba(245, 158, 11, 0.06)
        );
        font-size: var(--sc-text-sm);
        color: var(--sc-text-secondary);
        line-height: 1.4;
      }
      .advisory-icon {
        flex-shrink: 0;
        color: #fbbf24;
        margin-top: 0.05rem;
      }
      .advisory strong {
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-semibold);
      }
      .hint {
        margin: 0;
        font-size: var(--sc-text-sm);
        color: var(--sc-text-muted);
        line-height: 1.45;
      }
      .hint.next {
        color: var(--sc-text-accent);
      }
      .info-panel {
        margin: 0;
        padding: 0.65rem 0.75rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.14);
        background: rgba(255, 255, 255, 0.03);
        font-size: var(--sc-text-xs);
        color: var(--sc-text-secondary);
        line-height: 1.45;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sc-space-3);
        font-size: var(--sc-text-sm);
      }
      .pill {
        padding: 0.2rem 0.55rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.22);
        background: rgba(255, 255, 255, 0.04);
        font-size: var(--sc-text-xs);
        color: var(--sc-text-primary);
      }
      .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sc-space-3);
        padding: 0.65rem 0.75rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.12);
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
      }
      .toggle-copy {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        min-width: 0;
      }
      .toggle-title {
        font-size: var(--sc-text-sm);
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
      }
      .toggle-hint {
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
        line-height: 1.35;
      }
      .switch {
        position: relative;
        width: 2.6rem;
        height: 1.45rem;
        flex-shrink: 0;
      }
      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
        position: absolute;
      }
      .switch .slider {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(196, 181, 253, 0.25);
        transition: background 160ms ease;
      }
      .switch .slider::before {
        content: '';
        position: absolute;
        width: 1.05rem;
        height: 1.05rem;
        left: 0.15rem;
        top: 50%;
        transform: translateY(-50%);
        border-radius: 50%;
        background: #e9d5ff;
        transition: transform 160ms ease;
      }
      .switch input:checked + .slider {
        background: rgba(192, 132, 252, 0.45);
        border-color: rgba(192, 132, 252, 0.55);
      }
      .switch input:checked + .slider::before {
        transform: translate(1.15rem, -50%);
      }
      .switch input:focus-visible + .slider {
        outline: 2px solid rgba(192, 132, 252, 0.85);
        outline-offset: 2px;
      }
      .metric-rings {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--sc-space-3);
      }
      .metric {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        min-width: 0;
      }
      .metric-svg {
        width: 3.35rem;
        height: 3.35rem;
        flex-shrink: 0;
        transform: rotate(-90deg);
      }
      .ring-track-svg {
        fill: none;
        stroke: rgba(255, 255, 255, 0.1);
        stroke-width: 6;
      }
      .ring-fill-svg {
        fill: none;
        stroke-width: 6;
        stroke-linecap: round;
        transition: stroke-dasharray 400ms ease;
      }
      .ring-fill-svg.ram {
        stroke: #38bdf8;
      }
      .ring-fill-svg.disk {
        stroke: #c084fc;
      }
      .metric-copy {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 0;
      }
      .metric-pct {
        font-size: var(--sc-text-lg);
        font-weight: var(--sc-weight-semibold);
        color: var(--sc-text-primary);
        line-height: 1.1;
      }
      .metric-label {
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
      }
      .metric-drive {
        font-size: var(--sc-text-xs);
        color: var(--sc-text-secondary);
      }
      .storage-block {
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
      }
      .disk-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        max-height: 12.5rem;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: rgba(192, 132, 252, 0.45) transparent;
      }
      .disk-list::-webkit-scrollbar {
        width: 0.35rem;
      }
      .disk-list::-webkit-scrollbar-thumb {
        background: rgba(192, 132, 252, 0.35);
        border-radius: 999px;
      }
      .disk-row {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.4rem 0.55rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.12);
        background: rgba(255, 255, 255, 0.03);
      }
      .disk-row-head {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        min-width: 0;
      }
      .disk-letter {
        font-weight: var(--sc-weight-semibold);
        color: var(--sc-text-primary);
      }
      .sc-pill {
        padding: 0.1rem 0.4rem;
        border-radius: 999px;
        border: 1px solid rgba(192, 132, 252, 0.45);
        background: rgba(138, 27, 217, 0.18);
        font-size: 0.65rem;
        letter-spacing: 0.04em;
        color: #f5d0fe;
        font-weight: var(--sc-weight-semibold);
      }
      .disk-pct {
        margin-left: auto;
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
      }
      .disk-bar {
        height: 0.35rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
      }
      .disk-bar-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #c084fc, #a855f7);
        transition: width 400ms ease;
      }
      .disk-free {
        font-size: var(--sc-text-xs);
        color: var(--sc-text-secondary);
      }
      .config-title {
        margin: 0;
        font-size: var(--sc-text-xs);
        font-weight: var(--sc-weight-semibold);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--sc-text-secondary);
      }
      .meta {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
      }
      .meta > div {
        display: flex;
        justify-content: space-between;
        gap: var(--sc-space-3);
        font-size: var(--sc-text-sm);
        padding: 0.2rem 0;
        border-bottom: 1px solid rgba(196, 181, 253, 0.08);
      }
      .meta > div:last-child {
        border-bottom: none;
      }
      dt {
        color: var(--sc-text-secondary);
      }
      dd {
        margin: 0;
        text-align: right;
        color: var(--sc-text-primary);
      }
      .mono {
        font-family: var(--sc-font-mono);
      }
      .muted-inline {
        color: var(--sc-text-muted);
        font-weight: var(--sc-weight-normal);
      }
      .server-brand {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .server-name {
        font-size: var(--sc-text-lg);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.02em;
        color: var(--sc-text-primary);
      }
      .server-addr {
        font-size: var(--sc-text-sm);
        color: var(--sc-text-secondary);
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: var(--sc-space-2);
        width: fit-content;
        padding: 0.3rem 0.65rem;
        border-radius: 999px;
        border: 1px solid rgba(196, 181, 253, 0.2);
        background: rgba(255, 255, 255, 0.04);
        font-size: var(--sc-text-sm);
        color: var(--sc-text-secondary);
      }
      .dot {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 50%;
        background: rgba(148, 163, 184, 0.7);
        flex-shrink: 0;
      }
      .status-pill[data-state='ONLINE'] .dot {
        background: #2ecc71;
        box-shadow: 0 0 8px rgba(46, 204, 113, 0.45);
      }
      .status-pill[data-state='ONLINE'] {
        border-color: rgba(46, 204, 113, 0.35);
        color: #bbf7d0;
      }
      .status-pill[data-state='OFFLINE'] .dot {
        background: #f87171;
      }
      .status-pill[data-state='OFFLINE'] {
        border-color: rgba(248, 113, 113, 0.35);
      }
      .telemetry-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
        gap: var(--sc-space-2);
      }
      .telemetry-tile {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: 0.55rem 0.65rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.12);
        background: rgba(255, 255, 255, 0.03);
        min-width: 0;
      }
      .telemetry-label {
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
      }
      .telemetry-value {
        font-size: var(--sc-text-sm);
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
        word-break: break-word;
      }
      .folder-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
      }
      .folder-list li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sc-space-3);
        padding: 0.65rem 0.75rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.12);
        background: rgba(255, 255, 255, 0.03);
        font-size: var(--sc-text-sm);
      }
      .folder-meta {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
      }
      .folder-label {
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
      }
      .status-avail {
        width: fit-content;
        padding: 0.12rem 0.45rem;
        border-radius: 999px;
        font-size: 0.68rem;
        border: 1px solid rgba(148, 163, 184, 0.35);
        color: var(--sc-text-muted);
        background: rgba(255, 255, 255, 0.03);
      }
      .status-avail[data-avail='true'] {
        border-color: rgba(46, 204, 113, 0.4);
        color: #bbf7d0;
        background: rgba(46, 204, 113, 0.08);
      }
      .folder-hint {
        font-size: var(--sc-text-xs);
        color: var(--sc-text-muted);
        line-height: 1.35;
      }
      .about-art {
        width: 100%;
        min-height: 9rem;
        border-radius: var(--sc-radius-lg);
        background-color: #12121c;
        background-size: cover;
        background-position: center;
        border: 1px solid var(--sc-border-subtle);
        box-shadow:
          inset 0 0 40px rgba(0, 0, 0, 0.35),
          0 0 28px rgba(138, 27, 217, 0.22);
      }
      .version-badge {
        display: inline-flex;
        padding: 0.18rem 0.55rem;
        border-radius: 999px;
        border: 1px solid rgba(192, 132, 252, 0.4);
        background: rgba(138, 27, 217, 0.18);
        font-size: var(--sc-text-xs);
        color: #f5d0fe;
        font-weight: var(--sc-weight-semibold);
      }
      .site-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        color: #e9d5ff;
        font-size: var(--sc-text-sm);
        font-weight: var(--sc-weight-medium);
        text-decoration: none;
        padding: 0.55rem 1rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.28);
        background: rgba(192, 132, 252, 0.12);
        width: fit-content;
      }
      .site-btn:hover {
        color: #f5d0fe;
        background: rgba(192, 132, 252, 0.2);
      }
      .site-btn:focus-visible {
        outline: 2px solid rgba(192, 132, 252, 0.85);
        outline-offset: 3px;
      }
      .banner {
        display: grid;
        grid-template-columns: minmax(10rem, 0.9fr) minmax(0, 1.2fr);
        gap: var(--sc-space-5);
        align-items: center;
        padding: var(--sc-space-5);
        border-radius: var(--sc-radius-xl);
        border: 1px solid rgba(196, 181, 253, 0.18);
        background:
          radial-gradient(ellipse 55% 90% at 0% 50%, rgba(217, 27, 181, 0.22), transparent 58%),
          radial-gradient(ellipse 45% 70% at 100% 30%, rgba(138, 27, 217, 0.18), transparent 55%),
          linear-gradient(120deg, rgba(18, 18, 28, 0.96), rgba(48, 16, 56, 0.82));
        box-shadow: var(--sc-shadow-card);
      }
      .banner-art {
        width: 100%;
        min-height: 8rem;
        height: 100%;
        border-radius: var(--sc-radius-lg);
        background-color: #12121c;
        background-size: cover;
        background-position: center;
        border: 1px solid var(--sc-border-subtle);
      }
      .banner-copy h2 {
        margin: 0 0 var(--sc-space-2);
        font-size: clamp(1.35rem, 2.2vw, 1.75rem);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.02em;
      }
      .banner-copy p {
        margin: 0 0 var(--sc-space-3);
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.5;
        max-width: 36rem;
      }
      .banner-quote {
        margin: 0 0 var(--sc-space-4) !important;
        color: #f5d0fe !important;
        font-size: var(--sc-text-base) !important;
        opacity: 0.9;
      }
      @media (max-width: 1279px) {
        .cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 900px) {
        .cards {
          grid-template-columns: 1fr;
        }
        .banner {
          grid-template-columns: 1fr;
        }
        .metric-rings {
          grid-template-columns: 1fr;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .switch .slider,
        .switch .slider::before,
        .ring-fill-svg,
        .disk-bar-fill {
          transition: none;
        }
      }
      :host-context(html.sc-reduced-motion) .ring-fill-svg,
      :host-context(html.sc-reduced-motion) .disk-bar-fill,
      :host-context(html.sc-reduced-motion) .switch .slider,
      :host-context(html.sc-reduced-motion) .switch .slider::before {
        transition: none;
      }
    `,
  ],
})
export class SettingsPageComponent implements OnInit, OnDestroy {
  private readonly store = inject(AppStore);
  private readonly settingsActions = inject(SettingsActionsService);
  private readonly notifications = inject(NotificationsService);
  private readonly gateway = inject(LAUNCHER_DESKTOP_GATEWAY);
  private readonly modal = inject(ModalService);
  private readonly serverSvc = inject(HomeServerStatusService);
  private systemPoller: SettingsSystemPoller<SystemInfoDto> | null = null;
  private diskPoller: SettingsSystemPoller<FixedDiskInventoryDto> | null = null;
  readonly assets = SETTINGS_ASSETS;
  readonly siteUrl = SITE_URL;
  readonly serverAddress = 'sweetcraft.datho.st';
  readonly productName = DESKTOP_PRODUCT_NAME;
  readonly productVersion = DESKTOP_PRODUCT_VERSION;
  /** Authoritative AppInfo.buildId from IPC — omitted when unavailable. */
  readonly aboutBuildId = computed(() => this.store.info()?.buildId?.trim() || null);
  readonly memoryMin = MEMORY_MIN;
  readonly memoryMax = MEMORY_MAX;
  readonly memoryStep = MEMORY_STEP;
  readonly memoryDefault = MEMORY_DEFAULT;
  readonly ringRadius = METRIC_RING_RADIUS;
  readonly draftMemory = signal(MEMORY_DEFAULT);
  private syncedFromStore = false;
  readonly systemInfo = signal<SystemInfoDto | null>(null);
  readonly systemLoading = signal(false);
  readonly diskInventory = signal<FixedDiskInventoryDto | null>(null);
  /** Alias — shared HomeServerStatusService is source of truth (refCount). */
  readonly serverStatus = computed(() => this.serverSvc.status());
  readonly serverLoading = computed(() => this.serverSvc.loading());
  readonly storageSummary = signal<StorageSummaryDto | null>(null);
  readonly storageBusy = signal(false);
  readonly locationBusy = signal(false);
  readonly instancePathLabel = computed(
    () =>
      this.store.effectiveSettings().sweetcraftInstancePath ??
      this.storageSummary()?.instancePath ??
      '—',
  );
  readonly instanceLocationUnavailable = computed(
    () => this.store.effectiveSettings().instanceLocationAvailable === false,
  );
  readonly canMoveInstance = computed(() => {
    const r = this.status()?.readiness;
    return r === 'READY' || r === 'UPDATE_AVAILABLE' || r === 'REPAIR_REQUIRED';
  });
  readonly status = computed(() => this.store.status());
  readonly settingsBusy = computed(() => this.settingsActions.isBusy());
  readonly gameRunning = computed(() => {
    const s = this.store.effectivePlayState();
    return s === 'RUNNING' || s === 'LAUNCHING';
  });
  readonly reducedMotion = computed(() => this.store.effectiveSettings().reducedMotion === true);
  readonly memoryLabel = computed(() => formatMemoryLabel(this.draftMemory()));
  readonly persistedMemoryLabel = computed(() =>
    formatMemoryLabel(this.store.effectiveSettings().memoryMiB ?? MEMORY_DEFAULT),
  );
  readonly memoryDirty = computed(() => {
    const current = this.store.effectiveSettings().memoryMiB ?? MEMORY_DEFAULT;
    return this.draftMemory() !== current;
  });
  readonly recommendedLabel = computed(() => {
    const rec = this.systemInfo()?.recommendedMemoryMiB;
    if (typeof rec !== 'number' || !Number.isFinite(rec)) return null;
    return formatMemoryLabel(rec);
  });
  readonly ramUsedPercent = computed(() => {
    const info = this.systemInfo();
    return memoryUsedPercent(info?.totalMemoryMiB, info?.freeMemoryMiB);
  });
  readonly fixedDisks = computed(() => this.diskInventory()?.disks ?? []);
  readonly sweetCraftDisk = computed((): FixedDiskDto | null => {
    return this.fixedDisks().find((d) => d.isSweetCraftDrive) ?? null;
  });
  readonly environmentLabelKey = computed(() => {
    const env = this.store.info()?.environment;
    if (env === 'development') return 'settings.interface.environment.development';
    if (env === 'production') return 'settings.interface.environment.production';
    return null;
  });
  constructor() {
    effect(() => {
      const mem = this.store.effectiveSettings().memoryMiB ?? MEMORY_DEFAULT;
      if (!this.syncedFromStore || !this.memoryDirty()) {
        this.draftMemory.set(clampMemory(mem));
        this.syncedFromStore = true;
      }
    });
  }
  ngOnInit(): void {
    this.serverSvc.start();
    this.systemPoller = new SettingsSystemPoller<SystemInfoDto>({
      intervalMs: SYSTEM_POLL_INTERVAL_MS,
      fetch: () => this.gateway.system.getInfo(),
      onSuccess: (dto) => {
        this.systemInfo.set(dto);
        this.systemLoading.set(false);
      },
      onError: () => {
        // Preserve lastGood systemInfo on background failure.
        if (this.systemInfo() === null) {
          this.systemInfo.set({
            available: false,
            platform: 'unknown',
            arch: 'unknown',
            osLabel: null,
            cpuModel: null,
            cpuCount: null,
            totalMemoryMiB: null,
            freeMemoryMiB: null,
            diskTotalGiB: null,
            diskFreeGiB: null,
            launcherVersion: DESKTOP_PRODUCT_VERSION,
            checkedAtMs: Date.now(),
            recommendedMemoryMiB: null,
          });
        }
        this.systemLoading.set(false);
      },
    });
    this.diskPoller = new SettingsSystemPoller<FixedDiskInventoryDto>({
      intervalMs: DISK_POLL_INTERVAL_MS,
      fetch: () => this.gateway.system.getFixedDisks(),
      onSuccess: (inv) => this.diskInventory.set(inv),
      onError: () => {
        // Preserve lastGood disk inventory on failure.
      },
    });
    this.systemLoading.set(true);
    this.systemPoller.start();
    this.diskPoller.start();
    void this.refreshStorage();
  }
  ngOnDestroy(): void {
    this.systemPoller?.stop();
    this.diskPoller?.stop();
    this.serverSvc.stop();
  }
  formatMiB(mib: number): string {
    return formatMemoryLabel(mib);
  }
  formatDiskFreeSurTotal(freeGiB: number, totalGiB: number): string {
    return formatDiskFreeSurTotalLabel(freeGiB, totalGiB);
  }
  ramRingDash(): string {
    return ringStrokeDasharray(this.ramUsedPercent());
  }
  diskRingDash(pct: number): string {
    return ringStrokeDasharray(pct);
  }
  serverStateKey(): string {
    const state = this.serverStatus().state;
    if (state === 'ONLINE') return 'settings.network.state.online';
    if (state === 'OFFLINE') return 'settings.network.state.offline';
    return 'settings.network.state.unknown';
  }
  onMemoryDraft(raw: number | string): void {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return;
    this.draftMemory.set(clampMemory(n));
  }
  saveMemory(): void {
    void this.settingsActions.update({ memoryMiB: this.draftMemory() });
  }
  resetMemory(): void {
    this.draftMemory.set(MEMORY_DEFAULT);
    void this.settingsActions.update({ memoryMiB: MEMORY_DEFAULT });
  }
  onReducedMotion(value: boolean): void {
    void this.settingsActions.update({ reducedMotion: value === true });
  }
  async refreshSystem(): Promise<void> {
    // Manual Actualiser — show loading; background 5s polls stay silent.
    this.systemLoading.set(true);
    await Promise.all([
      this.systemPoller?.manualRefresh() ?? Promise.resolve(),
      this.diskPoller?.manualRefresh() ?? Promise.resolve(),
    ]);
  }
  async refreshServer(): Promise<void> {
    await this.serverSvc.refresh();
  }
  async refreshStorage(): Promise<void> {
    try {
      this.storageSummary.set(await this.gateway.storage.getSummary());
    } catch {
      this.storageSummary.set({
        instanceAvailable: false,
        logsAvailable: false,
        launcherDataAvailable: false,
      });
    }
  }
  async openInstance(): Promise<void> {
    this.storageBusy.set(true);
    try {
      const result = await this.gateway.storage.openInstance();
      if (result.unavailable || !result.opened) {
        this.notifications.show('settings.data.unavailable_toast', 'warning');
      }
      await this.refreshStorage();
    } finally {
      this.storageBusy.set(false);
    }
  }
  async openLogs(): Promise<void> {
    this.storageBusy.set(true);
    try {
      const result = await this.gateway.storage.openLogs();
      if (result.unavailable || !result.opened) {
        this.notifications.show('settings.data.unavailable_toast', 'warning');
      }
      await this.refreshStorage();
    } finally {
      this.storageBusy.set(false);
    }
  }

  async modifyInstanceLocation(): Promise<void> {
    if (this.locationBusy()) return;
    this.locationBusy.set(true);
    try {
      const pick = await this.gateway.instance.chooseLocation();
      if (pick.cancelled || !pick.path) return;
      if (this.canMoveInstance()) {
        await this.gateway.instance.move(pick.path);
        this.notifications.show('settings.location.updated', 'success');
      } else {
        const replacingUnavailable = this.instanceLocationUnavailable();
        if (replacingUnavailable) {
          const confirmed = await this.confirmUnavailableRelocate();
          if (!confirmed) return;
        }
        await this.gateway.instance.setLocation(pick.path);
        this.notifications.show(
          replacingUnavailable ? 'settings.location.relocated' : 'settings.location.updated',
          'success',
        );
      }
      await this.settingsActions.refresh();
      await this.refreshStorage();
    } catch (e) {
      const messageKey =
        typeof e === 'object' && e && 'messageKey' in e
          ? String((e as { messageKey: string }).messageKey)
          : 'settings.location.move_failed';
      this.notifications.show(messageKey, 'error');
    } finally {
      this.locationBusy.set(false);
    }
  }

  private confirmUnavailableRelocate(): Promise<boolean> {
    return new Promise((resolve) => {
      this.modal.open({
        titleKey: 'settings.location.unavailable_relocate.title',
        bodyKey: 'settings.location.unavailable_relocate.body',
        icon: 'info',
        cancelKey: 'install.uninstall.confirm.cancel',
        confirmKey: 'settings.location.unavailable_relocate.confirm',
        confirmVariant: 'primary',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
}
