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
 * It is what lets a second export overwrite the first without asking, while a folder XOP did not
 * create is refused. It doubles as the uninstall manifest: everything that was written is listed,
 * so removal takes out what was put there rather than whatever happens to be in the folder now.
 */
const MANIFEST_NAME = 'xop-pack.json';

export interface PackManifest {
  readonly xop: string;
  readonly packName: string;
  readonly writtenAt: string;
  readonly files: readonly string[];
}

export class InstallError extends Error {}

/**
 * X-Plane holds files in `Custom Scenery` open while it runs, so a write there can fail with the
 * simulator apparently doing nothing wrong. Guessing at the cause would be unhelpful; naming the
 * likely one, and saying what to do about it, is not.
 */
function rethrowLocked(error: unknown, what: string): never {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    throw new InstallError(
      `${what} is in use. Close X-Plane, then try again — it holds on to files in Custom Scenery while it is running.`,
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

export function readPackManifest(packRoot: string): PackManifest | null {
  try {
    return JSON.parse(readFileSync(join(packRoot, MANIFEST_NAME), 'utf8')) as PackManifest;
  } catch {
    return null;
  }
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
      `"${plan.packFolder}" already exists in Custom Scenery and was not made by XOP. ` +
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
        `There is no ${INI_NAME} yet, so XOP did not write one. X-Plane will create it and find the pack by itself — at the bottom of the list. Start X-Plane once, then export again to move the pack up to the overlay tier.`,
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
              `${INI_NAME} lists this pack as disabled. XOP left that alone — switch it back on there when you want to see it.`,
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
        `"${packFolder}" in Custom Scenery was not made by XOP, so XOP will not delete it.`,
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
