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

export function parseInstallList(text: string): string[] {
  const found: string[] = [];

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    for (const piece of line.split(DRIVE_ROOT)) {
      const path = normalize(piece);
      if (path !== '') found.push(path);
    }
  }

  // The file repeats entries across reinstalls; keep the first occurrence of each.
  return [...new Set(found)];
}
