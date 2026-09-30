import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { assertSecureWebPreferences } from "../shared/security.js";
import { cspForPolicy } from "../shared/csp.js";
import type { RendererTrustPolicy } from "../shared/trust-policy.js";

export { assertSecureWebPreferences };
export { productionCsp, developmentCsp, cspForPolicy } from "../shared/csp.js";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export interface CreateMainWindowOptions {
  preloadPath: string;
  policy: RendererTrustPolicy;
}

/**
 * Secure BrowserWindow defaults for SweetCraft Launcher.
 * CSP mode is derived from RendererTrustPolicy (packaged file = always strict).
 */
export function createMainWindow(opts: CreateMainWindowOptions): BrowserWindow {
  const webPreferences: BrowserWindowConstructorOptions["webPreferences"] = {
    preload: opts.preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webviewTag: false,
    allowRunningInsecureContent: false,
    experimentalFeatures: false
  };

  assertSecureWebPreferences(webPreferences);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#0b0714",
    title: "SweetCraft Launcher",
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    webPreferences
  });

  mainWindow = win;

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  const csp = cspForPolicy(opts.policy);

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp]
      }
    });
  });

  return win;
}
