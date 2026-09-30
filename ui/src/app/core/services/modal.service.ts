import { Injectable, signal } from '@angular/core';

export interface ModalSection {
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly actionKey?: string;
  readonly actionVariant?: 'primary' | 'danger' | 'secondary' | 'ghost';
  readonly onAction?: () => void | Promise<void>;
}

export interface InstallLocationModalBlock {
  readonly labelKey: string;
  readonly path: string;
  readonly hintKey?: string;
  readonly modifyKey: string;
  readonly errorKey?: string | null;
  readonly onModify: () => void | Promise<void>;
}

export interface ModalConfig {
  readonly titleKey: string;
  readonly bodyKey?: string;
  readonly sections?: readonly ModalSection[];
  readonly installLocation?: InstallLocationModalBlock;
  readonly confirmKey?: string; // Fermer
  readonly cancelKey?: string;
  readonly confirmVariant?: 'primary' | 'danger' | 'secondary' | 'ghost';
  readonly icon?: 'microsoft' | 'security' | 'info';
  readonly onConfirm?: () => void | Promise<void>;
  readonly onCancel?: () => void | Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly active = signal<ModalConfig | null>(null);
  private previousFocus: HTMLElement | null = null;

  readonly modal = this.active.asReadonly();

  open(config: ModalConfig): void {
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    this.previousFocus =
      typeof HTMLElement !== 'undefined' && ae instanceof HTMLElement ? ae : null;
    this.active.set(config);
  }

  /** Refresh the active modal config (e.g. candidate path / inline error). */
  update(config: ModalConfig): void {
    if (!this.active()) return;
    this.active.set(config);
  }

  close(): void {
    this.active.set(null);
    const el = this.previousFocus;
    this.previousFocus = null;
    if (el && typeof el.focus === 'function') {
      queueMicrotask(() => {
        try {
          el.focus();
        } catch {
          /* element may have been removed */
        }
      });
    }
  }
}
