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
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';
import { describeInstallation, findInstallations, isInstallation } from '../node/findInstallations.js';
import { readCachedCatalog, readCachedObjectFiles } from './catalogCache.js';
import { loadAirports } from './airportCache.js';
import { clearThumbnails, readThumbnail, writeThumbnail } from './thumbnailCache.js';
import { GeometryError, readObjectGeometry } from '../node/objectGeometry.js';
import { runScan, ScanError } from './runScan.js';
import { logError, logFile, logInfo } from './log.js';
import { readSettings, writeSettings } from './settings.js';
import { WINDOW_BACKGROUND, type Theme } from '../shared/theme.js';
import { planExport } from '../core/export/planExport.js';
import {
  InstallError,
  installPack,
  listInstalledPacks,
  uninstallPack,
} from '../node/installPack.js';
import {
  InvalidProjectError,
  parseProject,
  touchProject,
  UnsupportedSchemaVersionError,
  type Project,
} from '../core/project/project.js';
import {
  documentName,
  forgetProject,
  getCurrentProjectPath,
  isDirty,
  openProject as openProjectFile,
  saveProject as saveProjectFile,
  saveProjectAs as saveProjectAsFile,
  setDirty,
} from './projectFile.js';
import type { Airport } from '../core/airports/aptDat.js';
import type {
  CatalogSnapshot,
  DocumentState,
  ObjectGeometry,
  ExportResult,
  Installation,
  OpenedProject,
  InstalledPack,
  ScanProgress,
  UninstallResult,
} from '../shared/api.js';

declare const __APP_VERSION__: string;

/**
 * How much texture a thumbnail asks for.
 *
 * Larger than the picture, on purpose. Atlases are shared, so an object often occupies a small
 * corner of one; asking for exactly the thumbnail's size would sample a handful of pixels for the
 * part that actually matters.
 */
const TEXTURE_MIP_SIZE = 256;

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

const ExportRequestSchema = z.object({
  packName: z.string().max(300),
  // Validated by parseProject rather than described again here: the project reader is already the
  // one door that decides what a project may look like, and a second description of the same shape
  // is a second answer waiting to disagree with the first.
  project: z.unknown(),
});

/** A pack name coming back from the renderer, before it is allowed near the filesystem. */
const PackNameSchema = z.string().min(1).max(300);

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

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
      // Everything the renderer is not allowed to see goes to the log, which the window can open.
      // Before there was a log this branch was a dead end: the user got one sentence that named no
      // cause, and neither did the bug report. The generic text stays — what changed is that the
      // detail now exists somewhere a person can reach it.
      logError(`${channel} failed`, error);
      throw new Error('something went wrong — use “Open log” for the details');
    }
  });
}

export function registerIpc(): void {
  const userData = app.getPath('userData');

  handle('xop:getVersion', () => __APP_VERSION__);

  /**
   * Show the user their own log.
   *
   * The renderer never learns where the file is — it asks main to reveal it, which is the same rule
   * every other path in this file follows. `.log` has no default application on Windows, so a
   * refused open falls back to selecting the file in the file manager, which always works.
   */
  handle('xop:openLog', async (): Promise<void> => {
    const file = logFile();
    // Guarantees the file exists even in a session that has not failed at anything yet, and stamps
    // the moment the user went looking — useful when reading a log somebody sent.
    logInfo('log opened from the application');
    const problem = await shell.openPath(file);
    if (problem) shell.showItemInFolder(file);
  });

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

  handle('xop:rescanCatalog', async (event): Promise<CatalogSnapshot> => {
    const installation = requireInstallation(userData);
    const send = (progress: ScanProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send(SCAN_PROGRESS, progress);
    };
    let snapshot: CatalogSnapshot;
    try {
      snapshot = await runScan(userData, installation, send);
    } catch (error) {
      // A ScanError is our own sentence about the user's own installation — the same reasoning that
      // lets an InstallError through in exportPack below. Swallowing it was the actual v1.0.0 bug:
      // runScan takes care to say *what* stopped the scan and the catch-all threw that away, so the
      // one message worth reading never left the process.
      if (error instanceof ScanError) {
        // Logged as well as shown. The user reads one sentence and moves on; the report they send
        // three days later needs the timestamp, the build and the stack, and by then the sentence
        // is a paraphrase in a forum post.
        logError('the catalog scan failed', error);
        throw new UserFacingError(error.message);
      }
      throw error;
    }

    // A rescan is the moment an object can change shape, or be repainted, underneath a picture of
    // it. Both caches go: the file map this process is holding, and the thumbnails on disk.
    // Redrawing one costs a millisecond; a stale one costs somebody placing the wrong object.
    objectFiles.delete(installation);
    clearThumbnails(userData, installation);
    return snapshot;
  });

  handle('xop:getAirports', async (): Promise<readonly Airport[]> => {
    const installation = requireInstallation(userData);
    const started = Date.now();
    const airports = await loadAirports(userData, installation);
    // Logged because this is the one operation whose cost depends entirely on how much scenery the
    // user has installed, and the first report about it will be somebody saying it felt slow.
    logInfo(`airports ready: ${airports.length} from this installation in ${Date.now() - started} ms`);
    return airports;
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
        project: touchProject(parseProject(parsed.data.project)),
        creationAgent: `XP Object Placer ${__APP_VERSION__}`,
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
      // An InstallError already says something a person can act on — "another program has it
      // open", "that folder was not made by XOP". Replacing it with the generic line would throw
      // away the only part of the message worth reading.
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

  // ── The document ──────────────────────────────────────────────────────────
  //
  // The same rule as everything above: the renderer says *what*, main decides *where*. Not one of
  // these accepts a path, and the path in DocumentState travels outward only, to be displayed.

  const documentState = (): DocumentState => ({
    name: documentName(),
    path: getCurrentProjectPath(),
    dirty: isDirty(),
  });

  /**
   * Put the document in the title bar, and mark unsaved work with a bullet.
   *
   * The title is the only place an unsaved-work indicator costs nothing and is always visible —
   * including when the window is not focused, which is exactly when somebody is about to close it
   * by reflex.
   */
  const retitle = (event: IpcMainInvokeEvent): DocumentState => {
    BrowserWindow.fromWebContents(event.sender)?.setTitle(
      `${documentName()}${isDirty() ? ' •' : ''} — XP Object Placer ${__APP_VERSION__}`,
    );
    return documentState();
  };

  const PROJECT_FILTER = [
    { name: 'XP Object Placer project', extensions: ['xop'] },
    { name: 'All files', extensions: ['*'] },
  ];

  const pickToOpen = (event: IpcMainInvokeEvent) => async (): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Open a project',
      filters: PROJECT_FILTER,
      properties: ['openFile' as const],
    };
    const result = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));
    return result.canceled ? null : (result.filePaths[0] ?? null);
  };

  const pickToSave = (event: IpcMainInvokeEvent) => async (): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Save project',
      // Offer the open file when there is one, so Save As beside an existing project starts in the
      // folder that project lives in rather than wherever the last unrelated dialog was.
      defaultPath: getCurrentProjectPath() ?? `${documentName()}.xop`,
      filters: PROJECT_FILTER,
    };
    const result = await (window
      ? dialog.showSaveDialog(window, options)
      : dialog.showSaveDialog(options));
    return result.canceled ? null : (result.filePath ?? null);
  };

  /**
   * Turn what the renderer sent into a project, or into a sentence somebody can read.
   *
   * It goes through the same door as a file off the disk. "The renderer owns this state" describes
   * the honest case, and this layer is written for the other one.
   */
  const asProject = (raw: unknown): Project => {
    try {
      return parseProject(raw);
    } catch (error) {
      if (error instanceof UnsupportedSchemaVersionError || error instanceof InvalidProjectError) {
        throw new UserFacingError(error.message);
      }
      throw new UserFacingError('that project does not make sense');
    }
  };

  handle('xop:newProject', (event): DocumentState => {
    forgetProject();
    return retitle(event);
  });

  handle('xop:openProject', async (event): Promise<OpenedProject | null> => {
    try {
      const opened = await openProjectFile(pickToOpen(event));
      if (!opened) return null;
      return { document: retitle(event), project: opened.project };
    } catch (error) {
      if (error instanceof UnsupportedSchemaVersionError || error instanceof InvalidProjectError) {
        throw new UserFacingError(error.message);
      }
      // A Zod failure here means a .xop whose shape is wrong. The user does not need the path
      // through the schema that failed; they need to know the file is not one of ours.
      throw new UserFacingError('that file is not a project this build can read');
    }
  });

  handle('xop:saveProject', async (event, raw: unknown): Promise<DocumentState | null> => {
    const written = await saveProjectFile(asProject(raw), pickToSave(event));
    return written === null ? null : retitle(event);
  });

  handle('xop:saveProjectAs', async (event, raw: unknown): Promise<DocumentState | null> => {
    const written = await saveProjectAsFile(asProject(raw), pickToSave(event));
    return written === null ? null : retitle(event);
  });

  handle('xop:markDirty', (event, raw: unknown): DocumentState => {
    setDirty(raw === true);
    return retitle(event);
  });

  /**
   * Remember the palette the user just picked.
   *
   * Three things have to agree, and they are all here because they all outlive the renderer: the
   * setting the next launch reads, the colour Electron paints behind the page (or a resize drags a
   * dark rectangle across a light window), and `nativeTheme`, which is what makes main's own
   * dialogs — the unsaved-work box, the file pickers — match the window they belong to.
   */
  handle('xop:setTheme', (event, raw: unknown): void => {
    if (raw !== 'light' && raw !== 'dark') throw new UserFacingError('unknown theme');
    const theme: Theme = raw;
    writeSettings(userData, { theme });
    nativeTheme.themeSource = theme;
    BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(WINDOW_BACKGROUND[theme]);
  });

  // destroy(), not close(): close() would fire the guard in index.ts again, and the user has
  // already answered that question — this channel is only reached after they did.
  handle('xop:closeWindow', (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.destroy();
  });

  // ── Thumbnails ────────────────────────────────────────────────────────────
  //
  // The renderer draws these, because only the renderer has a GPU; main opens the files, because
  // only main may. The renderer names an object by the virtual path the catalog gave it and never
  // by a path of its own, and that name is checked against the scan — the same rule, for the same
  // reason, as `selectInstallation`.

  /** Loaded once per installation and kept: a scan is the only thing that changes it. */
  const objectFiles = new Map<string, ReadonlyMap<string, string>>();

  const fileForObject = (installation: string, virtualPath: string): string => {
    let map = objectFiles.get(installation);
    if (!map) {
      const loaded = readCachedObjectFiles(userData, installation);
      if (!loaded) throw new UserFacingError('this installation has not been scanned yet');
      objectFiles.set(installation, loaded);
      map = loaded;
    }
    const file = map.get(virtualPath);
    if (file === undefined) {
      throw new UserFacingError('that object is not in this installation’s catalog');
    }
    return file;
  };

  const VirtualPathSchema = z.string().min(1).max(1024);
  const asVirtualPath = (raw: unknown): string => {
    const parsed = VirtualPathSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError('that is not an object name');
    return parsed.data;
  };

  handle('xop:getObjectGeometry', (_event, raw: unknown): ObjectGeometry => {
    const installation = requireInstallation(userData);
    const file = fileForObject(installation, asVirtualPath(raw));
    try {
      return readObjectGeometry(file, TEXTURE_MIP_SIZE);
    } catch (error) {
      if (error instanceof GeometryError) throw new UserFacingError(error.message);
      throw error;
    }
  });

  handle('xop:getThumbnail', (_event, raw: unknown): Uint8Array | null =>
    readThumbnail(userData, requireInstallation(userData), asVirtualPath(raw)),
  );

  handle('xop:putThumbnail', (_event, raw: unknown, png: unknown): boolean => {
    const installation = requireInstallation(userData);
    const virtualPath = asVirtualPath(raw);
    // Refuse to store a picture of an object this installation does not have. The cache is keyed by
    // name, and a name nobody offered would sit in it being served to somebody later.
    fileForObject(installation, virtualPath);
    if (!(png instanceof Uint8Array)) throw new UserFacingError('that is not an image');
    return writeThumbnail(userData, installation, virtualPath, png);
  });
}
