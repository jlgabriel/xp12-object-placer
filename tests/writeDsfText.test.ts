import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeDsfText } from '../src/core/dsf/writeDsfText.js';
import type { PlacedObject } from '../src/core/model.js';

const TILE = { lat: -34, lon: -71 } as const;

function object(id: string, libraryPath: string, lon: number, lat: number, rotation: number): PlacedObject {
  return { id, libraryPath, position: { lon, lat }, rotation };
}

const TRUCK = 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj';
const TOWER = 'lib/airport/control_towers/small/14m_Sweden.obj';

describe('writeDsfText', () => {
  it('emits the header and properties DSFTool round-trips', () => {
    const text = writeDsfText({ tile: TILE, objects: [], creationAgent: 'XOP' });
    expect(text.split('\n').slice(0, 3)).toEqual(['I', '800', 'DSF2TEXT']);
    expect(text).toContain('PROPERTY sim/west -71');
    expect(text).toContain('PROPERTY sim/east -70');
    expect(text).toContain('PROPERTY sim/south -34');
    expect(text).toContain('PROPERTY sim/north -33');
    expect(text).toContain('PROPERTY sim/overlay 1');
    expect(text).toContain('PROPERTY sim/creation_agent XOP');
  });

  it('numbers definitions by first appearance and reuses them', () => {
    const text = writeDsfText({
      tile: TILE,
      objects: [
        object('a', TRUCK, -70.78, -33.37, 0),
        object('b', TOWER, -70.79, -33.37, 0),
        object('c', TRUCK, -70.8, -33.37, 0),
      ],
      creationAgent: 'XOP',
    });
    const defs = text.split('\n').filter((l) => l.startsWith('OBJECT_DEF '));
    expect(defs).toEqual([`OBJECT_DEF ${TRUCK}`, `OBJECT_DEF ${TOWER}`]);

    const placements = text.split('\n').filter((l) => l.startsWith('OBJECT '));
    expect(placements.map((l) => l.split(' ')[1])).toEqual(['0', '1', '0']);
  });

  it('writes lon before lat, with rotation last', () => {
    const text = writeDsfText({
      tile: TILE,
      objects: [object('a', TRUCK, -70.784600123, -33.376000456, 45)],
      creationAgent: 'XOP',
    });
    expect(text).toContain('OBJECT 0 -70.784600123 -33.376000456 45.000000');
  });

  it('normalizes rotation into [0, 360)', () => {
    const text = writeDsfText({
      tile: TILE,
      objects: [
        object('a', TRUCK, -70.78, -33.37, -90),
        object('b', TRUCK, -70.79, -33.37, 360),
        object('c', TRUCK, -70.8, -33.37, 405),
      ],
      creationAgent: 'XOP',
    });
    const rotations = text
      .split('\n')
      .filter((l) => l.startsWith('OBJECT '))
      .map((l) => l.split(' ')[4]);
    expect(rotations).toEqual(['270.000000', '0.000000', '45.000000']);
  });

  it('refuses a position that is not a real coordinate', () => {
    // toFixed does not save you: (NaN).toFixed(9) is "NaN", Infinity gives "Infinity", 1e21 gives
    // "1e+21". Any of those in an OBJECT line makes a DSF that DSFTool rejects or that loads
    // somewhere absurd, and the failure surfaces a long way from its cause.
    const bad = (lon: number, lat: number): (() => string) =>
      () =>
        writeDsfText({
          tile: TILE,
          objects: [object('a', TRUCK, lon, lat, 0)],
          creationAgent: 'XOP',
        });

    expect(bad(NaN, -33.37)).toThrow(/non-finite position/);
    expect(bad(-70.78, Infinity)).toThrow(/non-finite position/);
    expect(bad(-70.78, -95)).toThrow(/not on Earth/);
    expect(bad(200, -33.37)).toThrow(/not on Earth/);
  });

  it('refuses an object that belongs in another tile', () => {
    // groupByTile exists precisely so this never happens. If it does, it is a bug upstream, and a
    // silent write would produce a pack X-Plane quietly ignores.
    expect(() =>
      writeDsfText({
        tile: TILE,
        objects: [object('stray', TRUCK, -70.78, -34.5, 0)],
        creationAgent: 'XOP',
      }),
    ).toThrow(/belongs to tile -35,-71/);
  });
});

/**
 * Positive control: our text is only correct if the real tool accepts it and gives it back.
 *
 * Skipped unless XOP_DSFTOOL points at DSFTool. On a machine with Ortho4XP installed it is at
 * <Ortho4XP>/Utils/DSFTool.exe.
 */
const dsfTool = process.env['XOP_DSFTOOL'];
const canCompile = !!dsfTool && existsSync(dsfTool);

describe.skipIf(!canCompile)('round-trip through DSFTool', () => {
  it('survives compile and decompile within the format tolerance', () => {
    const objects = [
      object('truck-0', TRUCK, -70.7846, -33.376, 0),
      object('truck-45', TRUCK, -70.783954, -33.376, 45),
      object('tower', TOWER, -70.783308, -33.376, 0),
    ];
    const text = writeDsfText({ tile: TILE, objects, creationAgent: 'XOP-test' });

    const dir = mkdtempSync(join(tmpdir(), 'xop-'));
    const source = join(dir, 'in.txt');
    const compiled = join(dir, 'out.dsf');
    const back = join(dir, 'back.txt');

    writeFileSync(source, text, 'utf8');
    execFileSync(dsfTool!, ['--text2dsf', source, compiled], { stdio: 'ignore' });
    execFileSync(dsfTool!, ['--dsf2text', compiled, back], { stdio: 'ignore' });

    const returned = readFileSync(back, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.startsWith('OBJECT '))
      .map((l) => l.trim().split(/\s+/).slice(1).map(Number));

    expect(returned).toHaveLength(objects.length);

    returned.forEach((got, i) => {
      const want = objects[i]!;
      expect(got[0]).toBe(i === 2 ? 1 : 0); // definition index survives
      // DSF stores coordinates in scaled integer pools: ~±17 cm, ~±0.005°.
      // See reference/dsf-overlay.md. Byte-exact comparison would be a false assertion.
      expect(got[1]!).toBeCloseTo(want.position.lon, 5);
      expect(got[2]!).toBeCloseTo(want.position.lat, 5);
      expect(Math.abs(got[3]! - want.rotation)).toBeLessThan(0.01);
    });
  });
});
