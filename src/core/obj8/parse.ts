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

/** How far the geometry reaches below the insertion plane. Positive metres, 0 when it does not. */
export function belowGround(bounds: Bounds): number {
  return Math.max(0, -bounds.min.y);
}

const LINE_BREAK = /\r\n|\r|\n/;
/** ⚠️ Fields are TAB-delimited in stock objects. Splitting on a literal space finds nothing. */
const FIELDS = /\s+/;

interface Range {
  readonly offset: number;
  readonly count: number;
}

export function parseObj8(text: string): Obj8Geometry {
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
      if (keyword === 'TEXTURE') textures.albedo = value;
      else if (keyword === 'TEXTURE_LIT') textures.lit = value;
      else if (keyword === 'TEXTURE_NORMAL') textures.normal = value;
      else if (keyword === 'TEXTURE_DRAPED') textures.draped = value;
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
