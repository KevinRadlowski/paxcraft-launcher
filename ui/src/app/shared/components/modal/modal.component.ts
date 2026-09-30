import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  viewChild,
} from '@angular/core';
import {
  ModalService,
  type InstallLocationModalBlock,
  type ModalSection,
} from '../../../core/services/modal.service';
import { ScTranslatePipe } from '../../../core/i18n/translate.pipe';
import { ScButtonComponent } from '../button/button.component';

@Component({
  selector: 'sc-modal-host',
  standalone: true,
  imports: [ScTranslatePipe, ScButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (modalService.modal(); as modal) {
      <div class="backdrop" (click)="onCancel()" role="presentation"></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header>
          <div class="title-row">
            @if (modal.icon === 'microsoft') {
              <span class="modal-icon ms" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"
                  />
                </svg>
              </span>
            } @else if (modal.icon === 'security') {
              <span class="modal-icon security" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"
                  />
                </svg>
              </span>
            } @else if (modal.icon === 'info') {
              <span class="modal-icon info" aria-hidden="true">i</span>
            }
            <h2 id="modal-title">{{ modal.titleKey | scTranslate }}</h2>
          </div>
          <button
            #closeBtn
            type="button"
            class="icon-btn"
            (click)="onCancel()"
            [attr.aria-label]="'modal.close' | scTranslate"
          >
            ×
          </button>
        </header>

        <div class="body">
          @if (modal.bodyKey) {
            <p class="lead">{{ modal.bodyKey | scTranslate }}</p>
          }
          @if (modal.installLocation; as loc) {
            <div class="install-location-block">
              <p class="section-title">{{ loc.labelKey | scTranslate }}</p>
              <p class="install-path mono" data-testid="install-location-path">{{ loc.path }}</p>
              <sc-button
                class="install-modify"
                variant="secondary"
                size="sm"
                data-testid="install-location-modify"
                (clicked)="onInstallLocationModify(loc)"
              >
                {{ loc.modifyKey | scTranslate }}
              </sc-button>
              @if (loc.hintKey) {
                <p class="install-hint muted">{{ loc.hintKey | scTranslate }}</p>
              }
              @if (loc.errorKey) {
                <p class="install-error" role="alert" data-testid="install-location-error">
                  {{ loc.errorKey | scTranslate }}
                </p>
              }
            </div>
          }
          @if (modal.sections?.length) {
            <ul class="sections">
              @for (section of modal.sections!; track section.titleKey) {
                <li>
                  <p class="section-title">{{ section.titleKey | scTranslate }}</p>
                  <p class="section-body">{{ section.bodyKey | scTranslate }}</p>
                  @if (section.actionKey) {
                    <sc-button
                      class="section-action"
                      [variant]="section.actionVariant ?? 'secondary'"
                      (clicked)="onSectionAction(section)"
                    >
                      {{ section.actionKey | scTranslate }}
                    </sc-button>
                  }
                </li>
              }
            </ul>
          }
        </div>

        <footer>
          @if (modal.cancelKey) {
            <sc-button variant="ghost" (clicked)="onCancel()">
              {{ modal.cancelKey | scTranslate }}
            </sc-button>
          }
          @if (modal.confirmKey) {
            <sc-button
              [variant]="modal.confirmVariant ?? 'primary'"
              (clicked)="onConfirm()"
            >
              {{ modal.confirmKey | scTranslate }}
            </sc-button>
          }
        </footer>
      </div>
    }
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.78);
        z-index: 900;
      }

      .dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(32rem, calc(100vw - 2rem));
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        padding: var(--sc-space-6);
        background:
          radial-gradient(ellipse 85% 55% at 0% 0%, rgba(217, 27, 181, 0.16), transparent 58%),
          radial-gradient(ellipse 70% 50% at 100% 100%, rgba(138, 27, 217, 0.1), transparent 55%),
          var(--sc-surface-2, #161622);
        border: 1px solid rgba(196, 181, 253, 0.42);
        border-radius: var(--sc-radius-xl);
        box-shadow:
          var(--sc-shadow-lg, 0 24px 48px rgba(0, 0, 0, 0.45)),
          0 0 40px rgba(217, 27, 181, 0.12);
        z-index: 901;
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--sc-space-3);
        margin-bottom: var(--sc-space-4);
        flex-shrink: 0;
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        min-width: 0;
      }

      header h2 {
        margin: 0;
        font-size: var(--sc-text-xl);
        font-weight: var(--sc-weight-semibold);
        letter-spacing: -0.02em;
        line-height: 1.25;
      }

      .modal-icon {
        width: 2.1rem;
        height: 2.1rem;
        border-radius: var(--sc-radius-full);
        display: grid;
        place-items: center;
        flex-shrink: 0;
        border: 1px solid rgba(196, 181, 253, 0.28);
        background: rgba(168, 85, 247, 0.14);
        color: #e9d5ff;
        font-weight: var(--sc-weight-bold);
        font-size: 0.95rem;
      }

      .modal-icon.security {
        background: rgba(245, 158, 11, 0.12);
        border-color: rgba(245, 158, 11, 0.28);
        color: #fbbf24;
      }

      .modal-icon.info {
        color: #c4b5fd;
      }

      .body {
        overflow-y: auto;
        min-height: 0;
        flex: 1 1 auto;
        margin-bottom: var(--sc-space-5);
        padding-right: 0.15rem;
      }

      .lead {
        color: var(--sc-text-secondary);
        margin: 0 0 var(--sc-space-4);
        line-height: 1.5;
        font-size: var(--sc-text-sm);
      }

      .sections {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sc-space-3);
      }

      .sections li {
        padding: 0.65rem 0.75rem;
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.12);
        background: rgba(255, 255, 255, 0.03);
      }

      .section-title {
        margin: 0;
        color: var(--sc-text-primary);
        font-weight: var(--sc-weight-medium);
        font-size: var(--sc-text-sm);
      }

      .section-body {
        margin: 0.25rem 0 0;
        color: var(--sc-text-muted);
        font-size: var(--sc-text-xs);
        line-height: 1.45;
      }

      .section-action {
        margin-top: var(--sc-space-3);
      }

      footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--sc-space-3);
        flex-shrink: 0;
      }

      .icon-btn {
        background: transparent;
        border: none;
        color: var(--sc-text-muted);
        font-size: 1.5rem;
        line-height: 1;
        padding: var(--sc-space-1);
        border-radius: var(--sc-radius-sm);
        cursor: pointer;
        flex-shrink: 0;
      }

      .icon-btn:hover {
        color: var(--sc-text-primary);
        background: var(--sc-surface-hover, rgba(255, 255, 255, 0.06));
      }

      .icon-btn:focus-visible {
        outline: 2px solid rgba(192, 132, 252, 0.85);
        outline-offset: 2px;
      }

      .install-location-block {
        margin-top: var(--sc-space-3);
        padding: var(--sc-space-3);
        border-radius: var(--sc-radius-md);
        border: 1px solid rgba(196, 181, 253, 0.15);
        background: rgba(255, 255, 255, 0.03);
      }

      .install-path {
        margin: 0.35rem 0 0.75rem;
        word-break: break-all;
        font-size: var(--sc-text-sm);
        color: var(--sc-text-primary);
      }

      .install-path.mono {
        font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
      }

      .install-modify {
        margin-bottom: 0.5rem;
      }

      .install-hint {
        margin: 0.5rem 0 0;
        font-size: var(--sc-text-xs);
        line-height: 1.4;
      }

      .install-error {
        margin: 0.65rem 0 0;
        font-size: var(--sc-text-sm);
        color: #fca5a5;
      }

      .muted {
        color: var(--sc-text-muted);
      }

      @media (prefers-reduced-motion: reduce) {
        .dialog {
          transition: none;
          animation: none;
        }
      }
    `,
  ],
})
export class ScModalHostComponent {
  protected readonly modalService = inject(ModalService);
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  constructor() {
    effect(() => {
      const modal = this.modalService.modal();
      const btn = this.closeBtn();
      if (!modal || !btn) return;
      queueMicrotask(() => btn.nativeElement.focus());
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.modalService.modal()) {
      this.onCancel();
    }
  }

  onCancel(): void {
    const modal = this.modalService.modal();
    const handler = modal?.onCancel;
    this.modalService.close();
    if (handler) {
      void handler();
    }
  }

  async onConfirm(): Promise<void> {
    const modal = this.modalService.modal();
    if (!modal) return;
    const handler = modal.onConfirm;
    this.modalService.close();
    if (handler) {
      await handler();
    }
  }

  async onSectionAction(section: ModalSection): Promise<void> {
    const handler = section.onAction;
    this.modalService.close();
    if (handler) {
      await handler();
    }
  }

  async onInstallLocationModify(loc: InstallLocationModalBlock): Promise<void> {
    await loc.onModify();
  }
}
