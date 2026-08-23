/**
 * Thumbnails on disk, so an object is drawn once and not once per launch.
 *
 * Rendering one takes about a millisecond, which sounds like no reason to cache anything until you
 * remember what has to happen first: read a `.obj`, parse it, find its atlas, pull a mip out of a
 * multi-megabyte DDS. That is the expensive part, and it is the part a cached PNG skips.
 *
 * The cache is **derived data about the user's own installation**, kept in userData and never
 * shipped — the same standing rule as the catalog cache. Nothing of Laminar's leaves this machine.
 *
 * Keyed by installation as well as by object: two installations can export the same virtual path
 * from different libraries, and showing one's picture for the other's object would be a quiet lie.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../node/fsAtomic.js';

/**
 * A ceiling on what will be written, in bytes.
 *
 * The renderer produces these, and the renderer is the untrusted side. A 128-pixel PNG is a few
 * kilobytes; this is generous enough never to reject a real one and small enough that a renderer
 * with a bug cannot fill the disk one thumbnail at a time.
 */
const MAX_BYTES = 512 * 1024;

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 20);

function directoryFor(userData: string, installation: string): string {
  return join(userData, 'thumbnails', digest(installation));
}

function fileFor(userData: string, installation: string, virtualPath: string): string {
  // Hashed, not sanitised: a virtual path contains slashes and arbitrary punctuation, and every
  // scheme for flattening one into a filename either collides or produces something unreadable.
  return join(directoryFor(userData, installation), `${digest(virtualPath)}.png`);
}

export function readThumbnail(
  userData: string,
  installation: string,
  virtualPath: string,
): Uint8Array | null {
  const file = fileFor(userData, installation, virtualPath);
  try {
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  } catch {
    return null;
  }
}

/** Store one. Returns false when the bytes were refused, which is not worth an exception. */
export function writeThumbnail(
  userData: string,
  installation: string,
  virtualPath: string,
  png: Uint8Array,
): boolean {
  if (png.byteLength === 0 || png.byteLength > MAX_BYTES) return false;
  // Cheap sanity: a PNG starts with this and nothing else does. It costs eight comparisons and it
  // means a cache directory can only ever contain PNGs, whatever the renderer meant to send.
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (SIGNATURE.some((byte, index) => png[index] !== byte)) return false;

  writeFileAtomic(fileFor(userData, installation, virtualPath), png);
  return true;
}

/**
 * Throw away every thumbnail for an installation.
 *
 * A rescan is the moment an object can change shape or texture underneath a picture of it, so the
 * pictures go. Regenerating them costs a millisecond each, on demand; a wrong one costs somebody
 * placing the object they were not looking at.
 */
export function clearThumbnails(userData: string, installation: string): void {
  rmSync(directoryFor(userData, installation), { recursive: true, force: true });
}
