/**
 * Electron main process — window lifecycle, IPC registration, and the security posture.
 *
 * The renderer is sandboxed and reaches nothing except the preload bridge. Navigation is locked
 * down, external links go to the OS browser, and the packaged renderer gets a CSP. All real I/O
 * lives behind main/ipc.ts.
 */

import { join } from 'node:path';
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { registerIpc } from './ipc.js';
import { logError, logInfo, logSessionStart } from './log.js';
import { documentName, isDirty } from './projectFile.js';

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
  logError(what, error);
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
    title: `XP Object Placer ${__APP_VERSION__}`,
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

  /**
   * The unsaved-work guard.
   *
   * Closing the window is how the work is lost — there is no dialog in the way, the objects live
   * only in the renderer, and the reflex to hit the X is faster than the thought that nothing has
   * been saved yet.
   *
   * Save asks the renderer rather than saving from here, because main does not hold the project;
   * the renderer does. If that save is then cancelled at the file dialog, the renderer simply never
   * calls `closeWindow` and the window stays open — the right outcome, with no extra message
   * needed to arrange it.
   */
  win.on('close', (event) => {
    if (!isDirty()) return;
    event.preventDefault();

    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved work',
      message: `Save changes to ${documentName()}?`,
      detail: 'Objects you have placed are only in this window until the project is saved.',
    });

    if (choice === 2) return;
    // destroy() rather than close(), which would ask this same question again.
    if (choice === 1) {
      win.destroy();
      return;
    }
    win.webContents.send('xop:saveBeforeClose');
  });

  // External links open in the OS browser; the window itself never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // ⚠️ Do NOT rewrite this as "allow same origin". Every file:// URL has origin "null", so in a
  // packaged build that comparison is "null" === "null" and the guard allows navigation to any
  // local file. Dragging a file onto the window is enough to trigger it: Chromium navigates the
  // top-level frame to the drop, and a crafted .html then loads at a file:// origin **with this
  // preload attached**, handing the page window.xop. (Fable review P1-2.)
  //
  // XOP is a single page that never legitimately navigates, so the rule is simply: block
  // everything, except the dev server's own origin, where Vite may reload.
  const mayNavigate = (url: string): boolean => {
    if (!RENDERER_URL) return false; // packaged: nothing, ever
    try {
      return new URL(url).origin === new URL(RENDERER_URL).origin;
    } catch {
      return false;
    }
  };
  const guardNavigation = (event: { preventDefault(): void }, url: string): void => {
    if (mayNavigate(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  };
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);

  // A window that comes up blank is the one report where the user has nothing else to tell us.
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    logInfo(`renderer failed to load (${code} ${description}): ${url}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logInfo(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
  });

  if (RENDERER_URL) {
    void win.loadURL(RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  logSessionStart();

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
      });
    });
  }

  // XOP needs no browser permissions at all — no geolocation, camera, notifications, clipboard.
  // Electron's defaults are not uniformly deny-all across versions, and a map UI is exactly where a
  // dependency might ask for geolocation. Blanket denial costs nothing here. (Fable review P2-2.)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
