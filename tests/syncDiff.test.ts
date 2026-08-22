import { describe, expect, it } from 'vitest';
import { diffEntry, drawnBox, PLACEHOLDER_HALF_M } from '../src/renderer/map/syncDiff.js';
import type { PlacedObject } from '../src/core/model.js';
import type { CatalogEntry } from '../src/shared/api.js';

const OBJECT: PlacedObject = {
  id: 'obj-1',
  libraryPath: 'lib/airport/hangars/arched/16x16/rusted_1.obj',
  position: { lon: -70.7846, lat: -33.376 },
  rotation: 30,
};

function catalogWith(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  return new Map(entries.map((entry) => [entry.virtualPath, entry]));
}

const HANGAR: CatalogEntry = {
  virtualPath: OBJECT.libraryPath,
  name: 'rusted_1',
  category: ['airport', 'hangars', 'arched', '16x16'],
  variantCount: 1,
  animated: false,
  grounded: false,
  size: { width: 16.4, height: 6, depth: 16.1 },
  ground: { minX: -8.2, maxX: 8.2, minZ: -16.1, maxZ: 0 },
};

describe('diffEntry', () => {
  it('builds what it has never seen', () => {
    expect(diffEntry(undefined, OBJECT, false)).toBe('rebuild');
  });

  it('skips an object that arrived at the same reference with the same selection', () => {
    // The store guarantees structural sharing, and this is what cashes it in: a hundred objects on
    // screen and a drag on one of them touches exactly one shape.
    expect(diffEntry({ object: OBJECT, selected: false }, OBJECT, false)).toBe('skip');
  });

  it('restyles when only the selection flipped', () => {
    expect(diffEntry({ object: OBJECT, selected: false }, OBJECT, true)).toBe('restyle');
    expect(diffEntry({ object: OBJECT, selected: true }, OBJECT, false)).toBe('restyle');
  });

  it('rebuilds when the object itself changed', () => {
    const moved = { ...OBJECT, rotation: 45 };
    expect(diffEntry({ object: OBJECT, selected: true }, moved, true)).toBe('rebuild');
  });

  it('rebuilds everything after a rescan, even objects nobody touched', () => {
    // A rescan can change an object's footprint or take it out of the catalog entirely, and the
    // placed object's reference says nothing about either. Skipping here leaves a stale box drawn
    // with nothing to hint at it.
    expect(diffEntry({ object: OBJECT, selected: false }, OBJECT, false, true)).toBe('rebuild');
  });
});

describe('drawnBox', () => {
  it("uses the object's own measured footprint when there is one", () => {
    const drawn = drawnBox(OBJECT, catalogWith([HANGAR]));
    expect(drawn.unknown).toBeNull();
    expect(drawn.box).toEqual(HANGAR.ground);
  });

  it('falls back to a marked placeholder when the installation does not have the object', () => {
    // X-Plane answers an unresolvable library path by drawing nothing at all, silently. The map has
    // to be the thing that says so, and a square that is visibly not a measurement is that.
    const drawn = drawnBox(OBJECT, catalogWith([]));
    expect(drawn.unknown).toBe('not-in-catalog');
    expect(drawn.box.maxX).toBe(PLACEHOLDER_HALF_M);
  });

  it('distinguishes "not here" from "here but unmeasured"', () => {
    // Different problems: one will draw nothing in the simulator, the other will draw fine and we
    // simply do not know its size. Both get a placeholder; only the reason tells them apart.
    const unmeasured: CatalogEntry = {
      virtualPath: OBJECT.libraryPath,
      name: 'rusted_1',
      category: [],
      variantCount: 1,
      animated: false,
      grounded: false,
    };
    expect(drawnBox(OBJECT, catalogWith([unmeasured])).unknown).toBe('unmeasured');
  });
});
