/**
 * `library.txt` parser.
 *
 * Pure: takes the text of one library file, returns what it declares. Finding the files and
 * resolving the physical paths is the scanner's job.
 *
 * Every directive handled here was counted in a real X-Plane 12.4.3 installation first — 19 223
 * `EXPORT`, 9 980 `EXPORT_EXCLUDE_SEASON`, and so on down to a single `REGION_DREF`. Nothing is
 * implemented on the strength of the specification alone. See reference/library-txt.md.
 */

export type LibraryVisibility = 'public' | 'private' | 'deprecated' | 'semi-deprecated';

export interface LibraryExport {
  /** The directive verbatim, e.g. `EXPORT`, `EXPORT_BACKUP`, `EXPORT_RATIO_SEASON`. */
  readonly directive: string;
  /** Virtual path, exactly as written. Case is significant and is never normalized. */
  readonly virtualPath: string;
  /** Physical path relative to the package root, exactly as written. May contain spaces. */
  readonly relativePath: string;
  /** Visibility in force at this line, from the most recent PUBLIC/PRIVATE/DEPRECATED marker. */
  readonly visibility: LibraryVisibility;
  /** The `REGION` in force, if any. */
  readonly region?: string;
  /** `EXPORT_RATIO` weight. */
  readonly ratio?: number;
  /** Season codes for the `*_SEASON` directives: `spr`, `sum`, `fal`, `win`. */
  readonly seasons?: readonly string[];
}

export interface ParsedLibrary {
  readonly version: number;
  readonly exports: readonly LibraryExport[];
  readonly regionsDefined: readonly string[];
  /**
   * Lines the parser did not understand, with their 1-based line number.
   *
   * Deliberately reported rather than swallowed: a scanner that silently drops what it cannot read
   * looks complete and is not. The CLI prints the count.
   */
  readonly unrecognized: readonly { line: number; text: string }[];
}

export class LibraryParseError extends Error {}

const LINE_BREAK = /\r\n|\r|\n/;
const FIELDS = /\s+/;

/** How many arguments sit between the directive and the virtual path. */
const LEADING_ARGS: Readonly<Record<string, number>> = {
  EXPORT: 0,
  EXPORT_EXTEND: 0,
  EXPORT_BACKUP: 0,
  EXPORT_EXCLUDE: 0,
  EXPORT_EXCLUDE_BACKUP: 0,
  EXPORT_RATIO: 1, // ratio
  EXPORT_SEASON: 1, // season list
  EXPORT_EXTEND_SEASON: 1,
  EXPORT_EXCLUDE_SEASON: 1,
  EXPORT_RATIO_SEASON: 2, // ratio, then season list
};

const VISIBILITY: Readonly<Record<string, LibraryVisibility>> = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  DEPRECATED: 'deprecated',
  SEMI_DEPRECATED: 'semi-deprecated',
};

export function parseLibraryTxt(text: string): ParsedLibrary {
  const lines = text.split(LINE_BREAK);

  // The header is A/I, a version, then LIBRARY — but comments and blank lines may sit between
  // them, so its position in the raw line array is not fixed. Find LIBRARY and start after it
  // rather than assuming line 3; assuming it leaves the header tokens to be reported as garbage.
  const headerEnd = lines.findIndex((l) => l.trim() === 'LIBRARY');
  if (headerEnd === -1) {
    throw new LibraryParseError('Not a library.txt: no LIBRARY line.');
  }
  const versionLine = lines
    .slice(0, headerEnd)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .at(-1);
  const version = Number.parseInt(versionLine ?? '', 10);
  if (!Number.isFinite(version)) {
    throw new LibraryParseError(`Unreadable library version: ${versionLine ?? '(missing)'}`);
  }

  const exports: LibraryExport[] = [];
  const regionsDefined: string[] = [];
  const unrecognized: { line: number; text: string }[] = [];

  // Defaults in force before any marker. ❓ Not verified: the specification does not say what
  // visibility applies before the first PUBLIC/PRIVATE, and most libraries never declare one.
  // Public is assumed because everything predating the markers was usable by anyone.
  let visibility: LibraryVisibility = 'public';
  let region: string | undefined;

  for (let i = headerEnd + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const tokens = line.split(FIELDS);
    const directive = tokens[0]!;

    const marker = VISIBILITY[directive];
    if (marker) {
      visibility = marker; // an optional date argument may follow; it is not needed here
      continue;
    }

    if (directive === 'REGION_ALL') {
      region = undefined;
      continue;
    }
    if (directive === 'REGION') {
      region = tokens[1];
      continue;
    }
    if (directive === 'REGION_DEFINE') {
      if (tokens[1]) regionsDefined.push(tokens[1]);
      region = tokens[1]; // a definition opens with the region it is defining
      continue;
    }
    if (directive === 'REGION_RECT' || directive === 'REGION_BITMAP' || directive === 'REGION_DREF') {
      continue; // geometry of a region; XOP does not filter by region yet
    }

    const leading = LEADING_ARGS[directive];
    if (leading === undefined) {
      unrecognized.push({ line: i + 1, text: line });
      continue;
    }

    const virtualPath = tokens[1 + leading];
    if (!virtualPath) {
      unrecognized.push({ line: i + 1, text: line });
      continue;
    }

    // ⚠️ The physical path can contain spaces — `voices/default controller/default_Aditi.voc` is
    // real. Tokenizing and re-joining would be lossy, so take the rest of the line verbatim.
    const after = line.indexOf(virtualPath) + virtualPath.length;
    const relativePath = line.slice(after).trim();
    if (relativePath === '') {
      unrecognized.push({ line: i + 1, text: line });
      continue;
    }

    const entry: {
      directive: string;
      virtualPath: string;
      relativePath: string;
      visibility: LibraryVisibility;
      region?: string;
      ratio?: number;
      seasons?: string[];
    } = { directive, virtualPath, relativePath, visibility };

    if (region !== undefined) entry.region = region;
    if (directive === 'EXPORT_RATIO' || directive === 'EXPORT_RATIO_SEASON') {
      entry.ratio = Number(tokens[1]);
    }
    if (directive.endsWith('_SEASON')) {
      const seasonToken = directive === 'EXPORT_RATIO_SEASON' ? tokens[2] : tokens[1];
      if (seasonToken) entry.seasons = seasonToken.split(',');
    }

    exports.push(entry);
  }

  return { version, exports, regionsDefined, unrecognized };
}
