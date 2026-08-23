import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../src/renderer/state/store.js';
import { DEFAULT_CAMERA } from '../src/core/project/project.js';
import type { CatalogEntry } from '../src/shared/api.js';

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
