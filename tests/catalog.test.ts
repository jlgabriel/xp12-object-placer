import { describe, expect, it } from 'vitest';
import { buildCatalog, placeableObjects, type LibrarySource } from '../src/core/catalog/catalog.js';
import { parseLibraryTxt } from '../src/core/catalog/library.js';

const T = '\t';

function source(packageName: string, body: string[]): LibrarySource {
  return {
    packageName,
    packagePath: `/x-plane/Custom Scenery/${packageName}`,
    parsed: parseLibraryTxt(['A', '1200', 'LIBRARY', '', ...body].join('\n')),
  };
}

describe('buildCatalog', () => {
  it('keeps objects and counts what it left behind', () => {
    const catalog = buildCatalog([
      source('pack', [
        `EXPORT lib/airport/hangars/arched/16x16/rusted_1.obj${T}h.obj`,
        `EXPORT lib/g10/autogen/urban.fac${T}u.fac`,
        `EXPORT lib/g10/forests/pine.for${T}p.for`,
      ]),
    ]);
    expect(catalog.objects.map((o) => o.virtualPath)).toEqual([
      'lib/airport/hangars/arched/16x16/rusted_1.obj',
    ]);
    // What a .obj-only catalog skips has to be visible, not implied. Silent truncation reads as
    // completeness.
    expect(catalog.stats.byExtension).toEqual({ '.obj': 1, '.fac': 1, '.for': 1 });
    expect(catalog.stats.totalExports).toBe(3);
    expect(catalog.stats.objectExports).toBe(1);
  });

  it('takes the category tree straight from the virtual path', () => {
    const catalog = buildCatalog([
      source('pack', [`EXPORT lib/airport/hangars/arched/16x16/rusted_1.obj${T}h.obj`]),
    ]);
    expect(catalog.objects[0]!.name).toBe('rusted_1');
    expect(catalog.objects[0]!.category).toEqual(['airport', 'hangars', 'arched', '16x16']);
  });

  it('keeps a non-lib prefix rather than assuming every library uses lib/', () => {
    const catalog = buildCatalog([source('XCDL', [`EXPORT XCDL/Objects/Cone.obj${T}c.obj`])]);
    expect(catalog.objects[0]!.category).toEqual(['XCDL', 'Objects']);
  });

  it('gathers repeated exports of one path into variants', () => {
    const catalog = buildCatalog([
      source('pack', [
        `EXPORT lib/airport/hangar.obj${T}a.obj`,
        `EXPORT lib/airport/hangar.obj${T}b.obj`,
        `EXPORT lib/airport/hangar.obj${T}c.obj`,
      ]),
    ]);
    expect(catalog.objects).toHaveLength(1);
    expect(catalog.objects[0]!.variants.map((v) => v.relativePath)).toEqual([
      'a.obj',
      'b.obj',
      'c.obj',
    ]);
    expect(catalog.stats.withVariants).toBe(1);
  });

  it('treats paths differing only in case as different objects', () => {
    // Both spellings exist in the stock airport library and resolve to the same file. The catalog
    // is keyed on the virtual path verbatim, because that is what a DSF has to contain.
    const catalog = buildCatalog([
      source('pack', [
        `EXPORT lib/airport/Common_Elements/vehicles/Truck.obj${T}t.obj`,
        `EXPORT lib/airport/Common_Elements/Vehicles/Truck.obj${T}t.obj`,
      ]),
    ]);
    expect(catalog.objects).toHaveLength(2);
  });

  it('merges variants declared by different packages', () => {
    const catalog = buildCatalog([
      source('stock', [`EXPORT lib/airport/hangar.obj${T}a.obj`]),
      source('third-party', [`EXPORT lib/airport/hangar.obj${T}b.obj`]),
    ]);
    expect(catalog.objects[0]!.variants.map((v) => v.packageName)).toEqual([
      'stock',
      'third-party',
    ]);
  });
});

describe('visibility', () => {
  it('lets the most restrictive declaration win', () => {
    const catalog = buildCatalog([
      source('a', [`EXPORT lib/x.obj${T}a.obj`]),
      source('b', ['PRIVATE', `EXPORT lib/x.obj${T}b.obj`]),
    ]);
    expect(catalog.objects[0]!.visibility).toBe('private');
  });

  it('offers the user only what the libraries meant to be placed', () => {
    const catalog = buildCatalog([
      source('pack', [
        `EXPORT lib/public.obj${T}a.obj`,
        'SEMI_DEPRECATED',
        `EXPORT lib/old.obj${T}b.obj`,
        'DEPRECATED',
        `EXPORT lib/older.obj${T}c.obj`,
        'PRIVATE',
        `EXPORT lib/plumbing.obj${T}d.obj`,
      ]),
    ]);
    expect(placeableObjects(catalog).map((o) => o.virtualPath)).toEqual([
      'lib/old.obj',
      'lib/public.obj',
    ]);
  });
});

describe('determinism', () => {
  it('sorts objects by virtual path so two scans of one installation are comparable', () => {
    const forward = buildCatalog([
      source('p', [`EXPORT lib/c.obj${T}c.obj`, `EXPORT lib/a.obj${T}a.obj`, `EXPORT lib/b.obj${T}b.obj`]),
    ]);
    expect(forward.objects.map((o) => o.virtualPath)).toEqual([
      'lib/a.obj',
      'lib/b.obj',
      'lib/c.obj',
    ]);
  });
});
