import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA,
  InvalidProjectError,
  newProject,
  nextIdSeed,
  parseProject,
  PROJECT_SCHEMA_VERSION,
  touchProject,
  UNTITLED,
  UnsupportedSchemaVersionError,
  type Project,
} from '../src/core/project/project.js';
import type { PlacedObject } from '../src/core/model.js';

const NOW = '2026-08-22T12:00:00.000Z';

const TRUCK: PlacedObject = {
  id: 'obj-1',
  libraryPath: 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj',
  position: { lon: -70.78462, lat: -33.3762 },
  rotation: 30,
  label: 'Large_Fuel_Truck',
};

const filled = (): Project => ({
  ...newProject(NOW),
  name: 'SCEL apron',
  camera: { lon: -70.78, lat: -33.37, zoom: 17 },
  objects: [TRUCK],
});

/** What actually goes to disk and comes back: JSON, not an object handed over in memory. */
const roundTrip = (project: Project): Project =>
  parseProject(JSON.parse(JSON.stringify(project)));

describe('a new project', () => {
  it('is empty, untitled, and looking where the map opens', () => {
    const project = newProject(NOW);
    expect(project.name).toBe(UNTITLED);
    expect(project.objects).toEqual([]);
    expect(project.camera).toEqual(DEFAULT_CAMERA);
    expect(project.createdAt).toBe(NOW);
    expect(project.modifiedAt).toBe(NOW);
  });

  it('can be saved: an empty project is not an error', () => {
    expect(() => roundTrip(newProject(NOW))).not.toThrow();
  });
});

describe('round trip', () => {
  it('survives the disk unchanged', () => {
    expect(roundTrip(filled())).toEqual(filled());
  });

  it('keeps the camera, so reopening puts you back over your own work', () => {
    expect(roundTrip(filled()).camera).toEqual({ lon: -70.78, lat: -33.37, zoom: 17 });
  });

  it('keeps an absent optional absent rather than turning it into undefined', () => {
    const bare: PlacedObject = {
      id: 'obj-1',
      libraryPath: 'lib/x.obj',
      position: { lon: 0, lat: 0 },
      rotation: 0,
    };
    const back = roundTrip({ ...newProject(NOW), objects: [bare] });
    expect('label' in back.objects[0]!).toBe(false);
    expect('locked' in back.objects[0]!).toBe(false);
  });

  it('drops anything that was not asked for', () => {
    const smuggled = {
      ...filled(),
      somethingElse: 'ignore me',
      objects: [{ ...TRUCK, scale: 4, height: 100 }],
    };
    const back = parseProject(JSON.parse(JSON.stringify(smuggled)));
    expect(back).not.toHaveProperty('somethingElse');
    expect(back.objects[0]).not.toHaveProperty('scale');
    expect(back.objects[0]).not.toHaveProperty('height');
  });

  it('stamps a fresh modification time without touching creation', () => {
    const later = touchProject(filled(), '2026-09-01T00:00:00.000Z');
    expect(later.createdAt).toBe(NOW);
    expect(later.modifiedAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('refusing what it should refuse', () => {
  it('refuses somebody else’s JSON', () => {
    expect(() => parseProject({ hello: 'world' })).toThrow();
    expect(() => parseProject({ ...filled(), app: 'pct' })).toThrow();
  });

  it('refuses a file that is not an object at all', () => {
    expect(() => parseProject('a string')).toThrow(InvalidProjectError);
    expect(() => parseProject(null)).toThrow(InvalidProjectError);
    expect(() => parseProject([filled()])).toThrow(InvalidProjectError);
  });

  it('refuses two objects sharing an id, which no editor could make sense of', () => {
    const clashing = { ...filled(), objects: [TRUCK, { ...TRUCK, rotation: 90 }] };
    expect(() => roundTrip(clashing as Project)).toThrow(/share the id "obj-1"/);
  });

  it('refuses coordinates that are not real numbers', () => {
    const broken = {
      ...filled(),
      objects: [{ ...TRUCK, position: { lon: 'west', lat: -33 } }],
    };
    expect(() => parseProject(broken)).toThrow();
  });
});

describe('a version this build cannot read', () => {
  it('says the app is old, not that the file is broken', () => {
    const future = { ...filled(), schemaVersion: PROJECT_SCHEMA_VERSION + 1 };
    expect(() => parseProject(future)).toThrow(UnsupportedSchemaVersionError);
    expect(() => parseProject(future)).toThrow(/newer version/);
  });

  it('tells an old format apart from a future one', () => {
    expect(() => parseProject({ ...filled(), schemaVersion: 0 })).toThrow(/old format/);
  });

  // The order of the two checks is the whole point. A file from a future version will usually fail
  // shape validation as well, and if that message wins, somebody goes hunting for corruption in a
  // file that is perfectly fine — they just need a newer build. Version first.
  it('reports the version, not the shape, when both are wrong', () => {
    const future = { schemaVersion: 99, app: 'xop', objects: 'not even an array' };
    expect(() => parseProject(future)).toThrow(UnsupportedSchemaVersionError);
  });
});

describe('seeding the id counter', () => {
  it('starts at one for an empty project', () => {
    expect(nextIdSeed([])).toBe(1);
  });

  // Without this, loading a project of obj-1..obj-40 into a fresh store makes the next placed
  // object obj-1 again: two objects, one id, an ambiguous selection and a map diff that is wrong.
  it('resumes past the highest id in the file', () => {
    const objects = [1, 7, 40].map((n) => ({ ...TRUCK, id: `obj-${n}` }));
    expect(nextIdSeed(objects)).toBe(41);
  });

  it('ignores ids that were not made by the counter', () => {
    expect(nextIdSeed([{ ...TRUCK, id: 'hand-written' }])).toBe(1);
    expect(
      nextIdSeed([
        { ...TRUCK, id: 'hand-written' },
        { ...TRUCK, id: 'obj-5' },
      ]),
    ).toBe(6);
  });
});
