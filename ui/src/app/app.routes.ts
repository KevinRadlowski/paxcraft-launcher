import { Routes } from '@angular/router';
import { LauncherShellComponent } from './layout/launcher-shell/launcher-shell.component';

export const routes: Routes = [
  {
    path: '',
    component: LauncherShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        loadComponent: () => import('./features/home/home.page').then((m) => m.HomePageComponent),
      },
      {
        path: 'account',
        loadComponent: () =>
          import('./features/account/account.page').then((m) => m.AccountPageComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPageComponent),
      },
      {
        path: 'diagnostics',
        loadComponent: () =>
          import('./features/diagnostics/diagnostics.page').then((m) => m.DiagnosticsPageComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
