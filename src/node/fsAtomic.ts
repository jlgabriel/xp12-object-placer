/**
 * Write a file without ever leaving a half-written one behind.
 *
 * Three places already did this by hand — the settings file, the catalog cache, the installer's
 * ini rewrite — and the project file makes four. The pattern is small enough to copy and important
 * enough that a copy which forgets a step is invisible until the day it matters.
 *
 * The step people forget is the rename. `writeFileSync` truncates first and then writes, so a
 * crash, a full disk or a power cut between those two leaves a file that exists, is readable, and
 * is empty. For a project file that is the worst outcome available: the previous save is exactly
 * what the user would have fallen back on, and truncating it destroys it while looking like
 * success. Writing beside it and renaming over the top means the old file is intact until the new
 * one is complete, and `rename` within a filesystem is atomic.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write `contents` to `target`, atomically, creating the directory if it is not there.
 *
 * The temporary sits next to the target rather than in the system temp directory, on purpose: a
 * rename across filesystems is not atomic — and on Windows it is not even a rename, it is a copy
 * and a delete, which is precisely the failure mode this exists to avoid.
 */
export function writeFileAtomic(target: string, contents: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, contents, 'utf8');
  renameSync(temporary, target);
}
