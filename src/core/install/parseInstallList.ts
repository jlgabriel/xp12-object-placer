/**
 * Read X-Plane's own record of where it is installed.
 *
 * The installer maintains a plain text file listing every installation it knows about, one path per
 * line. Reading it beats guessing at `C:\X-Plane 12`, `Program Files`, half a dozen Steam library
 * roots and whatever the user actually chose — the answer is already written down.
 *
 * Pure: text in, paths out. Checking whether those paths still exist is the caller's job, and it
 * matters: the file happily keeps listing installations that were deleted years ago.
 */

/**
 * A Windows drive root appearing anywhere other than the start of a line means two entries were
 * written with no separator between them. Real, in a real file:
 *
 *   C:\Program Files (x86)/Steam/steamapps/common/X-Plane 12/D:\Laminar/XP12-Beta/X-Plane 12/
 *
 * Same defect as the five malformed EXPORT lines in the stock libraries — Laminar's writers drop
 * separators now and then, and both files have to be read defensively rather than trusted.
 */
const DRIVE_ROOT = /(?=[A-Za-z]:[\\/])/g;

/** Backslashes to forward slashes, no trailing separator. The file mixes both, sometimes per line. */
function normalize(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * ⚠️ A UNC entry is dropped, and that is a security decision rather than a simplification.
 *
 * The caller `stat`s every path this returns, synchronously, on the main thread, at startup, before
 * the window is shown. On Windows a `stat` of `//host/share` opens an SMB connection: against a
 * dead host it hangs the application before it can draw anything, and against a live attacker host
 * it hands over the user's NTLM hash. This file is written by an installer, not by the user, and it
 * is exactly the untrusted input that reaches that syscall. (Fable review P1-4.)
 *
 * Somebody genuinely running X-Plane from a network share is rare, and can still point XOP at it
 * through Browse — which is explicit intent, at a moment of their choosing, rather than something
 * a text file causes during boot.
 */
function isUnc(path: string): boolean {
  return path.startsWith('//');
}

export function parseInstallList(text: string): string[] {
  const found: string[] = [];

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    for (const piece of line.split(DRIVE_ROOT)) {
      const path = normalize(piece);
      if (path === '' || isUnc(path)) continue;
      found.push(path);
    }
  }

  // The file repeats entries across reinstalls; keep the first occurrence of each.
  return [...new Set(found)];
}
