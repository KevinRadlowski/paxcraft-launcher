/**
 * One-shot Electron smoke for 0.6A (file renderer + preload).
 * Exit 0 on success.
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = path.join(root, "ui/dist/sweetcraft-launcher-ui/browser/index.html");
const preload = path.join(root, "dist-desktop/preload/preload.cjs");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await win.loadFile(indexHtml);
  await new Promise((r) => setTimeout(r, 1500));

  const url = win.webContents.getURL();
  const hasBridge = await win.webContents.executeJavaScript(
    'typeof window.sweetcraft === "object" && typeof window.sweetcraft.app?.getInfo === "function"'
  );
  const hasAngular = await win.webContents.executeJavaScript(
    '!!document.querySelector("[ng-version], sc-root, app-root") || (document.body?.innerText?.length ?? 0) > 20'
  );
  const textSample = await win.webContents.executeJavaScript(
    "(document.body?.innerText || \"\").slice(0, 120)"
  );

  const ok = Boolean(url.startsWith("file:") && hasBridge && hasAngular);
  console.log(
    JSON.stringify({ ok, url: url.split("#")[0], hasBridge, hasAngular, textSample }, null, 2)
  );
  app.exit(ok ? 0 : 1);
});
