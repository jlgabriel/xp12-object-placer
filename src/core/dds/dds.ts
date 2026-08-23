/**
 * Reading DDS, which is what X-Plane's library is painted with.
 *
 * ⚠️ **The `.png` that is really a `.dds`.** An OBJ8 file names its texture as `something.png` and
 * that file is very often not there — X-Plane substitutes the `.dds` beside it. Measured across a
 * real 12.4.3 installation: **3 193 of 3 446 albedo references resolve only after the swap**. A
 * thumbnail renderer that trusts the extension in the OBJ renders 93% of the library untextured.
 * `textureCandidates` below is that rule.
 *
 * What the library actually contains, counted rather than assumed: 424 distinct files, **DXT1 (215)
 * and DXT5 (209)**, nothing else — no BC7, no DX10 header, and **every one of them has mipmaps**.
 * That last fact is why this module returns a mip rather than an image: a 128-pixel thumbnail has
 * no use for the 2048² level, and skipping to a small one is the difference between decoding four
 * megapixels and decoding sixty-four kilopixels.
 *
 * Nothing here decompresses anything. The blocks come out as they lie in the file, because
 * `WEBGL_compressed_texture_s3tc` uploads them to the GPU exactly like that — the decompression is
 * the graphics driver's job, and it is better at it.
 *
 * Pure: bytes in, a description and a subarray out. No filesystem.
 */

/** The two block formats this library uses. BC1 is DXT1, BC3 is DXT5. */
export type DdsFormat = 'BC1' | 'BC3';

/** Bytes per 4×4 block. BC1 packs colour only; BC3 adds an eight-byte alpha block in front. */
const BLOCK_BYTES: Record<DdsFormat, number> = { BC1: 8, BC3: 16 };

export interface DdsMip {
  readonly format: DdsFormat;
  /** Mip level, 0 being full size. */
  readonly level: number;
  readonly width: number;
  readonly height: number;
  /** The compressed blocks, ready for `compressedTexImage2D`. A view, not a copy. */
  readonly data: Uint8Array;
}

export interface DdsHeader {
  readonly format: DdsFormat;
  readonly width: number;
  readonly height: number;
  /** How many levels are stored. 0 in the file means "just the base level" and is reported as 1. */
  readonly mipCount: number;
}

export class DdsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DdsError';
  }
}

const MAGIC = 0x20534444; // "DDS " little-endian
const HEADER_BYTES = 128;
const DDPF_FOURCC = 0x4;

const fourCC = (view: DataView, at: number): string =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );

/** Blocks needed to cover w×h. The last row and column of a non-multiple-of-4 mip are padded. */
const blocksFor = (width: number, height: number): number =>
  Math.ceil(Math.max(1, width) / 4) * Math.ceil(Math.max(1, height) / 4);

export function readDdsHeader(bytes: Uint8Array): DdsHeader {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new DdsError('this file is too short to be a DDS');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new DdsError('this file is not a DDS');
  }

  const pixelFormatFlags = view.getUint32(80, true);
  if ((pixelFormatFlags & DDPF_FOURCC) === 0) {
    throw new DdsError('this DDS is uncompressed, and only DXT1 and DXT5 are supported');
  }

  const code = fourCC(view, 84);
  const format = code === 'DXT1' ? 'BC1' : code === 'DXT5' ? 'BC3' : null;
  if (format === null) {
    // Naming the code matters: "DX10" and "BC7" are the ones that would turn up on a machine whose
    // library is not stock, and a report saying which one arrived is what makes that actionable.
    throw new DdsError(`this DDS is ${code}, and only DXT1 and DXT5 are supported`);
  }

  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  if (width === 0 || height === 0) throw new DdsError('this DDS has no size');

  return { format, width, height, mipCount: Math.max(1, view.getUint32(28, true)) };
}

/**
 * The smallest stored mip whose longest side still covers `wanted` pixels.
 *
 * Smallest-that-still-covers rather than nearest: a thumbnail scaled down from slightly too much
 * detail looks right, and one scaled up from too little looks soft, and only one of those is worth
 * the extra megabytes.
 */
export function chooseMipLevel(header: DdsHeader, wanted: number): number {
  let level = 0;
  while (
    level + 1 < header.mipCount &&
    Math.max(header.width >> (level + 1), header.height >> (level + 1)) >= wanted
  ) {
    level += 1;
  }
  return level;
}

/** Where a level's blocks start, found by walking past the levels before it. */
function offsetOf(header: DdsHeader, level: number): number {
  let offset = HEADER_BYTES;
  for (let i = 0; i < level; i += 1) {
    offset += blocksFor(header.width >> i, header.height >> i) * BLOCK_BYTES[header.format];
  }
  return offset;
}

/**
 * Read one mip out of a DDS, at least `wanted` pixels on its longest side.
 *
 * A file that claims more mips than it stores is truncated rather than trusted: an out-of-range
 * subarray would hand WebGL a short buffer, and the error that produces names neither the file nor
 * the reason.
 */
export function readDdsMip(bytes: Uint8Array, wanted: number): DdsMip {
  const header = readDdsHeader(bytes);
  const level = chooseMipLevel(header, wanted);

  const width = Math.max(1, header.width >> level);
  const height = Math.max(1, header.height >> level);
  const start = offsetOf(header, level);
  const length = blocksFor(width, height) * BLOCK_BYTES[header.format];

  if (start + length > bytes.byteLength) {
    throw new DdsError(
      `this DDS says it has ${header.mipCount} mip levels but stops before level ${level}`,
    );
  }

  return { format: header.format, level, width, height, data: bytes.subarray(start, start + length) };
}

/**
 * The files to try, in order, for a texture an OBJ8 names.
 *
 * The `.dds` comes first even when the OBJ said `.png`, because that is what X-Plane does and
 * because on a stock installation it is nearly always the only one there. Paths stay relative: who
 * resolves them against the object's directory is the caller's business, and on the privileged
 * side of the bridge.
 */
export function textureCandidates(named: string): readonly string[] {
  const stem = named.replace(/\.[^./\\]+$/, '');
  const swapped = `${stem}.dds`;
  return swapped.toLowerCase() === named.toLowerCase() ? [named] : [swapped, named];
}
