import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppStore } from '../../core/state/app.store';
import { AuthActionsService } from '../../core/services/auth-actions.service';
import { ModalService } from '../../core/services/modal.service';
import { ScButtonComponent } from '../../shared/components/button/button.component';
import { ScBadgeComponent } from '../../shared/components/badge/badge.component';
import { ScTranslatePipe } from '../../core/i18n/translate.pipe';
import {
  avatarInitials,
  formatLastUsed,
  isAuthenticated,
  mcAccessRowState,
  msAuthRowState,
  sessionRowState,
} from './account-presentation';

@Component({
  selector: 'sc-account-page',
  standalone: true,
  imports: [ScButtonComponent, ScBadgeComponent, ScTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="account-page">
      <header class="page-head">
        <h1>{{ 'account.title' | scTranslate }}</h1>
        <p class="page-lead">{{ 'account.subtitle' | scTranslate }}</p>
      </header>

      <section
        class="identity"
        data-testid="account-identity"
        aria-live="polite"
        [attr.aria-busy]="authState() === 'RESTORING' ? 'true' : null"
      >
        @if (authState() === 'RESTORING') {
          <div class="identity-restoring">
            <div class="avatar placeholder" aria-hidden="true">…</div>
            <div class="identity-copy">
              <p class="identity-name">{{ 'account.state.restoring' | scTranslate }}</p>
              <p class="muted">
                {{ (store.authProgressKey() || 'auth.progress.restoring') | scTranslate }}
              </p>
            </div>
          </div>
        } @else if (connected()) {
          @if (active(); as acc) {
            <div class="identity-grid">
              <div class="identity-main">
                <div class="avatar" aria-hidden="true">{{ initials(acc.minecraftUsername) }}</div>
                <div class="identity-copy">
                  <p class="identity-name">{{ acc.minecraftUsername }}</p>
                  <p class="status-line">
                    <span class="dot ok" aria-hidden="true"></span>
                    <span>{{ 'account.identity.mc_connected' | scTranslate }}</span>
                  </p>
                  <div class="pills">
                    <span class="auth-pill">
                      <span class="pill-mark ms" aria-hidden="true"></span>
                      {{ 'account.ms.connected' | scTranslate }}
                    </span>
                    <span class="auth-pill">
                      <span class="pill-mark mc" aria-hidden="true"></span>
                      {{ 'account.mc.active' | scTranslate }}
                    </span>
                  </div>
                </div>
              </div>

              <dl class="meta-col">
                <div class="meta-row">
                  <dt>{{ 'account.meta.current' | scTranslate }}</dt>
                  <dd>{{ acc.minecraftUsername }}</dd>
                </div>
                <div class="meta-row">
                  <dt>{{ 'account.meta.session' | scTranslate }}</dt>
                  <dd>{{ 'account.state.authenticated' | scTranslate }}</dd>
                </div>
                <div class="meta-row">
                  <dt>{{ 'account.last_used' | scTranslate }}</dt>
                  <dd>{{ lastUsedLabel() ?? ('account.last_used.unknown' | scTranslate) }}</dd>
                </div>
              </dl>

              <div class="identity-actions">
                <sc-button variant="secondary" (clicked)="scrollToSaved()">
                  {{ 'account.manage' | scTranslate }}
                </sc-button>
                <sc-button
                  variant="ghost"
                  class="logout-btn"
                  [disabled]="auth.isBusy()"
                  (clicked)="logout(acc.accountId)"
                >
                  {{ 'account.logout' | scTranslate }}
                </sc-button>
              </div>
            </div>
          }
        } @else {
          <div class="identity-empty">
            <div class="avatar placeholder" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                />
              </svg>
            </div>
            <div class="identity-copy">
              <p class="identity-name">{{ 'home.account.none' | scTranslate }}</p>
              <p class="muted">{{ 'account.identity.empty_body' | scTranslate }}</p>
              @if (store.authError(); as err) {
                <p class="error" role="alert">{{ err.messageKey | scTranslate }}</p>
              }
            </div>
            <div class="identity-actions">
              @if (authState() === 'REAUTH_REQUIRED') {
                <sc-button variant="primary" [disabled]="auth.isBusy()" (clicked)="reconnect()">
                  {{ 'cta.reauth' | scTranslate }}
                </sc-button>
              } @else if (authState() === 'ERROR') {
                <sc-button variant="primary" [disabled]="auth.isBusy()" (clicked)="login()">
                  {{ 'cta.sign_in_microsoft' | scTranslate }}
                </sc-button>
                <sc-button variant="secondary" [disabled]="auth.isBusy()" (clicked)="retry()">
                  {{ 'account.retry' | scTranslate }}
                </sc-button>
              } @else {
                <sc-button variant="primary" [disabled]="auth.isBusy()" (clicked)="login()">
                  {{ 'cta.sign_in_microsoft' | scTranslate }}
                </sc-button>
              }
            </div>
          </div>
        }
      </section>

      <section class="cards" aria-label="Vue d'ensemble">
        <article class="card card-ms" data-testid="account-ms-card">
          <header class="card-head">
            <div class="card-icon ms" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
              </svg>
            </div>
            <div>
              <h2>{{ 'account.ms.title' | scTranslate }}</h2>
              <p class="card-body">{{ msBodyKey() | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            <ul class="status-rows">
              <li [class]="msTone()">
                <span class="row-mark" aria-hidden="true"></span>
                <span>{{ 'account.ms.row.microsoft' | scTranslate }}</span>
              </li>
              <li [class]="mcTone()">
                <span class="row-mark" aria-hidden="true"></span>
                <span>{{ 'account.ms.row.minecraft' | scTranslate }}</span>
              </li>
              <li [class]="sessionTone()">
                <span class="row-mark" aria-hidden="true"></span>
                <span>{{ 'account.ms.row.session' | scTranslate }}</span>
              </li>
            </ul>
          </div>
          <div class="card-foot">
            <button type="button" class="text-link" (click)="openMsHelp()">
              {{ 'account.ms.learn' | scTranslate }}
            </button>
          </div>
        </article>

        <article class="card card-security" data-testid="account-security">
          <header class="card-head">
            <div class="card-icon security" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'account.security.title' | scTranslate }}</h2>
              <p class="card-body">{{ 'account.security.body' | scTranslate }}</p>
            </div>
          </header>
          <div class="card-main">
            <ul class="tip-rows">
              <li>
                <span class="tip-icon" aria-hidden="true">✦</span>
                <div>
                  <p class="tip-title">{{ 'account.security.tip1.title' | scTranslate }}</p>
                  <p class="tip-body">{{ 'account.security.tip1.body' | scTranslate }}</p>
                </div>
              </li>
              <li>
                <span class="tip-icon" aria-hidden="true">✦</span>
                <div>
                  <p class="tip-title">{{ 'account.security.tip2.title' | scTranslate }}</p>
                  <p class="tip-body">{{ 'account.security.tip2.body' | scTranslate }}</p>
                </div>
              </li>
              <li>
                <span class="tip-icon" aria-hidden="true">✦</span>
                <div>
                  <p class="tip-title">{{ 'account.security.tip3.title' | scTranslate }}</p>
                  <p class="tip-body">{{ 'account.security.tip3.body' | scTranslate }}</p>
                </div>
              </li>
            </ul>
          </div>
          <div class="card-foot">
            <button type="button" class="ghost-link" (click)="openSecurityHelp()">
              {{ 'account.security.advice' | scTranslate }}
            </button>
          </div>
        </article>

        <article class="card card-list" id="account-saved" data-testid="account-list">
          <header class="card-head">
            <div class="card-icon accounts" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
                />
              </svg>
            </div>
            <div>
              <h2>{{ 'account.saved' | scTranslate }}</h2>
              <p class="card-body">{{ 'account.list.body' | scTranslate }}</p>
            </div>
          </header>

          <div class="card-main">
            @if (store.accounts().length === 0) {
              <div class="empty-state">
                <p class="empty-title">{{ 'account.empty' | scTranslate }}</p>
                <p class="muted small">{{ 'account.identity.empty_body' | scTranslate }}</p>
              </div>
            } @else {
              <ul class="account-rows">
                @for (account of store.accounts(); track account.accountId) {
                  <li [class.is-active]="account.accountId === store.activeAccountId()">
                    <div class="row-avatar" aria-hidden="true">
                      {{ initials(account.minecraftUsername) }}
                    </div>
                    <div class="row-meta">
                      <span class="row-name">{{ account.minecraftUsername }}</span>
                      @if (account.accountId === store.activeAccountId() && connected()) {
                        <sc-badge variant="success">{{ 'account.badge.active' | scTranslate }}</sc-badge>
                      } @else if (account.accountId === store.activeAccountId()) {
                        <sc-badge variant="info">{{ 'account.badge.current' | scTranslate }}</sc-badge>
                      } @else {
                        <sc-badge variant="neutral">{{ 'account.badge.available' | scTranslate }}</sc-badge>
                      }
                    </div>
                    <div class="row-actions">
                      @if (account.accountId !== store.activeAccountId()) {
                        <sc-button
                          variant="ghost"
                          size="sm"
                          [disabled]="auth.isBusy()"
                          (clicked)="select(account.accountId)"
                        >
                          {{ 'account.select_use' | scTranslate }}
                        </sc-button>
                      }
                      <sc-button
                        variant="ghost"
                        size="sm"
                        class="logout-btn"
                        [disabled]="auth.isBusy()"
                        (clicked)="logout(account.accountId)"
                      >
                        {{ 'account.logout' | scTranslate }}
                      </sc-button>
                    </div>
                  </li>
                }
              </ul>
            }
          </div>

          <div class="card-foot">
            <sc-button variant="secondary" [disabled]="auth.isBusy()" (clicked)="login()">
              {{ 'account.add' | scTranslate }}
            </sc-button>
          </div>
        </article>
      </section>
    </div>
  `,
  styles: [
    `
      .page {
        position: relative;
        width: 100%;
        max-width: none;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sc-home-gap, 1.25rem);
      }

      .page-head {
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
      }

      .page-head h1 {
        margin: 0;
        font-size: clamp(1.65rem, 2.6vw, 2rem);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.02em;
        color: var(--sc-text-primary);
      }

      .page-lead {
        margin: 0;
        max-width: 36rem;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.45;
      }

      .identity {
        padding: var(--sc-space-4) var(--sc-space-5);
        border-radius: var(--sc-radius-xl);
        border: 1px solid var(--sc-border-default);
        background: var(--sc-surface-2);
        box-shadow: var(--sc-shadow-card);
      }

      .identity-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(9.5rem, 0.7fr);
        gap: var(--sc-space-3) var(--sc-space-4);
        align-items: center;
      }

      .identity-main,
      .identity-empty,
      .identity-restoring {
        display: flex;
        gap: var(--sc-space-3);
        align-items: flex-start;
        min-width: 0;
      }

      .identity-empty,
      .identity-restoring {
        flex-wrap: wrap;
        align-items: center;
      }

      .avatar {
        width: 3.65rem;
        height: 3.65rem;
        border-radius: var(--sc-radius-lg);
        display: grid;
        place-items: center;
        background: var(--sc-accent-soft);
        border: 1px solid var(--sc-border-accent);
        font-weight: var(--sc-weight-bold);
        font-size: 1.05rem;
        letter-spacing: 0.04em;
        flex-shrink: 0;
        color: var(--sc-text-accent);
      }

      .avatar.placeholder {
        color: var(--sc-text-accent);
        font-size: 1.15rem;
      }

      .identity-copy {
        min-width: 0;
        flex: 1;
      }

      .identity-name {
        margin: 0;
        font-size: clamp(1.25rem, 1.8vw, 1.55rem);
        font-weight: var(--sc-weight-bold);
        letter-spacing: -0.02em;
        line-height: 1.2;
      }

      .status-line {
        display: flex;
        align-items: center;
        gap: var(--sc-space-2);
        margin: 0.35rem 0 0;
        color: var(--sc-success);
        font-size: var(--sc-text-sm);
        font-weight: var(--sc-weight-medium);
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
        box-shadow: 0 0 8px rgba(46, 204, 113, 0.45);
      }

      .pills {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-2);
        margin-top: var(--sc-space-2);
      }

      .auth-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.22rem 0.62rem;
        border-radius: var(--sc-radius-full);
        border: 1px solid var(--sc-border-default);
        background: rgba(255, 255, 255, 0.04);
        font-size: var(--sc-text-xs);
        font-weight: var(--sc-weight-medium);
        color: var(--sc-text-secondary);
      }

      .pill-mark {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 2px;
        flex-shrink: 0;
      }

      .pill-mark.ms {
        background-image:
          linear-gradient(to right, #f25022 50%, #7fba00 50%),
          linear-gradient(to right, #00a4ef 50%, #ffb900 50%);
        background-size: 100% 50%;
        background-position: top left, bottom left;
        background-repeat: no-repeat;
      }

      .pill-mark.mc {
        background: linear-gradient(180deg, #5b8c3e 0 45%, #8b5a2b 45% 100%);
        border-radius: 2px;
      }

      .meta-col {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
        padding: var(--sc-space-2) var(--sc-space-3);
        border-radius: var(--sc-radius-lg);
        border: 1px solid var(--sc-border-subtle);
        background: rgba(255, 255, 255, 0.03);
      }

      .meta-row {
        display: grid;
        gap: 0.1rem;
      }

      .meta-row dt {
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--sc-text-muted);
      }

      .meta-row dd {
        margin: 0;
        font-size: var(--sc-text-sm);
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
      }

      .identity-actions {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-3);
        margin-top: var(--sc-space-1);
        padding-top: var(--sc-space-3);
        border-top: 1px solid var(--sc-border-subtle);
      }

      .identity-empty .identity-actions,
      .identity-restoring .identity-actions {
        margin-left: auto;
        border-top: none;
        padding-top: 0;
        margin-top: 0;
      }

      :host ::ng-deep .logout-btn button {
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.28);
      }

      :host ::ng-deep .logout-btn button:not(:disabled):hover {
        background: rgba(239, 68, 68, 0.1);
        color: #fecaca;
      }

      .muted {
        margin: var(--sc-space-2) 0 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.45;
      }

      .muted.small {
        font-size: var(--sc-text-xs);
      }

      .error {
        margin: var(--sc-space-3) 0 0;
        color: var(--sc-text-danger, #fca5a5);
        font-size: var(--sc-text-sm);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--sc-home-gap, 1.25rem);
        scroll-margin-top: 1.5rem;
      }

      #account-saved {
        scroll-margin-top: 1.5rem;
      }

      .card {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-3);
        min-height: 14.5rem;
        padding: var(--sc-space-4) var(--sc-space-5);
        border-radius: var(--sc-radius-xl);
        border: 1px solid var(--sc-border-default);
        background: var(--sc-surface-1);
        box-shadow: var(--sc-shadow-card);
      }

      .card::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .card-ms::before {
        background: radial-gradient(ellipse 80% 55% at 0% 0%, rgba(56, 189, 248, 0.1), transparent 55%);
      }

      .card-security::before {
        background: radial-gradient(ellipse 80% 55% at 100% 0%, rgba(245, 158, 11, 0.1), transparent 55%);
      }

      .card-list::before {
        background: radial-gradient(ellipse 80% 55% at 50% 100%, rgba(210, 167, 120, 0.1), transparent 55%);
      }

      .card-head {
        display: flex;
        gap: var(--sc-space-3);
        align-items: flex-start;
        position: relative;
      }

      .card-icon {
        width: 2.4rem;
        height: 2.4rem;
        border-radius: var(--sc-radius-full);
        display: grid;
        place-items: center;
        flex-shrink: 0;
        border: 1px solid var(--sc-border-accent);
        background: var(--sc-accent-soft);
        color: var(--sc-text-accent);
      }

      .card-icon.security {
        background: var(--sc-warning-muted);
        border-color: rgba(245, 158, 11, 0.35);
        color: #fbbf24;
      }

      .card-icon.accounts {
        background: var(--sc-accent-soft);
        border-color: var(--sc-border-accent);
        color: var(--sc-text-accent);
      }

      .card h2 {
        margin: 0 0 var(--sc-space-1);
        font-size: var(--sc-text-lg);
        font-weight: var(--sc-weight-semibold);
        letter-spacing: -0.01em;
        text-transform: none;
        color: var(--sc-text-primary);
      }

      .card-body {
        margin: 0;
        color: var(--sc-text-secondary);
        font-size: var(--sc-text-sm);
        line-height: 1.45;
      }

      .status-rows,
      .tip-rows,
      .account-rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-2);
        position: relative;
      }

      .account-rows {
        max-height: 14rem;
        overflow-y: auto;
      }

      .status-rows li,
      .tip-rows li {
        display: flex;
        gap: var(--sc-space-3);
        align-items: flex-start;
        padding: 0.55rem 0.7rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid var(--sc-border-subtle);
        background: rgba(255, 255, 255, 0.03);
        font-size: var(--sc-text-sm);
        color: var(--sc-text-secondary);
      }

      .row-mark {
        width: 1rem;
        height: 1rem;
        margin-top: 0.1rem;
        border-radius: 50%;
        border: 1.5px solid var(--sc-border-default);
        flex-shrink: 0;
        position: relative;
      }

      .status-rows li.ok .row-mark {
        border-color: rgba(46, 204, 113, 0.55);
        background: rgba(46, 204, 113, 0.15);
      }

      .status-rows li.ok .row-mark::after {
        content: '';
        position: absolute;
        left: 0.28rem;
        top: 0.12rem;
        width: 0.28rem;
        height: 0.5rem;
        border: solid var(--sc-success);
        border-width: 0 1.5px 1.5px 0;
        transform: rotate(45deg);
      }

      .status-rows li.error .row-mark {
        border-color: rgba(248, 113, 113, 0.55);
        background: rgba(248, 113, 113, 0.12);
      }

      .status-rows li.error .row-mark::before,
      .status-rows li.error .row-mark::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        width: 0.55rem;
        height: 1.5px;
        background: #fca5a5;
      }

      .status-rows li.error .row-mark::before {
        transform: translate(-50%, -50%) rotate(45deg);
      }

      .status-rows li.error .row-mark::after {
        transform: translate(-50%, -50%) rotate(-45deg);
      }

      .tip-icon {
        color: var(--sc-text-accent);
        flex-shrink: 0;
        margin-top: 0.1rem;
      }

      .tip-title {
        margin: 0;
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
        font-size: var(--sc-text-sm);
      }

      .tip-body {
        margin: 0.15rem 0 0;
        color: var(--sc-text-muted);
        font-size: var(--sc-text-xs);
        line-height: 1.4;
      }

      .text-link,
      .ghost-link {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        color: var(--sc-text-accent);
        font-size: var(--sc-text-sm);
        font-weight: var(--sc-weight-medium);
        text-decoration: none;
        position: relative;
        cursor: pointer;
        font-family: inherit;
        background: transparent;
        border: none;
        padding: 0;
      }

      .ghost-link {
        padding: 0.45rem 0.85rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid var(--sc-border-default);
        background: transparent;
        color: var(--sc-text-primary);
      }

      .text-link:hover,
      .ghost-link:hover {
        text-decoration: none;
        color: var(--sc-accent-200);
      }

      .ghost-link:hover {
        background: rgba(255, 255, 255, 0.04);
      }

      .text-link:focus-visible,
      .ghost-link:focus-visible {
        outline: 2px solid var(--sc-border-accent);
        outline-offset: 3px;
      }

      .card-main {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
        position: relative;
      }

      .empty-state {
        padding: var(--sc-space-3);
        border-radius: var(--sc-radius-md);
        border: 1px dashed var(--sc-border-default);
        background: rgba(255, 255, 255, 0.02);
        text-align: center;
        position: relative;
      }

      .empty-title {
        margin: 0;
        font-weight: var(--sc-weight-semibold);
      }

      .account-rows li {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        padding: 0.65rem 0.75rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid var(--sc-border-subtle);
        background: rgba(255, 255, 255, 0.03);
      }

      .account-rows li.is-active {
        border-color: rgba(210, 167, 120, 0.4);
        box-shadow: inset 0 0 0 1px rgba(210, 167, 120, 0.08);
      }

      .row-avatar {
        width: 2.35rem;
        height: 2.35rem;
        border-radius: var(--sc-radius-md);
        display: grid;
        place-items: center;
        background: var(--sc-accent-soft);
        border: 1px solid var(--sc-border-accent);
        font-size: 0.7rem;
        font-weight: var(--sc-weight-bold);
        flex-shrink: 0;
        color: var(--sc-text-accent);
      }

      .row-meta {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.35rem;
      }

      .row-name {
        font-weight: var(--sc-weight-medium);
        font-size: var(--sc-text-sm);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .row-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sc-space-1);
        justify-content: flex-end;
      }

      .card-foot {
        margin-top: auto;
        padding-top: var(--sc-space-2);
        position: relative;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sc-space-2);
      }

      @media (max-width: 1279px) {
        .cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .card-list {
          grid-column: 1 / -1;
        }
      }

      @media (max-width: 900px) {
        .identity-grid {
          grid-template-columns: 1fr;
        }

        .cards {
          grid-template-columns: 1fr;
        }

        .card-list {
          grid-column: auto;
        }

        .identity-empty .identity-actions,
        .identity-restoring .identity-actions {
          margin-left: 0;
          width: 100%;
        }
      }
    `,
  ],
})
export class AccountPageComponent {
  protected readonly store = inject(AppStore);
  protected readonly auth = inject(AuthActionsService);
  private readonly modal = inject(ModalService);

  readonly active = this.store.activeAccount;
  readonly authState = this.store.effectiveAuthState;

  readonly connected = computed(
    () => isAuthenticated(this.authState()) && this.active() != null,
  );

  readonly lastUsedLabel = computed(() => formatLastUsed(this.active()?.lastUsedAtMs));

  readonly msTone = computed(() => msAuthRowState(this.authState()));
  readonly mcTone = computed(() => mcAccessRowState(this.authState()));
  readonly sessionTone = computed(() => sessionRowState(this.authState()));

  readonly msBodyKey = computed(() => {
    const state = this.authState();
    if (state === 'AUTHENTICATED') return 'account.ms.body_ok';
    if (state === 'ERROR') return 'account.ms.body_error';
    if (state === 'REAUTH_REQUIRED') return 'account.ms.body_reauth';
    if (state === 'RESTORING') return 'account.ms.body_restoring';
    return 'account.ms.body_out';
  });

  initials(username: string): string {
    return avatarInitials(username);
  }

  /** Scroll to saved accounts card — no tab/section state. */
  scrollToSaved(): void {
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('account-saved')?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  openMsHelp(): void {
    this.modal.open({
      titleKey: 'account.ms.help.title',
      icon: 'microsoft',
      confirmKey: 'modal.close',
      sections: [
        { titleKey: 'account.ms.help.s1.title', bodyKey: 'account.ms.help.s1.body' },
        { titleKey: 'account.ms.help.s2.title', bodyKey: 'account.ms.help.s2.body' },
        { titleKey: 'account.ms.help.s3.title', bodyKey: 'account.ms.help.s3.body' },
        { titleKey: 'account.ms.help.s4.title', bodyKey: 'account.ms.help.s4.body' },
      ],
    });
  }

  openSecurityHelp(): void {
    this.modal.open({
      titleKey: 'account.security.help.title',
      icon: 'security',
      confirmKey: 'modal.close',
      sections: [
        { titleKey: 'account.security.tip1.title', bodyKey: 'account.security.tip1.body' },
        { titleKey: 'account.security.tip2.title', bodyKey: 'account.security.tip2.body' },
        { titleKey: 'account.security.tip3.title', bodyKey: 'account.security.tip3.body' },
        { titleKey: 'account.security.tip4.title', bodyKey: 'account.security.tip4.body' },
        { titleKey: 'account.security.tip5.title', bodyKey: 'account.security.tip5.body' },
      ],
    });
  }

  login(): void {
    void this.auth.login();
  }

  reconnect(): void {
    void this.auth.reconnect();
  }

  /**
   * Logout removes the stored account from the launcher store (fake + real auth).
   * It does not open external Microsoft account management URLs.
   */
  logout(accountId: string): void {
    void this.auth.logout(accountId);
  }

  select(accountId: string): void {
    void this.auth.select(accountId);
  }

  retry(): void {
    void this.auth.retryAfterError();
  }
}
