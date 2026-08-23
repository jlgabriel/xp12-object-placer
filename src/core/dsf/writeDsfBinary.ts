/**
 * Write a binary DSF — the file X-Plane actually loads.
 *
 * ## Why this exists at all
 *
 * `DSF2TEXT` is DSFTool's interchange format, not something the simulator reads. Asked of
 * `X-Plane.exe` directly: `XPLNEDSF` and `sim/overlay` are in there, `DSF2TEXT` and `OBJECT_DEF`
 * are not (reference/dsf-overlay.md). So writing the text is half the job, and the other half is
 * either DSFTool — which the user would have to obtain separately, it does not ship with X-Plane —
 * or this file.
 *
 * ## Where the shape came from
 *
 * Not from the specification. Probe H0b's text was compiled by DSFTool into a 460-byte overlay that
 * X-Plane 12.4.3 loaded and flew, and that file was taken apart byte by byte. Everything below
 * reproduces it: the same atoms in the same order, the same 1/8° pool grid, the same plane
 * encoding. Where DSFTool emits something whose purpose is not obvious — two empty 32-bit pools —
 * it is emitted here too rather than dropped, because the cost is twenty bytes and the alternative
 * is finding out from a flight.
 *
 * ## The layout
 *
 * ```
 * "XPLNEDSF" uint32(1)          cookie and version
 * HEAD  { PROP }                 properties, as NUL-terminated key/value strings
 * DEFN  { TERT OBJT POLY NETW DEMN }   definition lists; all five present, most of them empty
 * GEOD  { POOL SCAL … PO32 SC32 … }    coordinate pools and their scales
 * CMDS                           the command stream that places objects at pool points
 * md5(everything above)          16-byte footer
 * ```
 *
 * Atom ids are stored with their four bytes **reversed**: `HEAD` sits on disk as `DAEH`.
 */

import type { PlacedObject } from '../model.js';
import type { DsfTile } from './tile.js';
import { assertPlaceable, definitionsOf, normalizeRotation } from './validate.js';

export interface DsfBinaryInput {
  readonly tile: DsfTile;
  readonly objects: readonly PlacedObject[];
  /** Written to `sim/creation_agent`. How a pack says who made it. */
  readonly creationAgent: string;
  /**
   * MD5 of the file body, for the footer.
   *
   * Injected rather than imported so this module stays free of Node builtins: `src/core` is
   * compiled into the renderer bundle too, and an `import 'node:crypto'` in here would break it.
   */
  readonly md5: (bytes: Uint8Array) => Uint8Array;
}

/**
 * How finely a pool's coordinates are quantised.
 *
 * A pool stores each coordinate as a uint16 across a range, so the range decides the resolution.
 * Over a whole 1° tile that would be 1.7 m — visibly wrong for a bollard. DSFTool solves it by
 * cutting the tile into a grid and giving each cell its own pool, and the grid it uses is **eighths
 * of a degree**: the H0b file came out with offsets of -70.875 and -33.5 for coordinates of
 * -70.78544 and -33.3758, which are exactly the eighth-degree cells those fall in.
 *
 * An eighth of a degree over 65535 steps is about 21 cm, which matches the ±17 cm that was measured
 * by round-tripping through DSFTool. Reproducing the grid rather than inventing one keeps XOP's
 * precision identical to WED's.
 */
const POOL_CELLS_PER_DEGREE = 8;
const POOL_SPAN_DEGREES = 1 / POOL_CELLS_PER_DEGREE;

/** uint16 pools address 65536 points. Beyond that a second pool for the same cell is needed. */
const MAX_POOL_POINTS = 65536;

/** Rotation is stored across a full turn, giving ~0.0055° — the ±0.005° that was measured. */
const ROTATION_SPAN_DEGREES = 360;

// ── byte plumbing ───────────────────────────────────────────────────────────────────────────────

class ByteWriter {
  private parts: Uint8Array[] = [];
  private size = 0;

  bytes(value: Uint8Array): void {
    this.parts.push(value);
    this.size += value.length;
  }

  u8(value: number): void {
    this.bytes(Uint8Array.of(value & 0xff));
  }

  u16(value: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value & 0xffff, true);
    this.bytes(b);
  }

  u32(value: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    this.bytes(b);
  }

  f32(value: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, value, true);
    this.bytes(b);
  }

  /** Latin-1 plus the NUL that terminates it. DSF string tables are NUL-separated. */
  stringZ(value: string): void {
    const b = new Uint8Array(value.length + 1);
    for (let i = 0; i < value.length; i++) b[i] = value.charCodeAt(i) & 0xff;
    b[value.length] = 0;
    this.bytes(b);
  }

  get length(): number {
    return this.size;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/** An atom: its four-character id reversed, its total length including this header, its body. */
function atom(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(3 - i);
  view.setUint32(4, out.length, true);
  out.set(body, 8);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ── plane encoding ──────────────────────────────────────────────────────────────────────────────

/** Plane encodings the format defines. DSFTool writes 3 for everything, and so does this. */
const ENCODING_RLE_DIFFERENCED = 3;

/**
 * Encode one plane of a pool the way DSFTool does: difference the values, then run-length them.
 *
 * **Differenced** — each value is stored as its distance from the one before, wrapping at 65536.
 * A row of objects at the same longitude becomes a first value and then zeros, which is what makes
 * the run-length pass worth anything.
 *
 * **Run-length** — a run header byte: the high bit means "the next single value, repeated `count`
 * times", clear means "the next `count` values, individually". Count is seven bits, so 127 at most.
 *
 * Repeat runs start at two identical values, which is the threshold the H0b file shows: its
 * latitude plane came out `01 5bfe | 82 42ff | 01 43ff` for deltas of one, two, one.
 */
export function encodePlane(values: readonly number[]): Uint8Array {
  const deltas: number[] = [];
  let previous = 0;
  for (const value of values) {
    deltas.push((value - previous) & 0xffff);
    previous = value;
  }

  const writer = new ByteWriter();
  let at = 0;
  while (at < deltas.length) {
    let repeat = 1;
    while (
      repeat < 127 &&
      at + repeat < deltas.length &&
      deltas[at + repeat] === deltas[at]
    ) {
      repeat++;
    }

    if (repeat >= 2) {
      writer.u8(0x80 | repeat);
      writer.u16(deltas[at]!);
      at += repeat;
      continue;
    }

    // No run here. Take individual values up to — but not including — the start of the next run,
    // so the repeat run gets both of its copies. Stopping one late instead costs a byte per run and
    // makes the output differ from DSFTool's for no reason, which is the last thing worth diverging
    // on when the reference file is the one the simulator already accepted.
    let single = 0;
    while (single < 127 && at + single < deltas.length) {
      const here = at + single;
      if (here + 1 < deltas.length && deltas[here] === deltas[here + 1]) break;
      single++;
    }
    writer.u8(single);
    for (let i = 0; i < single; i++) writer.u16(deltas[at + i]!);
    at += single;
  }

  return writer.finish();
}

/** Quantise a coordinate onto a pool's uint16 range. */
export function quantize(value: number, offset: number, span: number): number {
  const raw = Math.round(((value - offset) / span) * 0xffff);
  return Math.max(0, Math.min(0xffff, raw));
}

// ── pools ───────────────────────────────────────────────────────────────────────────────────────

interface Pool {
  /** South-west corner of this pool's eighth-degree cell, and the rotation origin (always 0). */
  readonly lonOffset: number;
  readonly latOffset: number;
  readonly lon: number[];
  readonly lat: number[];
  readonly rotation: number[];
}

/** Which eighth-degree cell a coordinate falls in, as an offset in degrees. */
function cellOffset(value: number, tileOrigin: number): number {
  const cell = Math.floor((value - tileOrigin) * POOL_CELLS_PER_DEGREE);
  // An object exactly on the tile's far edge belongs to the next tile, and assertPlaceable has
  // already refused it — but clamping costs nothing and keeps a rounding artefact from indexing
  // a cell that does not exist.
  const clamped = Math.max(0, Math.min(POOL_CELLS_PER_DEGREE - 1, cell));
  return tileOrigin + clamped * POOL_SPAN_DEGREES;
}

interface Placement {
  readonly definition: number;
  readonly pool: number;
  readonly point: number;
}

/**
 * Sort every object into a pool, keeping the objects' own order inside each one.
 *
 * The returned placements are in the same order as `objects`, so the command stream places things
 * in the order the user made them, which keeps two exports of one project comparable.
 */
function buildPools(
  tile: DsfTile,
  objects: readonly PlacedObject[],
  definitionIndex: ReadonlyMap<string, number>,
): { pools: Pool[]; placements: Placement[] } {
  const pools: Pool[] = [];
  const byCell = new Map<string, number>();
  const placements: Placement[] = [];

  for (const object of objects) {
    const lonOffset = cellOffset(object.position.lon, tile.lon);
    const latOffset = cellOffset(object.position.lat, tile.lat);
    const key = `${lonOffset},${latOffset}`;

    let index = byCell.get(key);
    // A cell that fills up gets a second pool of its own; `byCell` then points at the newest, so
    // the old one is closed and never grows past the addressable range.
    if (index === undefined || pools[index]!.lon.length >= MAX_POOL_POINTS) {
      index = pools.length;
      pools.push({ lonOffset, latOffset, lon: [], lat: [], rotation: [] });
      byCell.set(key, index);
    }

    const pool = pools[index]!;
    const point = pool.lon.length;
    pool.lon.push(quantize(object.position.lon, lonOffset, POOL_SPAN_DEGREES));
    pool.lat.push(quantize(object.position.lat, latOffset, POOL_SPAN_DEGREES));
    pool.rotation.push(
      quantize(normalizeRotation(object.rotation), 0, ROTATION_SPAN_DEGREES),
    );

    placements.push({
      definition: definitionIndex.get(object.libraryPath)!,
      pool: index,
      point,
    });
  }

  return { pools, placements };
}

function poolAtom(pool: Pool): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(pool.lon.length);
  writer.u8(3); // three planes: longitude, latitude, rotation
  for (const plane of [pool.lon, pool.lat, pool.rotation]) {
    writer.u8(ENCODING_RLE_DIFFERENCED);
    writer.bytes(encodePlane(plane));
  }
  return atom('POOL', writer.finish());
}

function scalAtom(pool: Pool): Uint8Array {
  const writer = new ByteWriter();
  // Multiplier then offset, per plane. A stored value means offset + (raw / 65535) * multiplier.
  writer.f32(POOL_SPAN_DEGREES);
  writer.f32(pool.lonOffset);
  writer.f32(POOL_SPAN_DEGREES);
  writer.f32(pool.latOffset);
  writer.f32(ROTATION_SPAN_DEGREES);
  writer.f32(0);
  return atom('SCAL', writer.finish());
}

/**
 * The two empty 32-bit pools DSFTool emits.
 *
 * Their purpose is not established — they carry no points, and nothing in an object-only overlay
 * refers to them. They are reproduced rather than dropped because the file they came from is one
 * X-Plane demonstrably loads, and the cost of keeping them is twenty bytes against the cost of
 * discovering they mattered, which is a flight.
 */
function empty32BitPools(tile: DsfTile): Uint8Array[] {
  const first = new ByteWriter();
  first.u32(0); // no points
  first.u8(4); // four planes
  for (let i = 0; i < 4; i++) first.u8(ENCODING_RLE_DIFFERENCED);

  const firstScale = new ByteWriter();
  for (const [multiplier, offset] of [
    [1, tile.lon] as const,
    [1, tile.lat] as const,
    [65535, -32768] as const,
    [0, 0] as const,
  ]) {
    firstScale.f32(multiplier);
    firstScale.f32(offset);
  }

  const second = new ByteWriter();
  second.u32(0);
  second.u8(0);

  return [
    atom('PO32', first.finish()),
    atom('SC32', firstScale.finish()),
    atom('PO32', second.finish()),
    atom('SC32', new Uint8Array(0)),
  ];
}

// ── commands ────────────────────────────────────────────────────────────────────────────────────

const CMD_COORDINATE_POOL_SELECT = 1;
const CMD_JUNCTION_OFFSET_SELECT = 2;
const CMD_SET_DEFINITION_8 = 3;
const CMD_SET_DEFINITION_16 = 4;
const CMD_OBJECT = 7;

function commandsAtom(placements: readonly Placement[]): Uint8Array {
  const writer = new ByteWriter();

  writer.u8(CMD_JUNCTION_OFFSET_SELECT);
  writer.u32(0);

  // State machine: the stream carries a current definition and a current pool, and an Object
  // command spends whatever those happen to be. Emitting a select only when it changes is not an
  // optimisation — repeating them would be equally valid — but it is what DSFTool does, and it
  // keeps the stream readable when something has to be taken apart by hand again.
  let definition = -1;
  let pool = -1;

  for (const placement of placements) {
    if (placement.definition !== definition) {
      definition = placement.definition;
      // Past 255 definitions the 8-bit form cannot say which one, and a project can easily hold
      // more: the catalog offers 3 837 distinct objects.
      if (definition < 256) {
        writer.u8(CMD_SET_DEFINITION_8);
        writer.u8(definition);
      } else {
        writer.u8(CMD_SET_DEFINITION_16);
        writer.u16(definition);
      }
    }
    if (placement.pool !== pool) {
      pool = placement.pool;
      writer.u8(CMD_COORDINATE_POOL_SELECT);
      writer.u16(pool);
    }
    writer.u8(CMD_OBJECT);
    writer.u16(placement.point);
  }

  return atom('CMDS', writer.finish());
}

// ── the file ────────────────────────────────────────────────────────────────────────────────────

export function writeDsfBinary(input: DsfBinaryInput): Uint8Array {
  const { tile, objects, creationAgent, md5 } = input;
  assertPlaceable(tile, objects);

  const definitions = definitionsOf(objects);
  const definitionIndex = new Map(definitions.map((path, index) => [path, index]));
  const { pools, placements } = buildPools(tile, objects, definitionIndex);

  const properties = new ByteWriter();
  for (const [key, value] of [
    ['sim/west', String(tile.lon)],
    ['sim/east', String(tile.lon + 1)],
    ['sim/north', String(tile.lat + 1)],
    ['sim/south', String(tile.lat)],
    ['sim/planet', 'earth'],
    // Without this the tile is a base mesh, and a base mesh replaces the terrain rather than
    // sitting on it. It is absent from Laminar's published specification and present in every
    // overlay on disk.
    ['sim/overlay', '1'],
    ['sim/creation_agent', creationAgent],
  ]) {
    properties.stringZ(key!);
    properties.stringZ(value!);
  }

  const objectDefinitions = new ByteWriter();
  for (const path of definitions) objectDefinitions.stringZ(path);

  const geodetic: Uint8Array[] = [];
  for (const pool of pools) {
    geodetic.push(poolAtom(pool), scalAtom(pool));
  }
  geodetic.push(...empty32BitPools(tile));

  const body = concat([
    // Cookie and version.
    Uint8Array.of(0x58, 0x50, 0x4c, 0x4e, 0x45, 0x44, 0x53, 0x46), // "XPLNEDSF"
    Uint8Array.of(1, 0, 0, 0),

    atom('HEAD', atom('PROP', properties.finish())),
    atom(
      'DEFN',
      concat([
        atom('TERT', new Uint8Array(0)), // terrains
        atom('OBJT', objectDefinitions.finish()),
        atom('POLY', new Uint8Array(0)),
        atom('NETW', new Uint8Array(0)),
        atom('DEMN', new Uint8Array(0)), // raster layers
      ]),
    ),
    atom('GEOD', concat(geodetic)),
    commandsAtom(placements),
  ]);

  const digest = md5(body);
  if (digest.length !== 16) {
    throw new Error(`The MD5 footer must be 16 bytes, got ${digest.length}.`);
  }

  return concat([body, digest]);
}
