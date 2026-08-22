/**
 * Electron main process — window lifecycle, IPC registration, and the security posture.
 *
 * The renderer is sandboxed and reaches nothing except the preload bridge. Navigation is locked
 * down, external links go to the OS browser, and the packaged renderer gets a CSP. All real I/O
 * lives behind main/ipc.ts.
 */

import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { registerIpc } from './ipc.js';

/** electron-vite sets this in dev (the Vite renderer dev-server URL); undefined when packaged. */
const RENDERER_URL = process.env['ELECTRON_RENDERER_URL'];

/** Frozen at build time by electron.vite.config. See the note there for why not app.getVersion(). */
declare const __APP_VERSION__: string;

/**
 * Applied to the packaged renderer only. Vite's dev server injects an inline react-refresh preamble
 * and a websocket that a strict policy would block, and the dev renderer is a local page anyway.
 * The packaged app is the one that will eventually load a project file it did not write.
 *
 * img-src allows https so map tiles load; script and connect stay on 'self'.
 */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; " +
  "connect-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'none'";

// Registering these listeners suppresses Node's own "print the stack and exit", so the naive
// version — log it and carry on — would quietly turn every fatal main-process error into XOP
// limping along in an unknown state. Record why, then preserve the original outcome.
const fatal = (what: string) => (error: unknown) => {
  console.error(`[main] ${what}:`, error);
  process.exit(1);
};
process.on('uncaughtException', fatal('uncaught exception in main'));
process.on('unhandledRejection', fatal('unhandled promise rejection in main'));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#11151a',
    title: `XOP ${__APP_VERSION__} — X-Plane 12 Object Placer`,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // the preload is emitted CJS so this can stay on
    },
  });

  // A page title wins over the `title` option the moment the document loads, so the option alone
  // would show the version for one frame and then lose it. Main owns the title.
  win.on('page-title-updated', (event) => event.preventDefault());

  win.once('ready-to-show', () => win.show());

  // External links open in the OS browser; the window itself never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (current && new URL(url).origin === new URL(current).origin) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  // A window that comes up blank is the one report where the user has nothing else to tell us.
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[main] renderer failed to load (${code} ${description}): ${url}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[main] renderer gone: ${details.reason} (exit ${details.exitCode})`);
  });

  if (RENDERER_URL) {
    void win.loadURL(RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
      });
    });
  }

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
