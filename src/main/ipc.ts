/**
 * IPC handlers. Every privileged operation in XOP passes through here.
 *
 * The invariant, inherited from PCT's security review: **the renderer never names a path.** It
 * selects from a list main produced, or main opens a dialog. `selectInstallation` therefore checks
 * its argument against what main actually offered rather than trusting it — otherwise the sandbox,
 * the context isolation and the CSP would all be decorating an open door.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { describeInstallation, findInstallations, isInstallation } from '../node/findInstallations.js';
import { readCachedCatalog, scanCatalog } from './catalogCache.js';
import { readSettings, writeSettings } from './settings.js';
import type { CatalogSnapshot, Installation, ScanProgress } from '../shared/api.js';

declare const __APP_VERSION__: string;

const SCAN_PROGRESS = 'xop:scanProgress';

/**
 * Paths main has offered to the renderer this session, and will therefore accept back.
 *
 * A folder the user picked from a dialog is added here too: they chose it in a native window main
 * put on screen, which is a different thing from a string arriving over IPC.
 */
const offeredPaths = new Set<string>();

function offer(installations: readonly Installation[]): Installation[] {
  for (const installation of installations) offeredPaths.add(installation.path);
  return [...installations];
}

/** Guard for anything the renderer sends. Everything here is unvalidated until proven otherwise. */
function asOfferedPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('installation must be a string');
  if (!offeredPaths.has(value)) {
    // Not a "does this exist" check — a "did we offer this" check. The distinction is the point.
    throw new Error('that installation was not offered by the application');
  }
  return value;
}

function requireInstallation(userData: string): string {
  const { installation } = readSettings(userData);
  if (!installation) throw new Error('no X-Plane installation has been chosen yet');
  return installation;
}

export function registerIpc(): void {
  const userData = app.getPath('userData');

  ipcMain.handle('xop:getVersion', () => __APP_VERSION__);

  ipcMain.handle('xop:listInstallations', (): Installation[] => offer(findInstallations()));

  ipcMain.handle('xop:currentInstallation', (): Installation | null => {
    const { installation } = readSettings(userData);
    if (!installation) return null;
    const described = describeInstallation(installation);
    offeredPaths.add(described.path);
    return described;
  });

  ipcMain.handle('xop:selectInstallation', (_event, raw: unknown): Installation => {
    const path = asOfferedPath(raw);
    const described = describeInstallation(path);
    if (!described.usable) throw new Error(described.problem ?? 'that installation cannot be used');
    writeSettings(userData, { installation: path });
    return described;
  });

  ipcMain.handle('xop:browseForInstallation', async (event): Promise<Installation | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await (window
      ? dialog.showOpenDialog(window, {
          title: 'Choose your X-Plane 12 folder',
          properties: ['openDirectory'],
        })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }));

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (!chosen) return null;

    const path = chosen.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!isInstallation(path)) {
      throw new Error('that folder is not an X-Plane installation — no Resources/default scenery');
    }
    offeredPaths.add(path);
    writeSettings(userData, { installation: path });
    return describeInstallation(path);
  });

  ipcMain.handle('xop:getCatalog', (): CatalogSnapshot | null =>
    readCachedCatalog(userData, requireInstallation(userData)),
  );

  ipcMain.handle('xop:rescanCatalog', (event): CatalogSnapshot => {
    const installation = requireInstallation(userData);
    const send = (progress: ScanProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send(SCAN_PROGRESS, progress);
    };
    return scanCatalog(userData, installation, send);
  });
}
