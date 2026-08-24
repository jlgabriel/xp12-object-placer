/**
 * Put a pack into somebody's X-Plane installation, and take it out again.
 *
 * The only module in XOP that writes inside the simulator's folder, kept small on purpose. The
 * decisions are all upstream and pure — `planExport` decides what the files are, `sceneryPacksIni`
 * decides what the line is — so what is left here is doing it carefully.
 *
 * The rules it exists to keep:
 *
 *   - **Touch nothing that is not ours.** A folder that already exists and is not an XOP pack is
 *     refused outright. The user is free to name their pack `X-Plane Landmarks - Paris`; they are
 *     not free to lose it that way.
 *   - **Every path through `containedJoin`.** A pack name reaches this module from the renderer,
 *     and `path.join` contains nothing — `join(root, '../../../../Windows/win.ini')` is exactly
 *     what it looks like. Here that would be a write, not a read.
 *   - **Back the ini up before touching it**, somewhere the user can find, and only ever add or
 *     remove our own one line.
 *   - **Say what happened.** The caller gets the folder, the line, where the line went, and where
 *     the backup is — enough to undo the whole thing by hand.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { containedJoin } from './containedPath.js';
import {
  insertSceneryPack,
  removeSceneryPack,
  type Placement,
} from '../core/install/sceneryPacksIni.js';
import type { ExportPlan } from '../core/export/planExport.js';

const CUSTOM_SCENERY = 'Custom Scenery';
const INI_NAME = 'scenery_packs.ini';

/**
 * The file that makes a folder recognisably ours.
 *
 * It is what lets a second export overwrite the first without asking, while a folder this app did
 * not create is refused.
 *
 * ⚠️⚠️ **This file is a contract as of 1.0.** It is written into the user's simulator and outlives
 * the version that wrote it, so a pack installed by 1.0 has to stay removable by every version
 * after. Two promises follow from that, and `tests/packContract.test.ts` holds both to a literal
 * fixture rather than to whatever the code happens to produce:
 *
 * 1. A folder is ours **iff** it contains `xop-pack.json` with a non-empty `packName`. That test
 *    never gets stricter. Adding a required field later would orphan every pack already installed:
 *    the app would refuse to remove its own work and tell the user it was somebody else's.
 * 2. Unknown fields are ignored, and an unknown `manifest` version still means the pack is ours.
 *    A newer build's pack must be removable by an older one — the alternative is a folder nobody
 *    can uninstall without a file manager.
 */
const MANIFEST_NAME = 'xop-pack.json';

/** The format version this build writes. Absent in pre-1.0 packs, which are otherwise identical. */
const MANIFEST_VERSION = 1;

export interface PackManifest {
  /** Format version of this file, not of the application. See MANIFEST_VERSION. */
  readonly manifest: number;
  /** The version that wrote it, for support. Deliberately not the format version. */
  readonly xop: string;
  readonly packName: string;
  readonly writtenAt: string;
  /** Everything written, pack-relative. Informational: uninstall removes the folder. */
  readonly files: readonly string[];
}

export class InstallError extends Error {}

/**
 * A write refused because something else has the file.
 *
 * ⚠️ This used to say "close X-Plane — it holds on to files in Custom Scenery while it is running",
 * which was a guess, and **measuring it showed the guess was wrong**. With X-Plane 12.4.3 running
 * and a pack loaded, all four of these were allowed: opening the loaded `.dsf` for writing,
 * renaming it, renaming the pack folder, and deleting the pack folder outright. The simulator does
 * not lock what it has read.
 *
 * So the branch stays — a backup, sync or antivirus tool genuinely can hold a file — but the
 * message no longer names a cause that was measured not to happen. Telling somebody to close
 * X-Plane when X-Plane is not the problem sends them to fix the wrong thing.
 *
 * ⚠️ **This does not contradict the dialog asking people to close X-Plane before installing (D16),
 * and neither should be "fixed" to agree with the other.** They are about different things. The
 * dialog's reason is that X-Plane reads `scenery_packs.ini` at startup, so an install it never sees
 * is an install that did nothing. This message's reason would have been file locking, which was
 * measured not to happen — a locked file here means some *other* program, and blaming X-Plane would
 * be a wrong diagnosis of a real error.
 */
function rethrowLocked(error: unknown, what: string): never {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    throw new InstallError(
      `${what} could not be written — another program has it open. A backup, sync or antivirus tool is the usual cause. Close it and try again.`,
    );
  }
  throw error;
}

function customSceneryOf(installation: string): string {
  const folder = join(installation, CUSTOM_SCENERY);
  if (!existsSync(folder)) {
    throw new InstallError(`There is no "${CUSTOM_SCENERY}" folder in ${installation}.`);
  }
  return folder;
}

/** The pack's own folder, refusing anything that would land outside `Custom Scenery`. */
function packRootOf(customScenery: string, packFolder: string): string {
  const root = containedJoin(customScenery, packFolder);
  if (root === null || dirname(root) !== customScenery) {
    throw new InstallError(`"${packFolder}" is not a usable pack name.`);
  }
  return root;
}

/**
 * Read the manifest, or null when this folder is not ours.
 *
 * Deliberately generous about everything except the one field that decides ownership. The previous
 * version of this returned whatever `JSON.parse` produced, so a file containing `{}` — or `0`, or
 * `"hello"` — marked the folder as ours, and this application deletes folders that are ours.
 *
 * Just as deliberately, it does **not** refuse a `manifest` version it has never heard of. A pack
 * written by a later build is still this application's pack, and being unable to uninstall it would
 * be the worst possible reading of "I do not recognise this".
 */
export function readPackManifest(packRoot: string): PackManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(packRoot, MANIFEST_NAME), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const raw = parsed as Record<string, unknown>;
  if (typeof raw.packName !== 'string' || raw.packName === '') return null;

  return {
    // Pre-1.0 packs have no version field and are the same shape, so absence means 1.
    manifest: typeof raw.manifest === 'number' ? raw.manifest : MANIFEST_VERSION,
    xop: typeof raw.xop === 'string' ? raw.xop : 'unknown',
    packName: raw.packName,
    writtenAt: typeof raw.writtenAt === 'string' ? raw.writtenAt : '',
    files: Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === 'string') : [],
  };
}

export interface InstallResult {
  readonly packFolder: string;
  readonly packRoot: string;
  readonly files: readonly string[];
  readonly line: string;
  readonly placement: Placement;
  readonly lineWritten: boolean;
  /** Where the previous `scenery_packs.ini` was kept, when one had to be written. */
  readonly iniBackup?: string;
  readonly warnings: readonly string[];
}

export function installPack(
  installation: string,
  plan: ExportPlan,
  version: string,
): InstallResult {
  const customScenery = customSceneryOf(installation);
  const packRoot = packRootOf(customScenery, plan.packFolder);

  if (existsSync(packRoot) && readPackManifest(packRoot) === null) {
    // Somebody else's scenery, or a folder made by hand. Overwriting it because the names happen
    // to collide would be the single worst thing this application could do.
    throw new InstallError(
      `"${plan.packFolder}" already exists in Custom Scenery and was not made by XP Object Placer. ` +
        'Choose another name, or move that folder out of the way first.',
    );
  }

  // Build beside the target and swap, so a failure part-way through cannot leave a half-written
  // pack that X-Plane would happily load.
  const staging = `${packRoot}.xop-new`;
  rmSync(staging, { recursive: true, force: true });

  try {
    for (const file of plan.files) {
      const target = containedJoin(staging, file.path);
      if (target === null) throw new InstallError(`Refusing to write outside the pack: ${file.path}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }

    const manifest: PackManifest = {
      manifest: MANIFEST_VERSION,
      xop: version,
      packName: plan.packFolder,
      writtenAt: new Date().toISOString(),
      files: plan.files.map((file) => file.path),
    };
    writeFileSync(join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    rmSync(packRoot, { recursive: true, force: true });
    renameSync(staging, packRoot);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    rethrowLocked(error, `The folder "${plan.packFolder}"`);
  }

  const ini = writeIniLine(customScenery, plan);

  return {
    packFolder: plan.packFolder,
    packRoot,
    files: plan.files.map((file) => file.path),
    line: ini.line,
    placement: ini.placement,
    lineWritten: ini.changed,
    ...(ini.backup ? { iniBackup: ini.backup } : {}),
    warnings: [...plan.warnings, ...ini.warnings],
  };
}

interface IniWrite {
  readonly line: string;
  readonly placement: Placement;
  readonly changed: boolean;
  readonly backup?: string;
  readonly warnings: readonly string[];
}

function writeIniLine(customScenery: string, plan: ExportPlan): IniWrite {
  const iniPath = join(customScenery, INI_NAME);

  if (!existsSync(iniPath)) {
    // X-Plane writes this file itself at startup and will find the pack on its own — at the bottom
    // of the list, which is the wrong tier, but the pack does load. Creating the file from nothing
    // would mean inventing the rest of somebody's scenery order, which is not ours to invent.
    return {
      line: plan.sceneryPackLine,
      placement: 'appended',
      changed: false,
      warnings: [
        `There is no ${INI_NAME} yet, so XP Object Placer did not create one. X-Plane will create it and find the pack by itself — at the bottom of the list. Start X-Plane once, then export again to move the pack up to the overlay tier.`,
      ],
    };
  }

  const before = readFileSync(iniPath, 'latin1');
  const edit = insertSceneryPack(before, plan.packFolder);

  if (!edit.changed) {
    return {
      line: edit.line,
      placement: edit.placement,
      changed: false,
      warnings:
        edit.placement === 'disabled-by-user'
          ? [
              `${INI_NAME} lists this pack as disabled. That was left alone — switch it back on there when you want to see it.`,
            ]
          : [],
    };
  }

  // Back up before writing, next to the file, so it is somewhere the user will actually look.
  const backup = join(customScenery, `${INI_NAME}.before_XOP_${plan.packFolder}.bak`);
  try {
    copyFileSync(iniPath, backup);
    const temporary = `${iniPath}.xop-tmp`;
    writeFileSync(temporary, edit.text, 'latin1');
    renameSync(temporary, iniPath);
  } catch (error) {
    rethrowLocked(error, INI_NAME);
  }

  return {
    line: edit.line,
    placement: edit.placement,
    changed: true,
    backup,
    warnings:
      edit.placement === 'appended'
        ? [
            `${INI_NAME} has no *GLOBAL_AIRPORTS* marker, so the pack went at the end of the list rather than at the top of the overlay tier.`,
          ]
        : [],
  };
}

export interface UninstallResult {
  readonly folderRemoved: boolean;
  readonly linesRemoved: readonly string[];
  readonly iniBackup?: string;
}

/**
 * Take a pack out: the folder, and the line.
 *
 * Removing only the folder would leave `scenery_packs.ini` pointing at nothing, which X-Plane
 * tolerates and nobody can read. Removing only the line would leave the scenery installed and
 * invisible. Both, or it is not an uninstall.
 */
export function uninstallPack(installation: string, packFolder: string): UninstallResult {
  const customScenery = customSceneryOf(installation);
  const packRoot = packRootOf(customScenery, packFolder);

  let folderRemoved = false;
  if (existsSync(packRoot)) {
    if (readPackManifest(packRoot) === null) {
      throw new InstallError(
        `"${packFolder}" in Custom Scenery was not made by XP Object Placer, so it will not be deleted.`,
      );
    }
    try {
      rmSync(packRoot, { recursive: true, force: true });
      folderRemoved = true;
    } catch (error) {
      rethrowLocked(error, `The folder "${packFolder}"`);
    }
  }

  const iniPath = join(customScenery, INI_NAME);
  if (!existsSync(iniPath)) return { folderRemoved, linesRemoved: [] };

  const edit = removeSceneryPack(readFileSync(iniPath, 'latin1'), packFolder);
  if (!edit.changed) return { folderRemoved, linesRemoved: [] };

  const backup = join(customScenery, `${INI_NAME}.before_XOP_remove_${packFolder}.bak`);
  try {
    copyFileSync(iniPath, backup);
    const temporary = `${iniPath}.xop-tmp`;
    writeFileSync(temporary, edit.text, 'latin1');
    renameSync(temporary, iniPath);
  } catch (error) {
    rethrowLocked(error, INI_NAME);
  }

  return { folderRemoved, linesRemoved: edit.removed, iniBackup: backup };
}

/** Every XOP pack currently in this installation, for offering an uninstall. */
export function listInstalledPacks(installation: string): PackManifest[] {
  const customScenery = join(installation, CUSTOM_SCENERY);
  if (!existsSync(customScenery)) return [];

  const packs: PackManifest[] = [];
  for (const entry of readdirSync(customScenery, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readPackManifest(join(customScenery, entry.name));
    if (manifest) packs.push(manifest);
  }
  return packs;
}
