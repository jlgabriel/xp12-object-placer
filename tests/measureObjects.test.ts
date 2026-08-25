import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureObjects } from '../src/node/measureObjects.js';
import type { CatalogObject } from '../src/core/catalog/catalog.js';

const T = '\t';

/** A 4 m × 6 m box, 3 m tall. */
const BOX = [
  'I',
  '800',
  'OBJ',
  '',
  `VT${T}-2${T}0${T}-3${T}0${T}1${T}0${T}0${T}0`,
  `VT${T}2${T}0${T}3${T}0${T}1${T}0${T}0${T}0`,
  `VT${T}2${T}3${T}3${T}0${T}1${T}0${T}0${T}0`,
  `IDX${T}0`,
  `IDX${T}1`,
  `IDX${T}2`,
  `TRIS${T}0${T}3`,
].join('\n');

/** A valid OBJ8 header and nothing else — the shape of lib/legacy placeholders. */
const EMPTY = ['I', '800', 'OBJ', ''].join('\n');

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'xop-measure-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'latin1');
  }
  return root;
}

function object(
  virtualPath: string,
  variants: { pkg: string; path: string; file: string }[],
): CatalogObject {
  return {
    virtualPath,
    name: 'thing',
    category: ['test'],
    visibility: 'public',
    variants: variants.map((v) => ({
      packageName: v.pkg,
      packagePath: v.path,
      relativePath: v.file,
      directive: 'EXPORT',
    })),
    regions: [],
  };
}

describe('measureObjects', () => {
  it('measures the object', () => {
    const root = workspace({ 'objects/box.obj': BOX });
    const { measurements } = measureObjects([
      object('lib/box.obj', [{ pkg: 'p', path: root, file: 'objects/box.obj' }]),
    ]);
    expect(measurements[0]!.size).toEqual({ width: 4, height: 3, depth: 6 });
  });

  it('falls through to a variant that exists when the first one does not', () => {
    // A library can export a file its package never shipped. Stopping at the first variant would
    // report the object as unmeasurable while a perfectly good copy sits in the next one.
    const root = workspace({ 'objects/b.obj': BOX });
    const { measurements, failures } = measureObjects([
      object('lib/thing.obj', [
        { pkg: 'p', path: root, file: 'objects/missing.obj' },
        { pkg: 'p', path: root, file: 'objects/b.obj' },
      ]),
    ]);
    expect(failures).toEqual([]);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]!.measuredFile).toContain('b.obj');
  });

  it('reports the object as missing only when every variant fails', () => {
    const root = workspace({});
    const { measurements, failures } = measureObjects([
      object('lib/thing.obj', [
        { pkg: 'p', path: root, file: 'objects/gone.obj' },
        { pkg: 'p', path: root, file: 'objects/also-gone.obj' },
      ]),
    ]);
    expect(measurements).toEqual([]);
    // One line, not one per variant: five identical "file not found" entries help nobody.
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toBe('missing-file');
  });

  it('skips past an empty placeholder to a variant with real geometry', () => {
    const root = workspace({ 'objects/stub.obj': EMPTY, 'objects/real.obj': BOX });
    const { measurements } = measureObjects([
      object('lib/thing.obj', [
        { pkg: 'p', path: root, file: 'objects/stub.obj' },
        { pkg: 'p', path: root, file: 'objects/real.obj' },
      ]),
    ]);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]!.size.height).toBe(3);
  });

  it('calls an object with nothing but a header what it is', () => {
    const root = workspace({ 'objects/stub.obj': EMPTY });
    const { failures } = measureObjects([
      object('lib/legacy/radio_tower.obj', [{ pkg: 'p', path: root, file: 'objects/stub.obj' }]),
    ]);
    expect(failures[0]!.reason).toBe('no-geometry');
  });

  it('takes each variant to its own package, not to a package of the same name', () => {
    // Two roots, two folders both called `Object Library`, one virtual path exported by both. The
    // first variant is a stub; the real object is in the second package. Resolving by name would
    // find one of the two — and a 50% chance of reading the wrong package's file is the whole
    // reason a variant carries its path.
    const one = workspace({ 'objects/thing.obj': EMPTY });
    const two = workspace({ 'objects/thing.obj': BOX });
    const { measurements } = measureObjects([
      object('lib/thing.obj', [
        { pkg: 'Object Library', path: one, file: 'objects/thing.obj' },
        { pkg: 'Object Library', path: two, file: 'objects/thing.obj' },
      ]),
    ]);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]!.measuredFile).toContain(two);
    expect(measurements[0]!.size.height).toBe(3);
  });
});
