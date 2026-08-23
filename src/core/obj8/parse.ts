/**
 * OBJ8 parser — enough of the format to describe an object in a catalog.
 *
 * What this needs to produce, and nothing more: how big the thing is, what its footprint on the
 * ground is, which textures it wants, and whether it is animated. Rendering is somebody else's
 * problem.
 *
 * Pure: takes text, returns a description. See reference/obj8.md for what was verified on disk,
 * including the two traps this parser exists to get right — TAB delimiters and draped geometry.
 */

import type { GroundBox } from '../model.js';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Obj8Textures {
  readonly albedo?: string;
  readonly lit?: string;
  readonly normal?: string;
  readonly draped?: string;
}

export interface Obj8LodRange {
  readonly near: number;
  readonly far: number;
}

/**
 * The triangles themselves, for drawing.
 *
 * Opt-in, because the catalog scanner parses 3 706 objects to measure them and has no use for a
 * single vertex normal. Asking for this is what a thumbnail does, one object at a time.
 *
 * Indices cover the **nearest LOD only**, the same set the bounds are taken over — see the ATTR_LOD
 * note below. Positions cover every `VT` in the file, including vertices only the far LODs use:
 * they are cheap to upload, and skipping them would mean renumbering every index.
 */
export interface Obj8Mesh {
  /** x, y, z per vertex. X east, Y up, Z south, in metres. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** s, t per vertex. */
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

export interface Obj8ParseOptions {
  /** Collect the triangles as well as measure them. Off by default. */
  readonly mesh?: boolean;
}

export interface Obj8Geometry {
  /** Every `VT` record in the file, across all LODs. */
  readonly vertexCount: number;
  /** Triangles actually drawn up close, draped geometry excluded. */
  readonly triangleCount: number;
  /**
   * Bounds of the solid geometry drawn at close range. `null` when the object has none — a few
   * library entries are lights or lines only.
   */
  readonly bounds: Bounds | null;
  /** Bounds of draped geometry, which is a ground decal and can extend well past the building. */
  readonly drapedBounds: Bounds | null;
  readonly lods: readonly Obj8LodRange[];
  readonly textures: Obj8Textures;
  readonly hasAnimation: boolean;
  /** Present only when `{ mesh: true }` was asked for. */
  readonly mesh?: Obj8Mesh;
  /**
   * The draped triangles, when there are any and a mesh was asked for.
   *
   * Ground decals — runway markings, drains, oil stains — have **no solid geometry at all**: 476
   * objects out of 3 706 in a real installation are nothing but this. Without it they get no
   * thumbnail, and picking one of twenty markings by name is exactly the job a picture does best.
   */
  readonly drapedMesh?: Obj8Mesh;
}

export class Obj8ParseError extends Error {}

/** X-Plane axes: +X east, +Y up, +Z south. Metres. */
export interface Obj8Size {
  /** East–west extent. */
  readonly width: number;
  /** Vertical extent above ground; geometry below y=0 is excluded (foundations). */
  readonly height: number;
  /** North–south extent. */
  readonly depth: number;
}

export function sizeOf(bounds: Bounds): Obj8Size {
  return {
    width: bounds.max.x - bounds.min.x,
    height: Math.max(0, bounds.max.y),
    depth: bounds.max.z - bounds.min.z,
  };
}

/**
 * The ground footprint of those bounds: the X/Z rectangle, in model-local metres.
 *
 * Deliberately not reduced to width and depth like `sizeOf`. The model origin — where the DSF
 * coordinate puts the object — is inside this rectangle somewhere, and for 45% of the real catalog
 * that somewhere is not the middle. See GroundBox in src/core/model.ts for the measurement.
 */
export function groundOf(bounds: Bounds): GroundBox {
  return { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z };
}

/** How far the geometry reaches below the insertion plane. Positive metres, 0 when it does not. */
export function belowGround(bounds: Bounds): number {
  return Math.max(0, -bounds.min.y);
}

const LINE_BREAK = /\r\n|\r|\n/;
/** ⚠️ Fields are TAB-delimited in stock objects. Splitting on a literal space finds nothing. */
const FIELDS = /\s+/;

/**
 * A copy of `s` that does not hold the text it was cut from alive.
 *
 * V8 represents a slice of a long string as a pointer into the original rather than as a copy. So a
 * thirty-character texture path taken out of a 200 KB `.obj` keeps all 200 KB — and the catalog
 * scanner keeps one such path per object, for as long as the scan runs. On a 34 899-object
 * installation that came to 3.8 GB of heap: the scan died around 31 500 objects, and the only thing
 * the app could say about it was "exit code 5". (OldFartMike and HenryHDF, x-plane.org, 1.0.1.)
 *
 * Concatenating first forces a fresh string, so what outlives the parse is the path and nothing
 * else. Measured, because which idioms work is not obvious: this one, `split('').join('')` and a
 * `JSON` round-trip all detach; `normalize()` does not — with nothing to normalise it hands back
 * the very same slice. tests/obj8.test.ts holds the parser to it.
 */
function detached(s: string): string {
  return (' ' + s).slice(1);
}

interface Range {
  readonly offset: number;
  readonly count: number;
}

export function parseObj8(text: string, options: Obj8ParseOptions = {}): Obj8Geometry {
  const wantMesh = options.mesh === true;
  const lines = text.split(LINE_BREAK);

  // Header: "I" or "A", then the version, then OBJ. Blank lines and comments may sit between them.
  const header = lines.filter((l) => l.trim() !== '' && !l.startsWith('#')).slice(0, 3);
  if (header.length < 3 || (header[0]!.trim() !== 'I' && header[0]!.trim() !== 'A')) {
    throw new Obj8ParseError('Not an OBJ8 file: missing the I/A line ending marker.');
  }
  if (!header[1]!.trim().startsWith('800')) {
    throw new Obj8ParseError(`Unsupported OBJ version: ${header[1]!.trim()}`);
  }
  if (header[2]!.trim() !== 'OBJ') {
    throw new Obj8ParseError('Not an OBJ8 file: third line is not OBJ.');
  }

  const vx: number[] = [];
  const vy: number[] = [];
  const vz: number[] = [];
  // Only filled when a mesh was asked for. Five more numbers per vertex across a whole library
  // scan is work nobody wanted done.
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const lods: Obj8LodRange[] = [];
  const solid: Range[] = [];
  const draped: Range[] = [];
  const textures: { albedo?: string; lit?: string; normal?: string; draped?: string } = {};

  let hasAnimation = false;
  let isDraped = false;
  // undefined until the first ATTR_LOD. An object without any LOD draws all of its geometry.
  let currentLodNear: number | undefined;

  for (const raw of lines) {
    if (raw === '' || raw.charCodeAt(0) === 35 /* # */) continue;
    const line = raw.trim();
    if (line === '') continue;

    // Hot path first: VT and IDX dominate every real file.
    if (line.startsWith('VT')) {
      const f = line.split(FIELDS);
      vx.push(Number(f[1]));
      vy.push(Number(f[2]));
      vz.push(Number(f[3]));
      if (wantMesh) {
        normals.push(Number(f[4]), Number(f[5]), Number(f[6]));
        uvs.push(Number(f[7]), Number(f[8]));
      }
      continue;
    }
    if (line.startsWith('IDX')) {
      const f = line.split(FIELDS);
      for (let i = 1; i < f.length; i++) indices.push(Number(f[i]));
      continue;
    }
    if (line.startsWith('TRIS')) {
      const f = line.split(FIELDS);
      const range = { offset: Number(f[1]), count: Number(f[2]) };
      // Only geometry visible up close counts. See the ATTR_LOD note below.
      if (isDraped) draped.push(range);
      else if (currentLodNear === undefined || currentLodNear === 0) solid.push(range);
      continue;
    }

    if (line.startsWith('ATTR_LOD_draped')) continue; // a draped draw distance, not a geometry LOD
    if (line.startsWith('ATTR_LOD')) {
      const f = line.split(FIELDS);
      const near = Number(f[1]);
      const far = Number(f[2]);
      lods.push({ near, far });
      currentLodNear = near;
      continue;
    }
    if (line.startsWith('ATTR_draped')) {
      isDraped = true;
      continue;
    }
    if (line.startsWith('ATTR_no_draped')) {
      isDraped = false;
      continue;
    }

    if (line.startsWith('TEXTURE')) {
      const f = line.split(FIELDS);
      const keyword = f[0]!;
      // TEXTURE_DRAPED_NORMAL takes a leading numeric argument before the path.
      const value = f.length > 2 && Number.isFinite(Number(f[1])) ? f[2] : f[1];
      if (!value) continue;
      // The only piece of the file that outlives this function — see `detached` above.
      const path = detached(value);
      if (keyword === 'TEXTURE') textures.albedo = path;
      else if (keyword === 'TEXTURE_LIT') textures.lit = path;
      else if (keyword === 'TEXTURE_NORMAL') textures.normal = path;
      else if (keyword === 'TEXTURE_DRAPED') textures.draped = path;
      continue;
    }

    if (line.startsWith('ANIM_')) {
      hasAnimation = true;
      continue;
    }
  }

  return {
    vertexCount: vx.length,
    triangleCount: solid.reduce((n, r) => n + r.count / 3, 0),
    bounds: boundsOf(solid, indices, vx, vy, vz),
    drapedBounds: boundsOf(draped, indices, vx, vy, vz),
    lods,
    textures,
    hasAnimation,
    ...(wantMesh ? { mesh: meshOf(solid, indices, vx, vy, vz, normals, uvs) } : {}),
    ...(wantMesh && draped.length > 0
      ? { drapedMesh: meshOf(draped, indices, vx, vy, vz, normals, uvs) }
      : {}),
  };
}

/**
 * Pack the nearest LOD's triangles into typed arrays.
 *
 * A `TRIS` range that runs past the end of the index list is dropped rather than trusted. It
 * happens in objects that were edited by hand, and the alternative is a buffer full of `NaN`
 * indices that WebGL turns into a silent black square — a thumbnail that is wrong but looks
 * deliberate.
 */
function meshOf(
  ranges: readonly Range[],
  indices: readonly number[],
  vx: readonly number[],
  vy: readonly number[],
  vz: readonly number[],
  normals: readonly number[],
  uvs: readonly number[],
): Obj8Mesh {
  const kept: number[] = [];
  for (const range of ranges) {
    if (range.offset < 0 || range.offset + range.count > indices.length) continue;
    for (let i = 0; i < range.count; i += 1) {
      const index = indices[range.offset + i]!;
      if (index >= 0 && index < vx.length) kept.push(index);
    }
  }

  const positions = new Float32Array(vx.length * 3);
  for (let i = 0; i < vx.length; i += 1) {
    positions[i * 3] = vx[i]!;
    positions[i * 3 + 1] = vy[i]!;
    positions[i * 3 + 2] = vz[i]!;
  }

  // A file can carry fewer normals or UVs than vertices if a VT line was short. Padding with zero
  // keeps the buffers the length WebGL requires; a lit triangle with a zero normal reads as flat,
  // which is a better failure than a draw call that never happens.
  const normalArray = new Float32Array(vx.length * 3);
  normalArray.set(normals.slice(0, vx.length * 3).map((n) => (Number.isFinite(n) ? n : 0)));
  const uvArray = new Float32Array(vx.length * 2);
  uvArray.set(uvs.slice(0, vx.length * 2).map((n) => (Number.isFinite(n) ? n : 0)));

  return {
    positions,
    normals: normalArray,
    uvs: uvArray,
    indices: Uint32Array.from(kept),
  };
}

/**
 * Bounds over exactly the vertices those triangle ranges reach.
 *
 * Taking every `VT` instead would be simpler and usually identical, but it would fold in far-LOD
 * variants and, worse, draped ground decals — which for an apron or a taxiway marking can be many
 * times wider than the building they belong to. A footprint drawn from that would be a lie.
 */
function boundsOf(
  ranges: readonly Range[],
  indices: readonly number[],
  vx: readonly number[],
  vy: readonly number[],
  vz: readonly number[],
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let seen = 0;

  for (const range of ranges) {
    const end = Math.min(range.offset + range.count, indices.length);
    for (let i = range.offset; i < end; i++) {
      const v = indices[i]!;
      const x = vx[v];
      if (x === undefined) continue; // malformed index; skip rather than poison the bounds
      const y = vy[v]!;
      const z = vz[v]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      seen++;
    }
  }

  if (seen === 0) return null;
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}
