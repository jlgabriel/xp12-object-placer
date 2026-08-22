/**
 * IPC handlers. Every privileged operation in XOP passes through here.
 *
 * The invariant, inherited from PCT's security review: **the renderer never names a path.** It
 * selects from a list main produced, or main opens a dialog. `selectInstallation` therefore checks
 * its argument against what main actually offered rather than trusting it — otherwise the sandbox,
 * the context isolation and the CSP would all be decorating an open door.
 *
 * Every handler goes through `handle()`, which validates the sender and keeps internal errors from
 * crossing the boundary verbatim.
 */

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { describeInstallation, findInstallations, isInstallation } from '../node/findInstallations.js';
import { readCachedCatalog } from './catalogCache.js';
import { runScan } from './runScan.js';
import { readSettings, writeSettings } from './settings.js';
import type { CatalogSnapshot, Installation, ScanProgress } from '../shared/api.js';

declare const __APP_VERSION__: string;

const SCAN_PROGRESS = 'xop:scanProgress';

/**
 * An error whose text is meant for a person, and is safe to show them.
 *
 * Anything else thrown inside a handler is logged in main and replaced with a generic line before
 * it crosses. Node's fs errors read `ENOENT: no such file or directory, open 'C:\Users\…'`, and
 * handing the renderer absolute paths and internal structure undoes the point of not trusting it.
 * (Fable review P2-1.)
 */
class UserFacingError extends Error {}

/**
 * Paths main has offered to the renderer this session, and will therefore accept back.
 *
 * ⚠️ The comparison against this set is deliberately dumb string equality, and must stay that way:
 * normalizing inside the check would mean the string the renderer echoes back no longer has to
 * equal what was offered, which is the whole mechanism. Normalization belongs at *offer* time —
 * `parseInstallList` and `browseForInstallation` both canonicalize, and they agree. (Fable P2-7.)
 *
 * Containment against the filesystem is a separate concern and lives in containedPath.ts; this set
 * is not what protects the disk.
 */
const offeredPaths = new Set<string>();

function offer(installations: readonly Installation[]): Installation[] {
  for (const installation of installations) offeredPaths.add(installation.path);
  return [...installations];
}

function asOfferedPath(value: unknown): string {
  if (typeof value !== 'string') throw new UserFacingError('installation must be a string');
  if (!offeredPaths.has(value)) {
    // Not a "does this exist" check — a "did we offer this" check. The distinction is the point.
    throw new UserFacingError('that installation was not offered by the application');
  }
  return value;
}

function requireInstallation(userData: string): string {
  const { installation } = readSettings(userData);
  if (!installation) throw new UserFacingError('no X-Plane installation has been chosen yet');
  return installation;
}

/**
 * Register one handler, with the two guards every handler needs.
 *
 * Sender validation is cheap belt-and-braces today — child windows are denied, there are no
 * webviews, and preloads do not run in subframes — but the boundary is supposed to have it.
 * (Fable P2-3.)
 */
function handle<T>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('rejected');
    }
    try {
      return await fn(event, ...args);
    } catch (error) {
      if (error instanceof UserFacingError) throw new Error(error.message);
      console.error(`[main] ${channel} failed:`, error);
      throw new Error('something went wrong — see the application log');
    }
  });
}

export function registerIpc(): void {
  const userData = app.getPath('userData');

  handle('xop:getVersion', () => __APP_VERSION__);

  handle('xop:listInstallations', (): Installation[] => offer(findInstallations()));

  handle('xop:currentInstallation', (): Installation | null => {
    const { installation } = readSettings(userData);
    if (!installation) return null;
    const described = describeInstallation(installation);
    // The set is in-memory and empty at launch, so without this a saved installation would be
    // unselectable after a restart. It means membership is "a path main read from disk this
    // session", not "a path a human saw" — which is the right scope. (Fable P2-6.)
    offeredPaths.add(described.path);
    return described;
  });

  handle('xop:selectInstallation', (_event, raw: unknown): Installation => {
    const path = asOfferedPath(raw);
    const described = describeInstallation(path);
    if (!described.usable) {
      throw new UserFacingError(described.problem ?? 'that installation cannot be used');
    }
    writeSettings(userData, { installation: path });
    return described;
  });

  handle('xop:browseForInstallation', async (event): Promise<Installation | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await (window
      ? dialog.showOpenDialog(window, {
          title: 'Choose your X-Plane 12 folder',
          properties: ['openDirectory'],
        })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }));

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (!chosen) return null;

    // Canonicalize here, at offer time, so the membership check downstream can stay dumb. Matches
    // what parseInstallList does to the entries it returns.
    const path = chosen.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!isInstallation(path)) {
      throw new UserFacingError(
        'that folder is not an X-Plane installation — no Resources/default scenery inside',
      );
    }
    offeredPaths.add(path);
    writeSettings(userData, { installation: path });
    return describeInstallation(path);
  });

  handle('xop:getCatalog', (): CatalogSnapshot | null =>
    readCachedCatalog(userData, requireInstallation(userData)),
  );

  handle('xop:rescanCatalog', (event): Promise<CatalogSnapshot> => {
    const installation = requireInstallation(userData);
    const send = (progress: ScanProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send(SCAN_PROGRESS, progress);
    };
    return runScan(userData, installation, send);
  });
}
