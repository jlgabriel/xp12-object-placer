/**
 * Everything needed to draw one object, gathered off the disk.
 *
 * This is the privileged half of a thumbnail. The renderer cannot open a file, so it names an
 * object — by the virtual path the catalog gave it, never by a path of its own — and gets back
 * triangles and one mip of the texture. Whether that virtual path is one main actually offered is
 * checked by the caller, the same way `selectInstallation` checks an installation.
 *
 * Deliberately small and dependency-free so it can be tested with a temporary directory.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseObj8 } from '../core/obj8/parse.js';
import { readDdsMip, textureCandidates } from '../core/dds/dds.js';
import type { ObjectGeometry } from '../shared/api.js';

export type { ObjectGeometry };

/**
 * The biggest object worth previewing, in bytes.
 *
 * Parsing runs at roughly 22 ms per megabyte and happens in main, where a long one freezes the
 * window. Measured across a real installation: the median object is 30 KB and the 99th percentile
 * is 6.9 MB — but one oil platform is 63 MB and takes 1.4 seconds by itself. Three objects out of
 * 3 706 are over this line. They lose their picture; the window never locks up for a second and a
 * half. If that trade stops being worth it, this work belongs in a utilityProcess, which is what
 * the scanner does and for exactly this reason.
 */
const MAX_OBJ_BYTES = 16 * 1024 * 1024;

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

/**
 * Read an object and its albedo.
 *
 * `mipSize` is the picture this is for, not the texture's size: a 128-pixel thumbnail asks for 128
 * and gets whichever stored level covers it. Every DDS in a stock library has mipmaps, so this is
 * nearly always a small read out of a large file rather than a large read.
 *
 * A texture that cannot be read is **not** an error. The object still draws, untextured and grey,
 * and that is far better than no thumbnail at all — a library with one odd BC7 file in it should
 * lose the paint on one object, not the picture.
 */
export function readObjectGeometry(objFile: string, mipSize: number): ObjectGeometry {
  let bytes: number;
  try {
    bytes = statSync(objFile).size;
  } catch {
    throw new GeometryError('that object file could not be read');
  }
  if (bytes > MAX_OBJ_BYTES) {
    throw new GeometryError(`that object is ${Math.round(bytes / 1e6)} MB, too large to preview`);
  }

  let text: string;
  try {
    text = readFileSync(objFile, 'utf8');
  } catch {
    throw new GeometryError('that object file could not be read');
  }

  const parsed = parseObj8(text, { mesh: true });

  // A ground decal has no solid geometry at all: 476 objects out of 3 706 in a real installation
  // are nothing but draped triangles — runway markings, drains, oil stains. Falling back to those
  // is the difference between a picture and no picture, and choosing one of twenty markings by
  // name is precisely the job a picture does best.
  const solid = parsed.mesh && parsed.mesh.indices.length > 0 ? parsed.mesh : null;
  const mesh = solid ?? parsed.drapedMesh ?? null;
  const bounds = solid ? parsed.bounds : (parsed.drapedBounds ?? parsed.bounds);
  if (!mesh || mesh.indices.length === 0 || !bounds) {
    throw new GeometryError('that object has no geometry to draw');
  }
  const grounded = solid === null;

  const named = parsed.textures.albedo;
  if (named === undefined) {
    return {
      mesh,
      bounds,
      ...(grounded ? { grounded } : {}),
      textureProblem: 'the object names no texture',
    };
  }

  let problem = 'no texture file was found beside the object';
  for (const candidate of textureCandidates(named)) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(resolve(dirname(objFile), candidate)));
    } catch {
      continue; // the .dds is tried first and is usually the one that exists
    }
    try {
      const mip = readDdsMip(bytes, mipSize);
      return {
        mesh,
        bounds,
        ...(grounded ? { grounded } : {}),
        texture: {
          format: mip.format,
          width: mip.width,
          height: mip.height,
          // Copied out of the file's buffer: this crosses to the renderer, and sending a view over
          // a multi-megabyte DDS would send the whole DDS with it.
          data: new Uint8Array(mip.data),
        },
      };
    } catch (error) {
      problem = error instanceof Error ? error.message : 'the texture could not be read';
    }
  }

  return { mesh, bounds, ...(grounded ? { grounded } : {}), textureProblem: problem };
}
