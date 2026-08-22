/**
 * What the map has to do about one object, given what it drew last time.
 *
 * Pure and Leaflet-free on purpose: importing Leaflet under Node throws, because it touches
 * `window` while the module loads. Keeping this decision in its own file means the part worth
 * testing is testable.
 *
 * The store guarantees structural sharing, so an unchanged object arrives at the same reference and
 * can simply be skipped. That is what keeps a drag at sixty frames a second when a hundred objects
 * are on screen.
 */

import type { GroundBox, PlacedObject } from '../../core/model.js';
import type { CatalogEntry } from '../../shared/api.js';

/** `skip` = untouched. `restyle` = only the selection flag flipped. `rebuild` = geometry changed. */
export type SyncAction = 'skip' | 'restyle' | 'rebuild';

/**
 * `catalogChanged` is a rescan: the entry an object points at may now have a different footprint,
 * or have stopped existing, even though the object itself was never touched. Skipping on reference
 * equality there would leave a stale box on the map with nothing to hint at it.
 */
export function diffEntry(
  previous: { object: PlacedObject; selected: boolean } | undefined,
  object: PlacedObject,
  selected: boolean,
  catalogChanged = false,
): SyncAction {
  if (!previous) return 'rebuild';
  if (catalogChanged) return 'rebuild';
  if (previous.object === object && previous.selected === selected) return 'skip';
  if (previous.object === object) return 'restyle';
  return 'rebuild';
}

/** Why an object would draw as a placeholder rather than as itself, or null when it draws fine. */
export type Unknown =
  /** The installation's libraries do not export this virtual path at all. */
  | 'not-in-catalog'
  /** The catalog has it, but nothing could be measured — so its real footprint is not known. */
  | 'unmeasured';

export interface Drawn {
  readonly box: GroundBox;
  readonly unknown: Unknown | null;
}

/** Half-extent of the square drawn for an object whose real footprint is not known, in metres. */
export const PLACEHOLDER_HALF_M = 5;

/**
 * The box to draw for an object, and whether it is the object's own.
 *
 * A placed object can outlive the catalog that described it — a project made on a machine with a
 * third-party library, opened on one without it. X-Plane's answer to a virtual path it cannot
 * resolve is to draw **nothing at all**, silently, so the map has to be the thing that says so.
 * A dashed placeholder that is visibly not a measurement is the honest drawing.
 */
export function drawnBox(
  object: PlacedObject,
  catalogIndex: ReadonlyMap<string, CatalogEntry>,
): Drawn {
  const entry = catalogIndex.get(object.libraryPath);
  const placeholder: GroundBox = {
    minX: -PLACEHOLDER_HALF_M,
    maxX: PLACEHOLDER_HALF_M,
    minZ: -PLACEHOLDER_HALF_M,
    maxZ: PLACEHOLDER_HALF_M,
  };
  if (!entry) return { box: placeholder, unknown: 'not-in-catalog' };
  if (!entry.ground) return { box: placeholder, unknown: 'unmeasured' };
  return { box: entry.ground, unknown: null };
}
