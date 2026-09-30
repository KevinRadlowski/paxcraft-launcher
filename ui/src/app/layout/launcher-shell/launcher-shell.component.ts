import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TitleBarComponent } from '../title-bar/title-bar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { ScToastContainerComponent } from '../../shared/components/toast/toast.component';
import { ScModalHostComponent } from '../../shared/components/modal/modal.component';

@Component({
  selector: 'sc-launcher-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    TitleBarComponent,
    SidebarComponent,
    StatusBarComponent,
    ScToastContainerComponent,
    ScModalHostComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <sc-title-bar />
      <div class="body">
        <sc-sidebar />
        <main class="content" id="main-content">
          <router-outlet />
        </main>
      </div>
      <sc-status-bar />
      <sc-toast-container />
      <sc-modal-host />
    </div>
  `,
  styles: [
    `
      .shell {
        display: grid;
        grid-template-rows: var(--sc-titlebar-height) 1fr var(--sc-statusbar-height);
        height: 100vh;
        overflow: hidden;
        background: transparent;
      }

      .body {
        display: flex;
        min-height: 0;
        overflow: hidden;
      }

      .content {
        flex: 1;
        overflow: auto;
        padding: var(--sc-space-4) var(--sc-space-5);
        min-width: 0;
        width: 100%;
      }

      @media (max-width: 1280px) {
        .content {
          padding: var(--sc-space-3) var(--sc-space-4);
        }
      }
    `,
  ],
})
export class LauncherShellComponent {}
