import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePlane, quantize, writeDsfBinary } from '../src/core/dsf/writeDsfBinary.js';
import type { DsfTile } from '../src/core/dsf/tile.js';
import type { PlacedObject } from '../src/core/model.js';

const TILE: DsfTile = { lat: -34, lon: -71 };
const TRUCK = 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj';
const TOWER = 'lib/airport/control_towers/small/14m_Sweden.obj';

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

function object(
  id: string,
  libraryPath: string,
  lon: number,
  lat: number,
  rotation: number,
): PlacedObject {
  return { id, libraryPath, position: { lon, lat }, rotation };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

// ── a reader, so the tests assert on structure rather than on a hex blob ────────────────────────

interface Atom {
  id: string;
  body: Uint8Array;
  children: Atom[];
}

const CONTAINERS = new Set(['HEAD', 'DEFN', 'GEOD', 'DEMS']);

function parseAtoms(bytes: Uint8Array, start: number, end: number): Atom[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const atoms: Atom[] = [];
  let at = start;
  while (at + 8 <= end) {
    // Ids are stored with their four bytes reversed: HEAD sits on disk as DAEH.
    const id = [...bytes.subarray(at, at + 4)]
      .reverse()
      .map((b) => String.fromCharCode(b))
      .join('');
    const length = view.getUint32(at + 4, true);
    expect(length).toBeGreaterThanOrEqual(8);
    const body = bytes.subarray(at + 8, at + length);
    atoms.push({
      id,
      body,
      children: CONTAINERS.has(id) ? parseAtoms(bytes, at + 8, at + length) : [],
    });
    at += length;
  }
  return atoms;
}

/** Everything between the 12-byte header and the 16-byte MD5 footer. */
function parseDsf(bytes: Uint8Array): Atom[] {
  return parseAtoms(bytes, 12, bytes.length - 16);
}

function find(atoms: readonly Atom[], id: string): Atom | undefined {
  for (const atom of atoms) {
    if (atom.id === id) return atom;
    const inside = find(atom.children, id);
    if (inside) return inside;
  }
  return undefined;
}

function strings(atom: Atom | undefined): string[] {
  if (!atom) return [];
  const parts = Buffer.from(atom.body).toString('latin1').split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

const write = (objects: readonly PlacedObject[], tile: DsfTile = TILE): Uint8Array =>
  writeDsfBinary({ tile, objects, creationAgent: 'XOP-test', md5 });

// ── the plane encoder ───────────────────────────────────────────────────────────────────────────

describe('encodePlane', () => {
  it('reproduces the bytes DSFTool wrote into the file X-Plane flew', () => {
    // Golden, read straight out of probe H0b's compiled DSF. Four fuel trucks at one longitude:
    // an individual run of one, then a repeat run of three zero deltas.
    expect(hex(encodePlane([46954, 46954, 46954, 46954]))).toBe('016ab7830000');

    // And its latitude plane: one, then two, then one. Values descend, so the deltas wrap.
    expect(hex(encodePlane([65115, 64925, 64735, 64546]))).toBe('015bfe8242ff0143ff');
  });

  it('does not let an individual run swallow the first value of the next repeat run', () => {
    // Values 1, 3, 3, 3 are deltas 1, 2, 0, 0. The individual run must stop at the two zeroes and
    // hand both of them to a repeat run:
    //   02 0100 0200   two values on their own
    //   82 0000        two identical, once
    // Taking values until one *equals its predecessor* instead takes three, leaving a lone zero to
    // be encoded by itself — two bytes longer, and different from DSFTool's output for no reason,
    // which is the last thing worth diverging on when the reference file is the one the simulator
    // already accepted.
    expect(hex(encodePlane([1, 3, 3, 3]))).toBe('020100020082' + '0000');

    // And the simplest shape of all: one value, then a run. Deltas 5, 0, 0.
    expect(hex(encodePlane([5, 5, 5]))).toBe('010500' + '820000');
  });

  it('differences its values, wrapping at 65536', () => {
    // A descending run has to survive as an unsigned delta or the coordinate comes back absurd.
    expect(hex(encodePlane([10, 5]))).toBe('020a00fbff');
  });

  it('breaks a run longer than a count can hold', () => {
    // Seven bits of count. 200 identical values cannot be one run.
    const encoded = encodePlane(Array.from({ length: 200 }, () => 7));
    expect(encoded[0]).toBe(0x01); // the first value is a delta of 7, on its own
    expect(encoded.length).toBeGreaterThan(3);
    expect(encoded.length).toBeLessThan(200 * 3);
  });

  it('encodes nothing for no values', () => {
    expect(encodePlane([])).toHaveLength(0);
  });
});

describe('quantize', () => {
  it('spreads a range across the full uint16', () => {
    expect(quantize(-71, -71, 0.125)).toBe(0);
    expect(quantize(-70.875, -71, 0.125)).toBe(65535);
    expect(quantize(-70.9375, -71, 0.125)).toBe(32768); // half way, rounded
  });

  it('clamps rather than wrapping, so a rounding artefact cannot land somewhere absurd', () => {
    expect(quantize(-72, -71, 0.125)).toBe(0);
    expect(quantize(-70, -71, 0.125)).toBe(65535);
  });
});

// ── the file ────────────────────────────────────────────────────────────────────────────────────

describe('writeDsfBinary', () => {
  const objects = [
    object('a', TRUCK, -70.78544, -33.3758, 0),
    object('b', TRUCK, -70.78544, -33.376162, 90),
    object('c', TOWER, -70.78544, -33.376524, 180),
  ];

  it('opens with the cookie X-Plane looks for, and closes with a 16-byte digest', () => {
    const bytes = write(objects);
    expect(Buffer.from(bytes.subarray(0, 8)).toString('latin1')).toBe('XPLNEDSF');
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true)).toBe(1);

    const footer = bytes.subarray(bytes.length - 16);
    expect(footer).toHaveLength(16);
    expect(hex(footer)).toBe(hex(md5(bytes.subarray(0, bytes.length - 16))));
  });

  it('lays out the atoms the way the flown file does', () => {
    const atoms = parseDsf(write(objects));
    expect(atoms.map((a) => a.id)).toEqual(['HEAD', 'DEFN', 'GEOD', 'CMDS']);
    expect(find(atoms, 'HEAD')!.children.map((a) => a.id)).toEqual(['PROP']);
    // All five definition lists are present even though only one of them has anything in it.
    expect(find(atoms, 'DEFN')!.children.map((a) => a.id)).toEqual([
      'TERT',
      'OBJT',
      'POLY',
      'NETW',
      'DEMN',
    ]);
  });

  it('writes the properties that make the tile an overlay rather than a base mesh', () => {
    const properties = strings(find(parseDsf(write(objects)), 'PROP'));
    expect(properties).toEqual([
      'sim/west',
      '-71',
      'sim/east',
      '-70',
      'sim/north',
      '-33',
      'sim/south',
      '-34',
      'sim/planet',
      'earth',
      'sim/overlay',
      '1',
      'sim/creation_agent',
      'XOP-test',
    ]);
  });

  it('lists definitions once, in first-appearance order', () => {
    // The DSF names a definition by its index here, so the order is the identity. Two exports of
    // one project have to produce the same indices or a diff between them says nothing.
    const repeated = [...objects, object('d', TRUCK, -70.78544, -33.3765, 45)];
    expect(strings(find(parseDsf(write(repeated)), 'OBJT'))).toEqual([TRUCK, TOWER]);
  });

  it('gives each eighth-of-a-degree cell its own pool, which is where the precision comes from', () => {
    // One pool per cell, and a pool holds a uint16 range: over a whole tile that would be 1.7 m,
    // over an eighth of a degree it is 21 cm.
    const spread = [
      object('a', TRUCK, -70.9, -33.9, 0), // cell (0, 0)
      object('b', TRUCK, -70.9, -33.4, 0), // same longitude cell, different latitude cell
      object('c', TRUCK, -70.1, -33.4, 0),
    ];
    const geod = find(parseDsf(write(spread)), 'GEOD')!;
    const pools = geod.children.filter((a) => a.id === 'POOL');
    const scales = geod.children.filter((a) => a.id === 'SCAL');
    expect(pools).toHaveLength(3);
    expect(scales).toHaveLength(3);

    const together = [
      object('a', TRUCK, -70.9, -33.9, 0),
      object('b', TRUCK, -70.89, -33.89, 0), // same cell as a
    ];
    const shared = find(parseDsf(write(together)), 'GEOD')!;
    expect(shared.children.filter((a) => a.id === 'POOL')).toHaveLength(1);
  });

  it('refuses an object that belongs to another tile, before it can be quantised into this one', () => {
    expect(() => write([object('x', TRUCK, -70.5, -35.5, 0)])).toThrow(/belongs to tile -36,-71/);
  });

  it('refuses a non-finite coordinate, naming the coordinate and not the tile', () => {
    // Order matters: dsfTileOf(NaN) is NaN, so checking the tile first would report a grouping
    // problem for what is actually a bad number.
    expect(() => write([object('x', TRUCK, Number.NaN, -33.5, 0)])).toThrow(/non-finite position/);
  });

  it('insists on a real digest', () => {
    expect(() =>
      writeDsfBinary({
        tile: TILE,
        objects,
        creationAgent: 'XOP-test',
        md5: () => new Uint8Array(4),
      }),
    ).toThrow(/16 bytes/);
  });

  it('writes an empty tile without inventing anything to put in it', () => {
    const atoms = parseDsf(write([]));
    expect(strings(find(atoms, 'OBJT'))).toEqual([]);
    expect(find(atoms, 'GEOD')!.children.filter((a) => a.id === 'POOL')).toHaveLength(0);
  });
});

/**
 * Positive control: the file is only right if the tool that reads real DSFs can read ours.
 *
 * Skipped unless XOP_DSFTOOL points at DSFTool. This is the strongest check available without
 * starting the simulator — an independent implementation of the format, reading bytes we wrote
 * from scratch, and giving back the placement we meant.
 */
const dsfTool = process.env['XOP_DSFTOOL'];
const canDecompile = !!dsfTool && existsSync(dsfTool);

describe.skipIf(!canDecompile)('read back by DSFTool', () => {
  function roundTrip(objects: readonly PlacedObject[]): number[][] {
    const dir = mkdtempSync(join(tmpdir(), 'xop-'));
    const binary = join(dir, `${randomUUID()}.dsf`);
    const back = join(dir, 'back.txt');
    writeFileSync(binary, write(objects));
    execFileSync(dsfTool!, ['--dsf2text', binary, back], { stdio: 'ignore' });
    return readFileSync(back, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('OBJECT '))
      .map((line) => line.trim().split(/\s+/).slice(1).map(Number));
  }

  it('gives back every object, at the coordinate and rotation it was given', () => {
    const objects = [
      object('a', TRUCK, -70.78544, -33.3758, 0),
      object('b', TRUCK, -70.78544, -33.376162, 90),
      object('c', TOWER, -70.783308, -33.376524, 37.5),
      object('d', TOWER, -70.1, -33.9, 300),
    ];
    const returned = roundTrip(objects);
    expect(returned).toHaveLength(objects.length);
    returned.forEach((got, i) => {
      const want = objects[i]!;
      // A DSF stores coordinates in scaled integer pools, so this is a tolerance, not a rounding
      // error: ~21 cm of position and ~0.006° of rotation are the format's own resolution.
      expect(got[1]!).toBeCloseTo(want.position.lon, 5);
      expect(got[2]!).toBeCloseTo(want.position.lat, 5);
      expect(Math.abs(got[3]! - want.rotation)).toBeLessThan(0.01);
    });
    // Definition indices survive: two trucks then two towers.
    expect(returned.map((r) => r[0])).toEqual([0, 0, 1, 1]);
  });

  it('survives more than 255 definitions, where the 8-bit command cannot say which one', () => {
    // A real project can easily pass this: the catalog offers 3 837 distinct objects. Before the
    // 16-bit form was handled, definition 256 would have been written as definition 0.
    const many = Array.from({ length: 300 }, (_, i) =>
      object(`o${i}`, `lib/test/object_${i}.obj`, -70.5 + i * 1e-5, -33.5, i % 360),
    );
    const returned = roundTrip(many);
    expect(returned).toHaveLength(300);
    expect(returned.map((r) => r[0])).toEqual(many.map((_, i) => i));
  });

  it('keeps objects apart when they sit in different pools', () => {
    const corners = [
      object('sw', TRUCK, -70.95, -33.95, 0),
      object('ne', TRUCK, -70.05, -33.05, 180),
    ];
    const returned = roundTrip(corners);
    expect(returned[0]![1]).toBeCloseTo(-70.95, 5);
    expect(returned[1]![1]).toBeCloseTo(-70.05, 5);
    expect(returned[0]![2]).toBeCloseTo(-33.95, 5);
    expect(returned[1]![2]).toBeCloseTo(-33.05, 5);
  });
});
