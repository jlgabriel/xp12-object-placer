import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../src/renderer/state/store.js';
import {
  DEFAULT_CAMERA,
  newProject,
  parseProject,
  UNTITLED,
  type Project,
} from '../src/core/project/project.js';
import { projectOf } from '../src/renderer/state/store.js';
import type { PlacedObject } from '../src/core/model.js';
import type { CatalogEntry } from '../src/shared/api.js';
import { haversine } from '../src/core/geo/geo.js';

const HANGAR: CatalogEntry = {
  virtualPath: 'lib/airport/hangars/arched/16x16/rusted_1.obj',
  name: 'rusted_1',
  category: ['airport', 'hangars', 'arched', '16x16'],
  variantCount: 1,
  animated: false,
  grounded: false,
  size: { width: 16.4, height: 6, depth: 16.1 },
  ground: { minX: -8.2, maxX: 8.2, minZ: -16.1, maxZ: 0 },
};

const TRUCK: CatalogEntry = {
  ...HANGAR,
  virtualPath: 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj',
  name: 'Large_Fuel_Truck',
  category: ['airport', 'Common_Elements', 'Vehicles'],
};

const SOMEWHERE = { lon: -70.7846, lat: -33.376 };

function armed(): ReturnType<typeof createEditorStore> {
  const store = createEditorStore();
  store.getState().setCatalog([HANGAR, TRUCK]);
  store.getState().arm(HANGAR.virtualPath);
  return store;
}

describe('placing', () => {
  it('does nothing at all when nothing is armed', () => {
    const store = createEditorStore();
    store.getState().placeAt(SOMEWHERE);
    expect(store.getState().objects).toHaveLength(0);
  });

  it('places the armed object, at rotation 0, and selects it', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    const [object] = store.getState().objects;
    expect(object).toMatchObject({
      id: 'obj-1',
      libraryPath: HANGAR.virtualPath,
      position: SOMEWHERE,
      rotation: 0,
      label: 'rusted_1',
    });
    expect(store.getState().selection).toEqual(['obj-1']);
  });

  it('stays armed, so a row of the same object is a row of clicks', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: -70.784, lat: -33.376 });
    expect(store.getState().objects.map((o) => o.id)).toEqual(['obj-1', 'obj-2']);
    expect(store.getState().placing).toBe(HANGAR.virtualPath);
  });

  it('wraps a longitude from a repeated world copy back onto the real place', () => {
    const store = armed();
    store.getState().placeAt({ lon: -70.7846 + 360, lat: -33.376 });
    expect(store.getState().objects[0]!.position.lon).toBeCloseTo(-70.7846, 9);
  });

  it('places an object the catalog has never heard of, unlabelled rather than refused', () => {
    // A project can outlive the library it was made with. Refusing the placement outright would be
    // the wrong end to fix that at; the map says so instead.
    const store = createEditorStore();
    store.getState().arm('lib/gone/shed.obj');
    store.getState().placeAt(SOMEWHERE);
    expect(store.getState().objects[0]).toMatchObject({ libraryPath: 'lib/gone/shed.obj' });
    expect(store.getState().objects[0]!.label).toBeUndefined();
  });
});

describe('editing', () => {
  it('normalizes rotation into [0, 360)', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().rotateObject('obj-1', -90);
    expect(store.getState().objects[0]!.rotation).toBe(270);
    store.getState().rotateObject('obj-1', 370);
    expect(store.getState().objects[0]!.rotation).toBe(10);
  });

  it('leaves every untouched object at the same reference', () => {
    // Not an optimisation: the map layer diffs by reference, and without this every drag would
    // rebuild every shape on screen.
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: -70.784, lat: -33.376 });
    const before = store.getState().objects;

    store.getState().moveObject('obj-1', { lon: -70.785, lat: -33.3765 });
    const after = store.getState().objects;

    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('forgets the selection when the selected object is removed, and only then', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: -70.784, lat: -33.376 });
    store.getState().select('obj-2');

    store.getState().deleteObject('obj-1');
    expect(store.getState().selection).toEqual(['obj-2']);

    store.getState().deleteObject('obj-2');
    expect(store.getState().selection).toEqual([]);
    expect(store.getState().objects).toHaveLength(0);
  });
});

describe('selecting', () => {
  /** Three objects, none selected. */
  function three(): ReturnType<typeof armed> {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: -70.784, lat: -33.376 });
    store.getState().placeAt({ lon: -70.7834, lat: -33.376 });
    store.getState().select(null);
    return store;
  }

  it('replaces by default and adds on toggle', () => {
    const store = three();
    store.getState().select('obj-1');
    store.getState().select('obj-2');
    expect(store.getState().selection).toEqual(['obj-2']);

    store.getState().select('obj-3', 'toggle');
    expect(store.getState().selection).toEqual(['obj-2', 'obj-3']);
  });

  it('toggling something already selected takes it back out', () => {
    const store = three();
    store.getState().selectMany(['obj-1', 'obj-2']);
    store.getState().select('obj-1', 'toggle');
    expect(store.getState().selection).toEqual(['obj-2']);
  });

  it('never holds the same id twice, however it was asked', () => {
    const store = three();
    store.getState().selectMany(['obj-1', 'obj-2', 'obj-1']);
    expect(store.getState().selection).toEqual(['obj-1', 'obj-2']);
  });

  // Both the map layer and the React hook compare selections by reference, so a no-op that hands
  // back a fresh array repaints every footprint on screen for nothing.
  it('keeps the same array when a click changes nothing', () => {
    const store = three();
    store.getState().select('obj-1');
    const before = store.getState().selection;
    store.getState().select('obj-1');
    expect(store.getState().selection).toBe(before);

    store.getState().select(null);
    const empty = store.getState().selection;
    store.getState().select(null);
    expect(store.getState().selection).toBe(empty);
  });

  it('selecting is not an edit', () => {
    const store = three();
    store.getState().markSaved('saved');
    store.getState().select('obj-1');
    store.getState().select('obj-2', 'toggle');
    store.getState().select(null);
    expect(store.getState().dirty).toBe(false);
  });

  it('deleteSelection removes all of it at once', () => {
    const store = three();
    store.getState().selectMany(['obj-1', 'obj-3']);
    store.getState().deleteSelection();

    expect(store.getState().objects.map((object) => object.id)).toEqual(['obj-2']);
    expect(store.getState().selection).toEqual([]);
  });

  it('deleteSelection with nothing selected touches nothing', () => {
    const store = three();
    store.getState().markSaved('saved');
    store.getState().deleteSelection();
    expect(store.getState().objects).toHaveLength(3);
    expect(store.getState().dirty).toBe(false);
  });
});

describe('moving several at once', () => {
  it('moves every leg and leaves the rest at the same reference', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: -70.784, lat: -33.376 });
    store.getState().placeAt({ lon: -70.7834, lat: -33.376 });
    const before = store.getState().objects;

    store.getState().moveObjects([
      { id: 'obj-1', position: { lon: -70.79, lat: -33.38 } },
      { id: 'obj-3', position: { lon: -70.7833, lat: -33.3759 } },
    ]);

    const after = store.getState().objects;
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).not.toBe(before[2]);
    expect(after[0]!.position).toEqual({ lon: -70.79, lat: -33.38 });
  });

  // The same rule `moveObject` follows: a drag across the antimeridian is a real place, said in the
  // range `writeDsfText` will accept.
  it('wraps a longitude the drag ran past', () => {
    const store = armed();
    store.getState().placeAt({ lon: 179.99, lat: 10 });
    store.getState().moveObjects([{ id: 'obj-1', position: { lon: 180.5, lat: 10 } }]);
    expect(store.getState().objects[0]!.position.lon).toBeCloseTo(-179.5, 9);
  });
});

describe('turning a selection', () => {
  function two(): ReturnType<typeof armed> {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: -70.784, lat: -33.376 });
    store.getState().rotateObject('obj-1', 30);
    store.getState().selectMany(['obj-1', 'obj-2']);
    return store;
  }

  it('gives everything selected the same rotation', () => {
    const store = two();
    store.getState().setSelectionRotation(215);
    expect(store.getState().objects.map((object) => object.rotation)).toEqual([215, 215]);
  });

  it('normalises what it is given', () => {
    const store = two();
    store.getState().setSelectionRotation(-90);
    expect(store.getState().objects.map((object) => object.rotation)).toEqual([270, 270]);
  });

  it('turns each one from where it already is', () => {
    const store = two();
    store.getState().turnSelectionBy(90);
    expect(store.getState().objects.map((object) => object.rotation)).toEqual([120, 90]);
  });

  it('leaves an object out of the selection alone', () => {
    const store = two();
    store.getState().select('obj-2');
    store.getState().setSelectionRotation(180);
    expect(store.getState().objects.map((object) => object.rotation)).toEqual([30, 180]);
  });

  // `locked` reads "the map may not drag or turn this", and a bulk turn is a turn. There is no UI
  // for the flag yet; the store honours it because the field is in the project format and a file
  // that carries it must not be quietly overridden by a toolbar button.
  it('will not turn a locked object', () => {
    const store = two();
    const snapshot = projectOf(store.getState());
    const locked = snapshot.objects.map((object, i) => (i === 0 ? { ...object, locked: true } : object));
    store.getState().loadProject({ ...snapshot, objects: locked }, 'x');

    store.getState().selectMany(['obj-1', 'obj-2']);
    store.getState().setSelectionRotation(180);
    expect(store.getState().objects.map((object) => object.rotation)).toEqual([30, 180]);
  });

  // Setting the rotation everything already has is not an edit, and must not put a bullet in the
  // title bar — the same contract the arrange tools live by.
  it('setting the rotation they already have changes nothing', () => {
    const store = two();
    store.getState().setSelectionRotation(215);
    store.getState().markSaved('saved');
    const before = store.getState().objects;

    store.getState().setSelectionRotation(215);
    expect(store.getState().objects).toBe(before);
    expect(store.getState().dirty).toBe(false);
  });
});

describe('the catalog and the camera', () => {
  it('disarms an object a rescan took away', () => {
    // Otherwise the next click on the map places something the map cannot draw a footprint for.
    const store = armed();
    store.getState().setCatalog([TRUCK]);
    expect(store.getState().placing).toBeNull();
  });

  it('keeps the armed object when a rescan still has it', () => {
    const store = armed();
    store.getState().setCatalog([HANGAR, TRUCK]);
    expect(store.getState().placing).toBe(HANGAR.virtualPath);
  });

  it('does not bump the epoch when the camera merely follows a pan', () => {
    // The map watches the epoch, not the camera. If panning bumped it, looking around would yank
    // the view straight back to where it started.
    const store = createEditorStore();
    expect(store.getState().camera).toEqual(DEFAULT_CAMERA);
    store.getState().setCamera({ lon: 5, lat: 5, zoom: 12 });
    expect(store.getState().cameraEpoch).toBe(0);
  });

  it('bumps the epoch when something asks the map to go somewhere', () => {
    const store = createEditorStore();
    store.getState().goTo(SOMEWHERE, 17);
    expect(store.getState().cameraEpoch).toBe(1);
    expect(store.getState().camera).toEqual({ ...SOMEWHERE, zoom: 17 });
  });

  it('keeps the current zoom when a go-to does not name one', () => {
    const store = createEditorStore();
    store.getState().setCamera({ lon: 0, lat: 0, zoom: 18 });
    store.getState().goTo(SOMEWHERE);
    expect(store.getState().camera.zoom).toBe(18);
  });
});

describe('unsaved work', () => {
  it('starts clean and untitled', () => {
    const store = createEditorStore();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().documentName).toBe(UNTITLED);
  });

  // Every one of these has to count, and the point of tracking it by subscription rather than by a
  // line inside each action is that an action added later cannot forget. The one that forgets is
  // the one that loses somebody's work quietly, because the close guard would let the window go.
  it('counts placing, moving, rotating and deleting', () => {
    for (const edit of [
      (s: ReturnType<typeof armed>) => s.getState().placeAt(SOMEWHERE),
      (s: ReturnType<typeof armed>) => {
        s.getState().placeAt(SOMEWHERE);
        s.getState().markSaved('saved');
        s.getState().moveObject(s.getState().objects[0]!.id, { lon: 1, lat: 1 });
      },
      (s: ReturnType<typeof armed>) => {
        s.getState().placeAt(SOMEWHERE);
        s.getState().markSaved('saved');
        s.getState().rotateObject(s.getState().objects[0]!.id, 90);
      },
      (s: ReturnType<typeof armed>) => {
        s.getState().placeAt(SOMEWHERE);
        s.getState().markSaved('saved');
        s.getState().deleteObject(s.getState().objects[0]!.id);
      },
    ]) {
      const store = armed();
      edit(store);
      expect(store.getState().dirty).toBe(true);
    }
  });

  // Looking around is not editing. The camera has never counted as an edit in this store, and a
  // bullet in the title bar for panning the map would teach people to ignore the bullet.
  it('does not count panning, zooming or picking an object to place', () => {
    const store = armed();
    store.getState().setCamera({ lon: 5, lat: 5, zoom: 12 });
    store.getState().goTo(SOMEWHERE, 17);
    store.getState().arm(TRUCK.virtualPath);
    store.getState().setTiles('osm');
    expect(store.getState().dirty).toBe(false);
  });

  it('is clean again once saved', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().markSaved('SCEL apron');
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().documentName).toBe('SCEL apron');
  });
});

describe('opening a project into the store', () => {
  const project = (objects: PlacedObject[]): Project => ({
    ...newProject('2026-08-22T12:00:00.000Z'),
    camera: { lon: -70.78, lat: -33.37, zoom: 17 },
    objects,
  });

  const placed = (id: string): PlacedObject => ({
    id,
    libraryPath: HANGAR.virtualPath,
    position: SOMEWHERE,
    rotation: 0,
  });

  it('replaces the map and leaves nothing unsaved', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);

    store.getState().loadProject(project([placed('obj-1'), placed('obj-2')]), 'Valparaiso');

    expect(store.getState().objects).toHaveLength(2);
    expect(store.getState().documentName).toBe('Valparaiso');
    // A project you just opened has nothing unsaved in it — even though the objects did change,
    // which is the case a naive "objects changed, so it is dirty" gets wrong.
    expect(store.getState().dirty).toBe(false);
  });

  it('looks where the project was left', () => {
    const store = armed();
    store.getState().loadProject(project([]), 'Valparaiso');
    expect(store.getState().camera).toEqual({ lon: -70.78, lat: -33.37, zoom: 17 });
  });

  // Without reseeding, the next object placed after opening obj-1..obj-3 is obj-1 again: two
  // objects with one id, an ambiguous selection, and a map that diffs the wrong one.
  it('resumes ids past the ones it loaded', () => {
    const store = armed();
    store.getState().loadProject(project([placed('obj-1'), placed('obj-2'), placed('obj-3')]), 'x');
    store.getState().arm(HANGAR.virtualPath);
    store.getState().placeAt(SOMEWHERE);

    const ids = store.getState().objects.map((object) => object.id);
    expect(ids).toEqual(['obj-1', 'obj-2', 'obj-3', 'obj-4']);
    expect(new Set(ids).size).toBe(4);
  });

  it('editing an opened project marks it unsaved again', () => {
    const store = armed();
    store.getState().loadProject(project([placed('obj-1')]), 'x');
    store.getState().deleteObject('obj-1');
    expect(store.getState().dirty).toBe(true);
  });

  it('starting a new project empties the map and starts ids over', () => {
    const store = armed();
    store.getState().loadProject(project([placed('obj-1'), placed('obj-9')]), 'x');
    store.getState().resetProject();

    expect(store.getState().objects).toEqual([]);
    expect(store.getState().documentName).toBe(UNTITLED);
    expect(store.getState().dirty).toBe(false);

    store.getState().arm(HANGAR.virtualPath);
    store.getState().placeAt(SOMEWHERE);
    expect(store.getState().objects[0]!.id).toBe('obj-1');
  });
});

describe('the store as a project', () => {
  it('is what gets written: the objects and where the map was looking', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().setCamera({ lon: 1, lat: 2, zoom: 15 });
    store.getState().markSaved('apron');

    const project = projectOf(store.getState());
    expect(project.app).toBe('xop');
    expect(project.name).toBe('apron');
    expect(project.camera).toEqual({ lon: 1, lat: 2, zoom: 15 });
    expect(project.objects).toEqual(store.getState().objects);
    // It has to survive the reader it will meet on the way back in.
    expect(() => parseProject(JSON.parse(JSON.stringify(project)))).not.toThrow();
  });
});

describe('duplicating', () => {
  it('makes a second object with its own id, selected', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    const original = store.getState().objects[0]!;

    store.getState().duplicateSelection();

    const objects = store.getState().objects;
    expect(objects).toHaveLength(2);
    expect(objects[1]!.id).not.toBe(original.id);
    expect(store.getState().selection).toEqual([objects[1]!.id]);
  });

  it('keeps everything about the object except where it is', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    const original = store.getState().objects[0]!;
    store.getState().rotateObject(original.id, 137);

    store.getState().duplicateSelection();
    const [first, copy] = store.getState().objects;

    expect(copy!.libraryPath).toBe(first!.libraryPath);
    expect(copy!.rotation).toBe(137);
    expect(copy!.label).toBe(first!.label);
    expect(copy!.position).not.toEqual(first!.position);
  });

  // A fixed nudge hides a hangar behind a hangar and leaves a bollard metres from its twin. The
  // catalog already knows how wide the thing is.
  it('puts the copy beside the original, clear of its footprint', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().duplicateSelection();

    const [first, copy] = store.getState().objects;
    const metres = haversine(first!.position, copy!.position);
    const width = HANGAR.ground!.maxX - HANGAR.ground!.minX; // 16.4 m
    expect(metres).toBeGreaterThan(width);
    expect(metres).toBeLessThan(width * 2);
    // Due east: same latitude, greater longitude.
    expect(copy!.position.lat).toBeCloseTo(first!.position.lat, 6);
    expect(copy!.position.lon).toBeGreaterThan(first!.position.lon);
  });

  it('still separates an object the catalog never measured', () => {
    const store = createEditorStore();
    store.getState().setCatalog([]);
    store.getState().arm('lib/unknown/thing.obj');
    store.getState().placeAt(SOMEWHERE);
    store.getState().duplicateSelection();

    const [first, copy] = store.getState().objects;
    expect(haversine(first!.position, copy!.position)).toBeGreaterThan(1);
  });

  it('counts as an edit', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().markSaved('saved');
    store.getState().duplicateSelection();
    expect(store.getState().dirty).toBe(true);
  });

  it('does nothing with nothing selected', () => {
    const store = armed();
    store.getState().duplicateSelection();
    expect(store.getState().objects).toEqual([]);
  });

  // The point of duplicating a row rather than an object: the copies have to arrive as a row, not
  // as a heap. One shared step east for all of them is what keeps the shape.
  it('copies a whole selection, keeping its arrangement', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: SOMEWHERE.lon + 0.0004, lat: SOMEWHERE.lat });
    store.getState().placeAt({ lon: SOMEWHERE.lon + 0.0008, lat: SOMEWHERE.lat - 0.0002 });
    store.getState().selectMany(['obj-1', 'obj-2', 'obj-3']);

    store.getState().duplicateSelection();

    const objects = store.getState().objects;
    expect(objects).toHaveLength(6);
    expect(store.getState().selection).toEqual(['obj-4', 'obj-5', 'obj-6']);

    // Asserted in METRES, not in degrees of longitude, and the difference is the point: the copies
    // walk the same distance east, and one degree of longitude is a different distance at every
    // latitude. Two objects at slightly different latitudes therefore pick up slightly different
    // deltas in lon — a quarter of a millimetre here — while staying exactly as far apart on the
    // ground as they were, which is the property that matters for a row of hangars.
    const step = haversine(objects[0]!.position, objects[3]!.position);
    expect(haversine(objects[1]!.position, objects[4]!.position)).toBeCloseTo(step, 6);
    expect(haversine(objects[2]!.position, objects[5]!.position)).toBeCloseTo(step, 6);

    expect(haversine(objects[3]!.position, objects[4]!.position)).toBeCloseTo(
      haversine(objects[0]!.position, objects[1]!.position),
      3, // millimetres
    );
    expect(haversine(objects[4]!.position, objects[5]!.position)).toBeCloseTo(
      haversine(objects[1]!.position, objects[2]!.position),
      3,
    );
  });

  // The whole copied group has to clear the whole original group, or duplicating a row of five
  // hangars puts copy #1 inside original #2.
  it('lands the copies clear of every original', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().placeAt({ lon: SOMEWHERE.lon + 0.0004, lat: SOMEWHERE.lat });
    store.getState().selectMany(['obj-1', 'obj-2']);

    store.getState().duplicateSelection();

    const objects = store.getState().objects;
    const eastmostOriginal = Math.max(objects[0]!.position.lon, objects[1]!.position.lon);
    const westmostCopy = Math.min(objects[2]!.position.lon, objects[3]!.position.lon);
    expect(westmostCopy).toBeGreaterThan(eastmostOriginal);
  });
});

// ── the arrange tools ────────────────────────────────────────────────────────────────────────
//
// The geometry itself is `tests/arrange.test.ts`. What is tested here is the store's half: which
// objects it hands over, which it writes back, and — the one that matters most — that a row already
// in order costs nothing at all.
describe('lining up and spacing a selection', () => {
  /** Three objects along a NE row, with the middle one nudged off the line and up the row. */
  function crooked(): ReturnType<typeof armed> {
    const store = armed();
    store.getState().placeAt({ lon: -70.784, lat: -33.376 });
    store.getState().placeAt({ lon: -70.7834, lat: -33.37567 }); // off the line, and off centre
    store.getState().placeAt({ lon: -70.7828, lat: -33.3755 });
    store.getState().selectMany(['obj-1', 'obj-2', 'obj-3']);
    return store;
  }

  it('moves the strays and leaves the two ends where they are', () => {
    const store = crooked();
    const before = store.getState().objects;

    store.getState().lineUpSelection();

    const after = store.getState().objects;
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('spacing evenly makes the two gaps the same length', () => {
    const store = crooked();
    store.getState().spaceSelectionEvenly();

    const [a, b, c] = store.getState().objects;
    expect(haversine(a!.position, b!.position)).toBeCloseTo(
      haversine(b!.position, c!.position),
      3, // millimetres
    );
  });

  // The one that pays for the reference-preserving contract in core/geo/arrange.ts: an operation
  // that changes nothing must not put a bullet in the title bar.
  it('a row that is already tidy is not an edit', () => {
    const store = crooked();
    store.getState().lineUpSelection();
    store.getState().spaceSelectionEvenly();
    store.getState().markSaved('saved');
    const before = store.getState().objects;

    store.getState().lineUpSelection();
    store.getState().spaceSelectionEvenly();

    expect(store.getState().objects).toBe(before);
    expect(store.getState().dirty).toBe(false);
  });

  it('does nothing with fewer than three selected', () => {
    const store = crooked();
    store.getState().selectMany(['obj-1', 'obj-2']);
    store.getState().markSaved('saved');

    store.getState().lineUpSelection();
    store.getState().spaceSelectionEvenly();
    expect(store.getState().dirty).toBe(false);
  });

  it('does nothing when they are all in the same spot', () => {
    const store = armed();
    for (let i = 0; i < 3; i++) store.getState().placeAt(SOMEWHERE);
    store.getState().selectMany(['obj-1', 'obj-2', 'obj-3']);
    store.getState().markSaved('saved');

    store.getState().lineUpSelection();
    expect(store.getState().dirty).toBe(false);
  });

  it('leaves objects outside the selection alone', () => {
    const store = crooked();
    store.getState().arm(HANGAR.virtualPath);
    store.getState().placeAt({ lon: -70.79, lat: -33.38 }); // obj-4, nowhere near the row
    store.getState().selectMany(['obj-1', 'obj-2', 'obj-3']);
    const outsider = store.getState().objects[3];

    store.getState().lineUpSelection();
    expect(store.getState().objects[3]).toBe(outsider);
  });

  // A locked object is one of the points the row is measured from — that is how somebody pins the
  // axis by hand — but it is never written back.
  it('a locked object helps define the row and does not move', () => {
    const store = crooked();
    const snapshot = projectOf(store.getState());
    const locked = snapshot.objects.map((object, i) => (i === 1 ? { ...object, locked: true } : object));
    store.getState().loadProject({ ...snapshot, objects: locked }, 'x');
    store.getState().selectMany(['obj-1', 'obj-2', 'obj-3']);
    const before = store.getState().objects;

    store.getState().lineUpSelection();
    // Nothing else was off the line, so with the only stray locked there is nothing at all to write.
    expect(store.getState().objects).toBe(before);
  });
});
