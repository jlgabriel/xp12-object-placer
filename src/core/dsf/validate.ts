/**
 * What has to be true of a placement before it can be written, in either DSF form.
 *
 * One source of truth, because the text writer and the binary writer must refuse exactly the same
 * things for exactly the same reasons. A check that lived in only one of them would mean a project
 * that exports but does not compile, or worse, compiles into something absurd.
 */

import type { PlacedObject } from '../model.js';
import { dsfTileOf, tileKey, type DsfTile } from './tile.js';

/**
 * Throw unless every object is finite, on Earth, and inside this tile.
 *
 * ⚠️ Coordinates are checked BEFORE the tile, and the order is load-bearing. `dsfTileOf(NaN)` is
 * NaN, so a bad coordinate reaching the tile comparison first fails with "belongs to tile -34,NaN"
 * — which sends whoever reads it looking at grouping instead of at the number.
 *
 * And `toFixed` does not save you: `(NaN).toFixed(9)` is `"NaN"`, Infinity gives `"Infinity"`, 1e21
 * gives `"1e+21"`. Any of those in an OBJECT line makes a DSF that DSFTool rejects or that loads
 * somewhere absurd. (Fable review, §5.4.)
 */
export function assertPlaceable(tile: DsfTile, objects: readonly PlacedObject[]): void {
  for (const object of objects) {
    const { lon, lat } = object.position;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`Object ${object.id} has a non-finite position.`);
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(`Object ${object.id} is not on Earth: ${lon}, ${lat}`);
    }
    if (!Number.isFinite(object.rotation)) {
      throw new Error(`Object ${object.id} has a non-finite rotation.`);
    }

    const actual = dsfTileOf(object.position);
    if (tileKey(actual) !== tileKey(tile)) {
      throw new Error(
        `Object ${object.id} at ${lon},${lat} belongs to tile ` +
          `${tileKey(actual)}, not ${tileKey(tile)}. Group with groupByTile() before writing.`,
      );
    }
  }
}

/**
 * The object definitions a placement needs, in first-appearance order.
 *
 * Order is the identity: a DSF refers to a definition by its index in this list, so it has to be
 * stable or a diff between two exports of the same project would be meaningless.
 */
export function definitionsOf(objects: readonly PlacedObject[]): string[] {
  const definitions: string[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    if (!seen.has(object.libraryPath)) {
      seen.add(object.libraryPath);
      definitions.push(object.libraryPath);
    }
  }
  return definitions;
}

/** Into [0, 360). -90 and 270 are the same placement; only one of them should reach the file. */
export function normalizeRotation(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
