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

import { createHash } from 'node:crypto';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { describeInstallation, findInstallations, isInstallation } from '../node/findInstallations.js';
import { readCachedCatalog } from './catalogCache.js';
import { runScan } from './runScan.js';
import { readSettings, writeSettings } from './settings.js';
import { planExport } from '../core/export/planExport.js';
import {
  InstallError,
  installPack,
  listInstalledPacks,
  uninstallPack,
} from '../node/installPack.js';
import type { PlacedObject } from '../core/model.js';
import type {
  CatalogSnapshot,
  ExportResult,
  Installation,
  InstalledPack,
  ScanProgress,
  UninstallResult,
} from '../shared/api.js';

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

/**
 * What an export request is allowed to look like.
 *
 * The renderer is not trusted, and this is the one channel where it hands over a whole data
 * structure rather than a single string. Everything downstream — the DSF writer, the pool encoder,
 * the installer — is written against objects that make sense, so the boundary is where nonsense
 * stops. The limits are generous enough that no real project meets them and small enough that a
 * runaway renderer cannot ask main to allocate its way out of memory.
 */
const PlacedObjectSchema = z.object({
  id: z.string().min(1).max(200),
  libraryPath: z.string().min(1).max(1024),
  position: z.object({
    lon: z.number().refine(Number.isFinite, 'longitude must be a real number'),
    lat: z.number().refine(Number.isFinite, 'latitude must be a real number'),
  }),
  rotation: z.number().refine(Number.isFinite, 'rotation must be a real number'),
  label: z.string().max(300).optional(),
  locked: z.boolean().optional(),
});

const ExportRequestSchema = z.object({
  packName: z.string().max(300),
  objects: z.array(PlacedObjectSchema).min(1).max(100_000),
});

/** A pack name coming back from the renderer, before it is allowed near the filesystem. */
const PackNameSchema = z.string().min(1).max(300);

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

/**
 * Rebuild what came across as a domain object, rather than passing the parsed shape along.
 *
 * Not ceremony: an absent optional and an optional explicitly set to `undefined` are different
 * types here, and the interesting half of that is what it forces — nothing reaches the exporter
 * except the six fields it is allowed to see, whatever else the renderer put in the message.
 */
function toPlacedObject(parsed: z.infer<typeof PlacedObjectSchema>): PlacedObject {
  return {
    id: parsed.id,
    libraryPath: parsed.libraryPath,
    position: { lon: parsed.position.lon, lat: parsed.position.lat },
    rotation: parsed.rotation,
    ...(parsed.label === undefined ? {} : { label: parsed.label }),
    ...(parsed.locked === undefined ? {} : { locked: parsed.locked }),
  };
}

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

  handle('xop:exportPack', (_event, raw: unknown): ExportResult => {
    const installation = requireInstallation(userData);
    const parsed = ExportRequestSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError('that export request does not make sense');

    // The cached catalog is what lets the plan warn about an object this installation cannot
    // resolve. Absent, the export still works — it just cannot say anything about that.
    const catalog = readCachedCatalog(userData, installation);
    const known = catalog ? new Set(catalog.entries.map((entry) => entry.virtualPath)) : undefined;

    try {
      const plan = planExport({
        packName: parsed.data.packName,
        objects: parsed.data.objects.map(toPlacedObject),
        creationAgent: `XOP ${__APP_VERSION__}`,
        md5,
        ...(known ? { knownLibraryPaths: known } : {}),
      });
      const result = installPack(installation, plan, __APP_VERSION__);
      return {
        packFolder: result.packFolder,
        packRoot: result.packRoot,
        fileCount: result.files.length,
        tileCount: plan.tiles.length,
        line: result.line,
        lineWritten: result.lineWritten,
        placement: result.placement,
        ...(result.iniBackup ? { iniBackup: result.iniBackup } : {}),
        warnings: result.warnings,
      };
    } catch (error) {
      // An InstallError already says something a person can act on — "close X-Plane first", "that
      // folder was not made by XOP". Replacing it with the generic line would throw away the only
      // part of the message worth reading.
      if (error instanceof InstallError || error instanceof RangeError) {
        throw new UserFacingError(error.message);
      }
      if (error instanceof Error && /nothing placed/i.test(error.message)) {
        throw new UserFacingError(error.message);
      }
      throw error;
    }
  });

  handle('xop:listInstalledPacks', (): InstalledPack[] =>
    listInstalledPacks(requireInstallation(userData)).map((manifest) => ({
      packName: manifest.packName,
      writtenAt: manifest.writtenAt,
      fileCount: manifest.files.length,
      xop: manifest.xop,
    })),
  );

  handle('xop:uninstallPack', (_event, raw: unknown): UninstallResult => {
    const installation = requireInstallation(userData);
    const parsed = PackNameSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError('that is not a pack name');
    try {
      const result = uninstallPack(installation, parsed.data);
      return { folderRemoved: result.folderRemoved, linesRemoved: result.linesRemoved };
    } catch (error) {
      if (error instanceof InstallError) throw new UserFacingError(error.message);
      throw error;
    }
  });
}
