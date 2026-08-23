import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearThumbnails,
  readThumbnail,
  writeThumbnail,
} from '../src/main/thumbnailCache.js';
import { readObjectGeometry, GeometryError } from '../src/node/objectGeometry.js';

const created: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xop-thumbs-'));
  created.push(dir);
  return dir;
}
afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (extra = 40): Uint8Array =>
  new Uint8Array([...PNG_HEADER, ...new Array<number>(extra).fill(7)]);

const INSTALL = 'D:/Laminar/X-Plane 12';
const OBJECT = 'lib/airport/hangars/arched/16x16/rusted_1.obj';

describe('the thumbnail cache', () => {
  it('gives back exactly what was put in', () => {
    const userData = scratch();
    expect(writeThumbnail(userData, INSTALL, OBJECT, png())).toBe(true);
    expect(readThumbnail(userData, INSTALL, OBJECT)).toEqual(png());
  });

  it('has nothing for an object it has not drawn', () => {
    expect(readThumbnail(scratch(), INSTALL, OBJECT)).toBeNull();
  });

  // Two installations can export the same virtual path from different libraries. Showing one's
  // picture for the other's object would be a quiet lie, and quiet is the bad part.
  it('keeps installations apart', () => {
    const userData = scratch();
    writeThumbnail(userData, INSTALL, OBJECT, png(10));
    writeThumbnail(userData, 'C:/Another/X-Plane 12', OBJECT, png(20));

    expect(readThumbnail(userData, INSTALL, OBJECT)).toEqual(png(10));
    expect(readThumbnail(userData, 'C:/Another/X-Plane 12', OBJECT)).toEqual(png(20));
  });

  it('survives a virtual path full of things a filename cannot hold', () => {
    const userData = scratch();
    const awkward = 'lib/../weird: name?/*.obj';
    expect(writeThumbnail(userData, INSTALL, awkward, png())).toBe(true);
    expect(readThumbnail(userData, INSTALL, awkward)).toEqual(png());
  });

  // The renderer produces these, and the renderer is the untrusted side.
  it('refuses anything that is not a PNG', () => {
    const userData = scratch();
    expect(writeThumbnail(userData, INSTALL, OBJECT, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false);
    expect(writeThumbnail(userData, INSTALL, OBJECT, new Uint8Array(0))).toBe(false);
    expect(writeThumbnail(userData, INSTALL, OBJECT, new Uint8Array(2_000_000).fill(0x89))).toBe(false);
    expect(readThumbnail(userData, INSTALL, OBJECT)).toBeNull();
  });

  it('leaves no temporary file behind', () => {
    const userData = scratch();
    writeThumbnail(userData, INSTALL, OBJECT, png());
    const directory = join(userData, 'thumbnails');
    const files = readdirSync(join(directory, readdirSync(directory)[0]!));
    expect(files.every((name) => name.endsWith('.png'))).toBe(true);
  });

  // A rescan is the moment an object can be reshaped or repainted underneath a picture of it.
  it('empties for one installation without touching the other', () => {
    const userData = scratch();
    writeThumbnail(userData, INSTALL, OBJECT, png());
    writeThumbnail(userData, 'C:/Another/X-Plane 12', OBJECT, png());

    clearThumbnails(userData, INSTALL);

    expect(readThumbnail(userData, INSTALL, OBJECT)).toBeNull();
    expect(readThumbnail(userData, 'C:/Another/X-Plane 12', OBJECT)).not.toBeNull();
  });

  it('does not mind clearing a cache that was never written', () => {
    expect(() => clearThumbnails(scratch(), INSTALL)).not.toThrow();
  });
});

// ── reading an object off the disk ─────────────────────────────────────────────────────────────

const T = '\t';
function writeObj(dir: string, name: string, body: string[]): string {
  const file = join(dir, name);
  writeFileSync(file, ['I', '800', 'OBJ', '', ...body].join('\n'), 'utf8');
  return file;
}

/** A DXT1 DDS with one mip, small enough to be uninteresting and real enough to be read. */
function writeDds(dir: string, name: string): void {
  const size = 8;
  const bytes = new Uint8Array(128 + 8 * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x20534444, true);
  view.setUint32(12, size, true);
  view.setUint32(16, size, true);
  view.setUint32(28, 1, true);
  view.setUint32(80, 0x4, true);
  for (let i = 0; i < 4; i += 1) view.setUint8(84 + i, 'DXT1'.charCodeAt(i));
  writeFileSync(join(dir, name), bytes);
}

const QUAD = [
  `VT${T}0${T}0${T}0${T}0${T}1${T}0${T}0${T}0`,
  `VT${T}1${T}0${T}0${T}0${T}1${T}0${T}1${T}0`,
  `VT${T}1${T}1${T}0${T}0${T}1${T}0${T}1${T}1`,
  `IDX${T}0`,
  `IDX${T}1`,
  `IDX${T}2`,
  `TRIS${T}0${T}3`,
];

describe('reading an object to draw it', () => {
  it('returns triangles and bounds', () => {
    const dir = scratch();
    const geometry = readObjectGeometry(writeObj(dir, 'thing.obj', QUAD), 64);
    expect(geometry.mesh.indices.length).toBe(3);
    expect(geometry.bounds.max.x).toBeCloseTo(1);
  });

  // The finding that would otherwise render 93% of the library grey: the OBJ names a .png, and on
  // a stock installation only the .dds beside it exists.
  it('finds the .dds when the object asked for a .png', () => {
    const dir = scratch();
    writeDds(dir, 'paint.dds');
    const geometry = readObjectGeometry(
      writeObj(dir, 'thing.obj', [`TEXTURE${T}paint.png`, ...QUAD]),
      64,
    );
    expect(geometry.texture?.format).toBe('BC1');
    expect(geometry.textureProblem).toBeUndefined();
  });

  // A library with one odd file in it should lose the paint on one object, not the picture.
  it('still draws when the texture cannot be read, and says why', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'paint.dds'), new Uint8Array(200)); // not a DDS at all
    const geometry = readObjectGeometry(
      writeObj(dir, 'thing.obj', [`TEXTURE${T}paint.dds`, ...QUAD]),
      64,
    );
    expect(geometry.mesh.indices.length).toBe(3);
    expect(geometry.texture).toBeUndefined();
    expect(geometry.textureProblem).toMatch(/not a DDS/);
  });

  it('says so when the object names no texture at all', () => {
    const dir = scratch();
    const geometry = readObjectGeometry(writeObj(dir, 'bare.obj', QUAD), 64);
    expect(geometry.textureProblem).toMatch(/names no texture/);
  });

  it('refuses an object with nothing to draw', () => {
    const dir = scratch();
    expect(() => readObjectGeometry(writeObj(dir, 'empty.obj', []), 64)).toThrow(GeometryError);
  });

  it('refuses a file that is not there', () => {
    expect(() => readObjectGeometry(join(scratch(), 'gone.obj'), 64)).toThrow(/could not be read/);
  });

  // The mip is copied rather than viewed: it crosses to the renderer, and a view over a
  // multi-megabyte DDS would take the whole DDS with it.
  it('hands over a copy of the mip, not a window onto the file', () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    writeDds(dir, 'paint.dds');
    const geometry = readObjectGeometry(
      writeObj(dir, 'thing.obj', [`TEXTURE${T}paint.dds`, ...QUAD]),
      64,
    );
    expect(geometry.texture!.data.byteLength).toBe(geometry.texture!.data.buffer.byteLength);
  });
});
