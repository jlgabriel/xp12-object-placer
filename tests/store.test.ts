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
    expect(store.getState().selection).toBe('obj-1');
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
    expect(store.getState().selection).toBe('obj-2');

    store.getState().deleteObject('obj-2');
    expect(store.getState().selection).toBeNull();
    expect(store.getState().objects).toHaveLength(0);
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

    store.getState().duplicateObject(original.id);

    const objects = store.getState().objects;
    expect(objects).toHaveLength(2);
    expect(objects[1]!.id).not.toBe(original.id);
    expect(store.getState().selection).toBe(objects[1]!.id);
  });

  it('keeps everything about the object except where it is', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    const original = store.getState().objects[0]!;
    store.getState().rotateObject(original.id, 137);

    store.getState().duplicateObject(original.id);
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
    store.getState().duplicateObject(store.getState().objects[0]!.id);

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
    store.getState().duplicateObject(store.getState().objects[0]!.id);

    const [first, copy] = store.getState().objects;
    expect(haversine(first!.position, copy!.position)).toBeGreaterThan(1);
  });

  it('counts as an edit', () => {
    const store = armed();
    store.getState().placeAt(SOMEWHERE);
    store.getState().markSaved('saved');
    store.getState().duplicateObject(store.getState().objects[0]!.id);
    expect(store.getState().dirty).toBe(true);
  });

  it('does nothing for an object that is not there', () => {
    const store = armed();
    store.getState().duplicateObject('obj-404');
    expect(store.getState().objects).toEqual([]);
  });
});
