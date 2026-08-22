/**
 * Generate the DSF2TEXT source for one overlay tile.
 *
 * Pure: takes a tile and its objects, returns a string. It touches no filesystem and knows nothing
 * about DSFTool — compiling the text is somebody else's job. This is the same split that made PCT's
 * export testable (docs/LINEAGE.md).
 *
 * The dialect emitted here is the one DSFTool round-trips; see reference/dsf-overlay.md.
 */

import type { PlacedObject } from '../model.js';
import { dsfTileOf, tileKey, type DsfTile } from './tile.js';

export interface DsfTextInput {
  readonly tile: DsfTile;
  readonly objects: readonly PlacedObject[];
  /** Written to `sim/creation_agent`. How a pack says who made it. */
  readonly creationAgent: string;
}

/** DSFTool writes 9 decimals for coordinates and 6 for rotation. Match it, so diffs stay readable. */
const COORD_DECIMALS = 9;
const ROTATION_DECIMALS = 6;

/** Into [0, 360). -90 and 270 are the same placement; only one of them should reach the file. */
function normalizeRotation(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function writeDsfText(input: DsfTextInput): string {
  const { tile, objects, creationAgent } = input;

  for (const object of objects) {
    const actual = dsfTileOf(object.position);
    if (tileKey(actual) !== tileKey(tile)) {
      throw new Error(
        `Object ${object.id} at ${object.position.lon},${object.position.lat} belongs to tile ` +
          `${tileKey(actual)}, not ${tileKey(tile)}. Group with groupByTile() before writing.`,
      );
    }
    if (!Number.isFinite(object.rotation)) {
      throw new Error(`Object ${object.id} has a non-finite rotation.`);
    }
  }

  // Definition order is first appearance, so the output is stable and a diff means something.
  const definitions: string[] = [];
  const indexOf = new Map<string, number>();
  for (const object of objects) {
    if (!indexOf.has(object.libraryPath)) {
      indexOf.set(object.libraryPath, definitions.length);
      definitions.push(object.libraryPath);
    }
  }

  const lines: string[] = [
    'I',
    '800',
    'DSF2TEXT',
    '',
    `PROPERTY sim/west ${tile.lon}`,
    `PROPERTY sim/east ${tile.lon + 1}`,
    `PROPERTY sim/north ${tile.lat + 1}`,
    `PROPERTY sim/south ${tile.lat}`,
    'PROPERTY sim/planet earth',
    'PROPERTY sim/overlay 1',
    `PROPERTY sim/creation_agent ${creationAgent}`,
    '',
  ];

  for (const path of definitions) lines.push(`OBJECT_DEF ${path}`);
  lines.push('');

  for (const object of objects) {
    const index = indexOf.get(object.libraryPath)!;
    lines.push(
      `OBJECT ${index} ` +
        `${object.position.lon.toFixed(COORD_DECIMALS)} ` +
        `${object.position.lat.toFixed(COORD_DECIMALS)} ` +
        `${normalizeRotation(object.rotation).toFixed(ROTATION_DECIMALS)}`,
    );
  }

  return lines.join('\n') + '\n';
}
