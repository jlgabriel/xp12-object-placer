/**
 * Turn a project into a scenery pack, as a plan rather than as an act.
 *
 * Pure: it returns the files that should exist and the line that should go into
 * `scenery_packs.ini`, and writes nothing. Whoever holds the filesystem decides when and where —
 * which is what makes the whole export testable without an X-Plane installation, and what keeps the
 * dangerous half (writing into somebody's simulator) down to one small module.
 *
 * The same split is what made PCT's export testable (docs/LINEAGE.md), and it is the reason a
 * mistake in here shows up in a test rather than in a folder somebody has to clean up.
 */

import { groupByTile, tilePath, type DsfTile } from '../dsf/tile.js';
import type { Project } from '../project/project.js';
import { writeDsfBinary } from '../dsf/writeDsfBinary.js';
import { packFolderName } from './packName.js';
import { sceneryPackLine } from '../install/sceneryPacksIni.js';

/**
 * The copy of the project that travels inside the pack.
 *
 * This application writes DSF and does not read it, so without this an installed pack is a dead
 * end: the objects are in the simulator and there is no way back to editing them. With it, the
 * pack is its own way back — and it travels, so a pack handed to somebody else arrives editable.
 */
export const PROJECT_SIDECAR = 'project.xop';

export interface ExportRequest {
  /** What the user called it. Sanitised here; the plan reports if it had to change. */
  readonly packName: string;
  /**
   * The project being exported.
   *
   * The objects come from in here rather than as a list of their own, so that the scenery and the
   * copy of the project written beside it cannot disagree about what was placed. Two sources for
   * one fact is how the two answers drift.
   */
  readonly project: Project;
  /** Written to `sim/creation_agent` in every tile. */
  readonly creationAgent: string;
  /** MD5 for the DSF footer. Injected, so `src/core` stays free of Node builtins. */
  readonly md5: (bytes: Uint8Array) => Uint8Array;
  /**
   * Every library path this installation can resolve, if it is known.
   *
   * Optional because the planner does not need it to do its job — but when it is given, an object
   * naming something the installation does not have becomes a warning instead of a silent hole in
   * the scenery. X-Plane answers a path it cannot resolve by drawing **nothing**, with no error,
   * so this is the last place anybody could be told.
   */
  readonly knownLibraryPaths?: ReadonlySet<string>;
}

export interface PackFile {
  /** Pack-relative, forward slashes. Never absolute, never climbing out of the pack. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ExportPlan {
  /** The folder name to create under `Custom Scenery`. */
  readonly packFolder: string;
  readonly files: readonly PackFile[];
  readonly tiles: readonly DsfTile[];
  /** The single line the installer adds to `scenery_packs.ini`. */
  readonly sceneryPackLine: string;
  /** Things the user should be told before or after writing. Never a reason to stop. */
  readonly warnings: readonly string[];
}

/**
 * How many tiles it takes before the count is worth mentioning.
 *
 * One or two is ordinary — a project near a tile boundary straddles it and nobody needs telling.
 * A project across ten of them means the user has been working over a very large area, and the pack
 * they are about to install covers all of it.
 */
const TILE_COUNT_WORTH_MENTIONING = 3;

export function planExport(request: ExportRequest): ExportPlan {
  const { project, creationAgent, md5, knownLibraryPaths } = request;
  const objects = project.objects;

  if (objects.length === 0) {
    // A pack with no DSF in it is a folder X-Plane scans and finds nothing in — an installation
    // that looks like it worked and does nothing at all.
    throw new Error('There is nothing placed to export.');
  }

  const name = packFolderName(request.packName);
  const warnings: string[] = [];
  if (name.changed) warnings.push(name.changed);

  const groups = [...groupByTile(objects).values()];
  const files: PackFile[] = groups.map((group) => ({
    path: tilePath(group.tile),
    bytes: writeDsfBinary({
      tile: group.tile,
      objects: group.objects,
      creationAgent,
      md5,
    }),
  }));

  if (groups.length >= TILE_COUNT_WORTH_MENTIONING) {
    warnings.push(
      `These objects span ${groups.length} one-degree tiles, so the pack contains ${groups.length} scenery files.`,
    );
  }

  if (knownLibraryPaths) {
    // Report each missing object once, however many times it was placed: a row of forty of the same
    // unresolvable bollard is one problem, not forty.
    const missing = new Map<string, number>();
    for (const object of objects) {
      if (!knownLibraryPaths.has(object.libraryPath)) {
        missing.set(object.libraryPath, (missing.get(object.libraryPath) ?? 0) + 1);
      }
    }
    for (const [path, count] of missing) {
      warnings.push(
        `This installation has no ${path}` +
          (count > 1 ? ` (placed ${count} times)` : '') +
          ' — X-Plane will draw nothing there, and will not say so.',
      );
    }
  }

  // Last, so the scenery is what the file list leads with. It is a pack file like any other from
  // here on: written into the staging directory, listed in the manifest, and removed with the rest.
  files.push({
    path: PROJECT_SIDECAR,
    bytes: new TextEncoder().encode(`${JSON.stringify(project, null, 2)}
`),
  });

  return {
    packFolder: name.folder,
    files,
    tiles: groups.map((group) => group.tile),
    sceneryPackLine: sceneryPackLine(name.folder),
    warnings,
  };
}
