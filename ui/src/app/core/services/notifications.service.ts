import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';

export interface ToastMessage {
  readonly id: string;
  readonly messageKey: string;
  readonly variant: ToastVariant;
  readonly durationMs: number;
  readonly params?: Readonly<Record<string, string | number>>;
}

let toastSeq = 0;

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly items = signal<readonly ToastMessage[]>([]);

  readonly toasts = this.items.asReadonly();

  /**
   * Success/info auto-dismiss (default 4s).
   * Errors persist until dismissed (durationMs = 0) unless overridden.
   */
  show(
    messageKey: string,
    variant: ToastVariant | 'error' = 'info',
    durationMs?: number,
    params?: Record<string, string | number>,
  ): void {
    const mapped: ToastVariant =
      variant === 'error' || variant === 'danger'
        ? 'danger'
        : variant === 'success'
          ? 'success'
          : variant === 'warning'
            ? 'warning'
            : 'info';
    const resolvedDuration =
      durationMs !== undefined ? durationMs : mapped === 'danger' ? 0 : 4000;
    const id = `toast-${++toastSeq}`;
    const toast: ToastMessage = {
      id,
      messageKey,
      variant: mapped,
      durationMs: resolvedDuration,
      ...(params ? { params } : {}),
    };
    this.items.update((list) => [...list, toast]);

    if (resolvedDuration > 0) {
      setTimeout(() => this.dismiss(id), resolvedDuration);
    }
  }

  dismiss(id: string): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}
