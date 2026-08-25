/**
 * Build probe H9: a library outside the installation, a library inside it, and one overlay that
 * places an object from each.
 *
 *   npx tsx probes/H9/make.ts
 *
 * No DSFTool anywhere: H8 settled that X-Plane loads the binary XOP writes, so the overlay here is
 * ours and the probe spends its one flight on a different question.
 *
 * The two library objects are **generated, not copied**. XOP redistributes no Laminar content, and
 * a probe that shipped a stock .obj inside a pack would be doing exactly that. A box is also a
 * better signal than a hangar: nothing at SCEL looks like it.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeDsfBinary } from '../../src/core/dsf/writeDsfBinary.js';
import { tilePath, type DsfTile } from '../../src/core/dsf/tile.js';
import { parseObj8, sizeOf } from '../../src/core/obj8/parse.js';
import type { PlacedObject } from '../../src/core/model.js';

const TILE: DsfTile = { lat: -34, lon: -71 };
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/** The one virtual path under test: exported only by the pack that lives outside X-Plane. */
const OUTSIDE = 'lib/xop/h9/outside_pillar.obj';
/** The same thing from a pack in the ordinary place, which isolates a broken .obj from a lost pack. */
const INSIDE = 'lib/xop/h9/inside_slab.obj';
/** Stock. Proves the overlay itself loaded, whatever happens to the other two. */
const TOWER = 'lib/airport/control_towers/small/14m_Sweden.obj';

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

// ── a box, written out as OBJ8 ─────────────────────────────────────────────────────────────────

type Vec = readonly [number, number, number];

const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * A rectangular box sitting on the ground, centred on its own origin in plan.
 *
 * Untextured on purpose — an OBJ8 with no `TEXTURE` draws plain, which is all a probe signal needs
 * and one fewer file to get wrong. `ATTR_no_cull` is there so that a winding order I got backwards
 * would still show a solid box rather than an invisible one: the question this probe asks is about
 * a path in an ini file, and it must not be answerable by my own face winding.
 *
 * X-Plane axes: +X east, +Y up, +Z south, metres, origin on the ground.
 */
function boxObj(width: number, height: number, depth: number): string {
  const half: Vec = [width / 2, height / 2, depth / 2];
  const normals: Vec[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  const vertices: string[] = [];
  const indices: number[] = [];

  for (const n of normals) {
    // (u, v, n) right-handed, so the corners below come out counter-clockwise seen from outside.
    const helper: Vec = n[1] === 0 ? [0, 1, 0] : [0, 0, 1];
    const u = cross(helper, n);
    const v = cross(n, u);

    const extent = (axis: Vec): number =>
      Math.abs(axis[0]) * half[0] + Math.abs(axis[1]) * half[1] + Math.abs(axis[2]) * half[2];
    const hu = extent(u);
    const hv = extent(v);
    const centre: Vec = [n[0] * half[0], n[1] * half[1], n[2] * half[2]];

    const base = vertices.length;
    const corners: readonly (readonly [number, number, number, number])[] = [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ];
    for (const [su, sv, s, t] of corners) {
      const x = centre[0] + u[0] * hu * su + v[0] * hv * sv;
      // + height / 2 lifts the whole box out of the ground: the origin is at its foot, not its middle.
      const y = centre[1] + u[1] * hu * su + v[1] * hv * sv + height / 2;
      const z = centre[2] + u[2] * hu * su + v[2] * hv * sv;
      vertices.push(`VT\t${x}\t${y}\t${z}\t${n[0]}\t${n[1]}\t${n[2]}\t${s}\t${t}`);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return [
    'A',
    '800',
    'OBJ',
    '',
    `POINT_COUNTS\t${vertices.length}\t0\t0\t${indices.length}`,
    '',
    ...vertices,
    ...indices.map((i) => `IDX\t${i}`),
    '',
    'ATTR_no_cull',
    `TRIS\t0\t${indices.length}`,
    '',
  ].join('\n');
}

/** Read our own box back with our own parser, and refuse to ship one that does not measure right. */
function selfCheck(name: string, text: string, want: { w: number; h: number; d: number }): void {
  const bounds = parseObj8(text).bounds;
  if (!bounds) throw new Error(`${name}: parsed to no geometry at all`);
  const size = sizeOf(bounds);
  const off =
    Math.abs(size.width - want.w) + Math.abs(size.height - want.h) + Math.abs(size.depth - want.d);
  if (off > 0.001) {
    throw new Error(
      `${name}: measured ${size.width}×${size.height}×${size.depth}, meant to be ` +
        `${want.w}×${want.h}×${want.d}`,
    );
  }
  console.log(`  ${name.padEnd(14)} ${size.width} × ${size.height} × ${size.depth} m, verified`);
}

// ── the packs ──────────────────────────────────────────────────────────────────────────────────

function writeLibraryPack(packName: string, virtualPath: string, obj: string): string {
  const root = join(HERE, packName);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'objects'), { recursive: true });
  writeFileSync(join(root, 'objects', 'box.obj'), obj, 'latin1');
  writeFileSync(
    join(root, 'library.txt'),
    ['A', '1200', 'LIBRARY', '', `EXPORT ${virtualPath}\tobjects/box.obj`, ''].join('\n'),
    'latin1',
  );
  return root;
}

console.log('Objects:');
const pillar = boxObj(4, 30, 4);
selfCheck('outside', pillar, { w: 4, h: 30, d: 4 });
const slab = boxObj(20, 8, 20);
selfCheck('inside', slab, { w: 20, h: 8, d: 20 });

const outsideRoot = writeLibraryPack('XOP_H9_Outside', OUTSIDE, pillar);
const insideRoot = writeLibraryPack('XOP_H9_Inside', INSIDE, slab);

/**
 * The row, at the spot H0 and H8 used: about 200 m east of the 17L threshold at SCEL.
 *
 * The stock tower is in the **middle** on purpose. It is the pack's own heartbeat — if it is not
 * there, nothing about the other two positions means anything, and the flier sees that first.
 */
const OBJECTS: PlacedObject[] = [
  { id: 'outside', libraryPath: OUTSIDE, position: { lon: -70.786, lat: -33.3758 }, rotation: 0 },
  { id: 'tower', libraryPath: TOWER, position: { lon: -70.7855, lat: -33.3758 }, rotation: 0 },
  { id: 'inside', libraryPath: INSIDE, position: { lon: -70.785, lat: -33.3758 }, rotation: 0 },
];

const overlayRoot = join(HERE, 'XOP_H9_Overlay');
rmSync(overlayRoot, { recursive: true, force: true });
const dsf = join(overlayRoot, tilePath(TILE));
mkdirSync(dirname(dsf), { recursive: true });
const bytes = writeDsfBinary({ tile: TILE, objects: OBJECTS, creationAgent: 'XOP-H9', md5 });
writeFileSync(dsf, bytes);

console.log(`\nPacks:`);
console.log(`  XOP_H9_Outside   ${outsideRoot}   → goes OUTSIDE the installation`);
console.log(`  XOP_H9_Inside    ${insideRoot}   → goes in Custom Scenery`);
console.log(`  XOP_H9_Overlay   ${overlayRoot}   → goes in Custom Scenery, ${bytes.length} bytes`);
console.log(`\nRead ${join(HERE, 'FLIGHT.md')} before installing them.`);
