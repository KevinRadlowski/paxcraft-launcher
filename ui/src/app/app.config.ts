import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withHashLocation,
} from '@angular/router';
import { routes } from './app.routes';
import { provideLauncherDesktopGateway } from './core/desktop-api/provide-gateway';

/**
 * HashLocationStrategy: SPA route changes do not trigger Electron will-navigate,
 * so we never need to broaden production file: URL trust for Angular routing.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withHashLocation()),
    provideLauncherDesktopGateway(),
  ],
};
