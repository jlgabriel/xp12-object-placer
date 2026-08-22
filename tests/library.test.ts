import { describe, expect, it } from 'vitest';
import { parseLibraryTxt } from '../src/core/catalog/library.js';

const T = '\t';

function lib(body: string[]): string {
  return ['A', '1200', 'LIBRARY', '', ...body].join('\n');
}

describe('parseLibraryTxt header', () => {
  it('reads the version', () => {
    expect(parseLibraryTxt(lib([])).version).toBe(1200);
  });

  it('finds the header even when comments push it down the file', () => {
    const text = ['A', '', '# a library', '# by somebody', '1200', '', 'LIBRARY', ''].join('\n');
    expect(parseLibraryTxt(text).version).toBe(1200);
    // The header must not come back out as garbage. Assuming it sits on line 3 is what made the
    // first version report five perfectly good files as unreadable.
    expect(parseLibraryTxt(text).unrecognized).toEqual([]);
  });

  it('refuses a file that is not a library', () => {
    expect(() => parseLibraryTxt('I\n800\nOBJ')).toThrow(/no LIBRARY line/);
  });
});

describe('parseLibraryTxt exports', () => {
  it('splits an EXPORT on tabs', () => {
    const { exports } = parseLibraryTxt(
      lib([`EXPORT lib/airport/hangars/arched/16x16/rusted_1.obj${T}${T}Hangars/hangar_A16x16_02.obj`]),
    );
    expect(exports).toEqual([
      {
        directive: 'EXPORT',
        virtualPath: 'lib/airport/hangars/arched/16x16/rusted_1.obj',
        relativePath: 'Hangars/hangar_A16x16_02.obj',
        visibility: 'public',
      },
    ]);
  });

  it('keeps a physical path that contains spaces', () => {
    // Real: EXPORT_BACKUP lib/atc/voices/default.voc voices/default controller/default_Aditi.voc
    const { exports } = parseLibraryTxt(
      lib(['EXPORT_BACKUP lib/atc/voices/default.voc voices/default controller/default_Aditi.voc']),
    );
    expect(exports[0]!.relativePath).toBe('voices/default controller/default_Aditi.voc');
  });

  it('never normalizes case — two paths differing only in case stay distinct', () => {
    const { exports } = parseLibraryTxt(
      lib([
        `EXPORT lib/airport/Common_Elements/vehicles/Truck.obj${T}Vehicles/fuel_truck_small.obj`,
        `EXPORT lib/airport/Common_Elements/Vehicles/Truck.obj${T}Vehicles/fuel_truck_small.obj`,
      ]),
    );
    expect(exports.map((e) => e.virtualPath)).toEqual([
      'lib/airport/Common_Elements/vehicles/Truck.obj',
      'lib/airport/Common_Elements/Vehicles/Truck.obj',
    ]);
  });

  it('reads the ratio and the seasons off the directives that carry them', () => {
    const { exports } = parseLibraryTxt(
      lib([
        `EXPORT_RATIO 0.25 lib/g10/x.fac${T}US/x.fac`,
        `EXPORT_SEASON spr,sum${T}lib/g10/natural.ags${T}${T}EU/sub_Resid01.ags`,
      ]),
    );
    expect(exports[0]!.ratio).toBe(0.25);
    expect(exports[0]!.virtualPath).toBe('lib/g10/x.fac');
    expect(exports[1]!.seasons).toEqual(['spr', 'sum']);
    expect(exports[1]!.relativePath).toBe('EU/sub_Resid01.ags');
  });
});

describe('parseLibraryTxt visibility', () => {
  it('applies a marker to everything that follows it', () => {
    // Real shape: `900 us objects` puts a bare DEPRECATED on line 5 and never returns to PUBLIC,
    // so the whole X-Plane 9 era library is deprecated by its own authors.
    const { exports } = parseLibraryTxt(
      lib([
        `EXPORT lib/a.obj${T}a.obj`,
        'DEPRECATED',
        `EXPORT lib/b.obj${T}b.obj`,
        'PUBLIC 20190831',
        `EXPORT lib/c.obj${T}c.obj`,
        'PRIVATE',
        `EXPORT lib/d.obj${T}d.obj`,
      ]),
    );
    expect(exports.map((e) => e.visibility)).toEqual([
      'public',
      'deprecated',
      'public',
      'private',
    ]);
  });
});

describe('parseLibraryTxt regions', () => {
  it('tags exports with the region in force and clears it on REGION_ALL', () => {
    const { exports, regionsDefined } = parseLibraryTxt(
      lib([
        'REGION_DEFINE global_dry',
        'REGION_RECT -180 -90 180 90',
        `EXPORT lib/dry.obj${T}dry.obj`,
        'REGION_ALL',
        `EXPORT lib/any.obj${T}any.obj`,
      ]),
    );
    expect(regionsDefined).toEqual(['global_dry']);
    expect(exports[0]!.region).toBe('global_dry');
    expect(exports[1]!.region).toBeUndefined();
  });
});

describe('parseLibraryTxt unrecognized lines', () => {
  it('reports a malformed export instead of guessing at it', () => {
    // Real, and there are five of them in stock X-Plane 12.4.3: the tab between the virtual and
    // physical paths is simply missing, so the two run together.
    const { exports, unrecognized } = parseLibraryTxt(
      lib(['EXPORT /lib/global8/us/feat_Building.objbuildings/B2_e2_52x25.obj']),
    );
    expect(exports).toEqual([]);
    expect(unrecognized).toHaveLength(1);
    expect(unrecognized[0]!.line).toBe(5);
  });

  it('reports an unknown directive rather than dropping it silently', () => {
    const { unrecognized } = parseLibraryTxt(lib([`EXPORT_SOMETHING_NEW lib/x.obj${T}x.obj`]));
    expect(unrecognized).toHaveLength(1);
  });
});
