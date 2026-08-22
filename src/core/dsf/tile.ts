/**
 * DSF tiles: which file a coordinate belongs in, and what that file is called.
 *
 * Verified against a real pack — see reference/dsf-overlay.md.
 * Pure: no I/O, no filesystem, no path module.
 */

import type { LonLat, PlacedObject } from '../model.js';

/** South-west corner of a 1°×1° tile. Always integers. */
export interface DsfTile {
  readonly lat: number;
  readonly lon: number;
}

/**
 * The tile a point falls in.
 *
 * Floor, not truncation. -33.376 belongs to tile -34, not -33; getting this wrong puts the objects
 * in a file X-Plane will never look in for them, and nothing reports an error.
 */
export function dsfTileOf(p: LonLat): DsfTile {
  return { lat: Math.floor(p.lat), lon: Math.floor(p.lon) };
}

/** Signed, zero-padded: 48 -> "+48", -34 -> "-34", 2 -> "+002", -71 -> "-071". */
function signedPad(value: number, digits: number): string {
  const sign = value < 0 ? '-' : '+';
  return sign + String(Math.abs(value)).padStart(digits, '0');
}

/** `"-34-071.dsf"` — latitude first. */
export function tileFileName(tile: DsfTile): string {
  return `${signedPad(tile.lat, 2)}${signedPad(tile.lon, 3)}.dsf`;
}

/** `"-40-080"` — the 10°×10° folder the tile lives in. Floor again, not truncation. */
export function blockFolderName(tile: DsfTile): string {
  const blockLat = Math.floor(tile.lat / 10) * 10;
  const blockLon = Math.floor(tile.lon / 10) * 10;
  return `${signedPad(blockLat, 2)}${signedPad(blockLon, 3)}`;
}

/** `"Earth nav data/-40-080/-34-071.dsf"`, the path inside a scenery pack. Forward slashes. */
export function tilePath(tile: DsfTile): string {
  return `Earth nav data/${blockFolderName(tile)}/${tileFileName(tile)}`;
}

/** Stable key for a tile, usable as a Map key. */
export function tileKey(tile: DsfTile): string {
  return `${tile.lat},${tile.lon}`;
}

/**
 * Split a placement into one group per tile.
 *
 * A project is free to straddle a tile boundary; the export is not. Every object must end up in the
 * file covering its own coordinate, so a pack that spans a border simply contains several DSFs.
 * Groups come back in ascending tile order so that an export plan is deterministic.
 */
export function groupByTile(objects: readonly PlacedObject[]): Map<string, {
  tile: DsfTile;
  objects: PlacedObject[];
}> {
  const groups = new Map<string, { tile: DsfTile; objects: PlacedObject[] }>();

  for (const object of objects) {
    const tile = dsfTileOf(object.position);
    const key = tileKey(tile);
    const existing = groups.get(key);
    if (existing) existing.objects.push(object);
    else groups.set(key, { tile, objects: [object] });
  }

  return new Map(
    [...groups.entries()].sort(([, a], [, b]) => a.tile.lat - b.tile.lat || a.tile.lon - b.tile.lon),
  );
}
