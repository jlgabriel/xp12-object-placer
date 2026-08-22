/**
 * Join a relative path onto a root, and refuse if the result escapes.
 *
 * ⚠️ `path.join` does not contain anything. Measured on Windows:
 *
 *   join('C:/XP12/Custom Scenery/pkg', '../../../../Windows/win.ini')  ->  C:\Windows\win.ini
 *
 * Every relative path XOP joins onto a package root comes out of a third-party `library.txt` — a
 * file that arrived inside a scenery pack downloaded from the internet. Reading an arbitrary file
 * and reporting whether it parsed is already an existence oracle; the same pattern in the installer
 * would be an arbitrary write. So the check lives in one place and both use it. (Fable review P1-1.)
 *
 * What does *not* need defending against, verified on Windows rather than assumed:
 *   - a leading `/` or `\`     → stays under the root
 *   - a drive-qualified arg    → `pkg\D:\secret.txt`, still under the root
 *   - UNC in the second arg    → `pkg\attacker\share`, still under the root
 * `..` is the one escape.
 */

import { isAbsolute, join, relative } from 'node:path';

export class PathEscapeError extends Error {}

/**
 * The joined path, or `null` when the relative part would leave `root`.
 *
 * Returns rather than throws because the callers are loops over thousands of library entries, where
 * one hostile line should cost that entry and nothing else.
 */
export function containedJoin(root: string, relativePath: string): string | null {
  // A NUL truncates the path inside some syscalls, so what is checked and what is opened can differ.
  if (relativePath.includes('\0')) return null;

  const joined = join(root, relativePath);
  const back = relative(root, joined);

  // `relative` gives '' for the root itself, a plain relative path for anything inside it, and
  // something starting with '..' (or an absolute path, across drives) for anything outside.
  if (back.startsWith('..') || isAbsolute(back)) return null;

  return joined;
}
