/**
 * Finding the `apt.dat` files of an installation and reading the airports out of them.
 *
 * The I/O half; the parsing is pure and lives in src/core/airports/aptDat.ts.
 *
 * ## Which files, and in what order
 *
 * X-Plane's own airports are one file — 380 MB of it on a current install — and packs in
 * `Custom Scenery` may carry their own. Both are read, because a pack that adds an airport adds a
 * place the user can work: on the machine this was developed against, `Custom Scenery` contributes
 * the South Pole, 36 flying-boat sealanes and a Dubai heliport, none of which exist in the global
 * file at all.
 *
 * When two files describe the same airport, X-Plane uses the one whose pack sits higher in
 * `scenery_packs.ini`, so that is the order used here and the first description of an airport wins.
 * Without a readable ini there is no order to respect, and the fallback is every pack in
 * `Custom Scenery` first, then the global file — which is where the marker sits in every ini
 * X-Plane writes.
 *
 * ## Why it streams
 *
 * 380 MB is not something to hold in a string. It is read in one-megabyte pieces and fed to the
 * reader a line at a time, which keeps the peak far below the file's own size and — because this
 * runs in the main process — gives the event loop a turn between pieces. The whole pass takes about
 * two and a half seconds on the machine it was measured on, once, and the result is cached.
 */

import { createReadStream } from 'node:fs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { containedJoin } from './containedPath.js';
import { createAptDatReader, type Airport } from '../core/airports/aptDat.js';
import { sceneryEntries } from '../core/install/sceneryPacksIni.js';

/** Where X-Plane 12 keeps its own airports, relative to the installation root. */
const GLOBAL_AIRPORTS_DIR = 'Global Scenery/Global Airports';

/** Where an XP11-era installation kept them instead. Cheap to look in, and free when it is absent. */
const LEGACY_GLOBAL_AIRPORTS_DIR = 'Custom Scenery/Global Airports';

const CUSTOM_SCENERY = 'Custom Scenery';

const APT_DAT = 'Earth nav data/apt.dat';

/** One `apt.dat`, with enough about it to tell whether it has changed since it was last read. */
export interface AptDatFile {
  readonly path: string;
  readonly size: number;
  readonly modifiedMs: number;
}

export interface AirportSource extends AptDatFile {
  /** How many airports this file contributed, after the ones above it had their say. */
  readonly airports: number;
}

export interface AirportScan {
  readonly airports: readonly Airport[];
  readonly sources: readonly AirportSource[];
}

function statOf(path: string): { size: number; modifiedMs: number } | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? { size: stat.size, modifiedMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
}

function aptDatIn(packageRoot: string): string | null {
  const path = join(packageRoot, ...APT_DAT.split('/'));
  return statOf(path) === null ? null : path;
}

/**
 * Every `apt.dat` in the installation, highest priority first.
 *
 * Deduplicated by path: an ini can name the same pack twice, and a pack listed in the ini is also
 * sitting in the directory the fallback walks.
 */
export function findAptDatFiles(installationRoot: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  /**
   * Packages the ini says are switched off.
   *
   * Kept because the directory sweep below would otherwise put them straight back: the folder is
   * still there, and "not in the ini" and "in the ini, turned off" look identical from the disk.
   * Turning somebody's deliberate decision back on is the same mistake the installer refuses to
   * make when it finds its own pack disabled.
   */
  const denied = new Set<string>();

  const add = (path: string | null): void => {
    if (path === null) return;
    const key = path.toLowerCase();
    if (seen.has(key) || denied.has(key)) return;
    seen.add(key);
    found.push(path);
  };

  const globalAirportsFiles = (): (string | null)[] => [
    aptDatIn(join(installationRoot, ...GLOBAL_AIRPORTS_DIR.split('/'))),
    aptDatIn(join(installationRoot, ...LEGACY_GLOBAL_AIRPORTS_DIR.split('/'))),
  ];

  const deny = (path: string | null): void => {
    if (path !== null) denied.add(path.toLowerCase());
  };

  let ini: string | null = null;
  try {
    ini = readFileSync(join(installationRoot, CUSTOM_SCENERY, 'scenery_packs.ini'), 'utf8');
  } catch {
    ini = null;
  }

  if (ini !== null) {
    // Two passes: everything the user switched off is collected first, because a pack can be listed
    // as disabled below the point where the sweep would otherwise have picked it up.
    for (const entry of sceneryEntries(ini)) {
      if (entry.enabled) continue;
      if (entry.kind === 'global-airports') {
        for (const file of globalAirportsFiles()) deny(file);
        continue;
      }
      const packageRoot = containedJoin(installationRoot, entry.path);
      if (packageRoot !== null) deny(aptDatIn(packageRoot));
    }

    for (const entry of sceneryEntries(ini)) {
      if (!entry.enabled) continue;
      if (entry.kind === 'global-airports') {
        for (const file of globalAirportsFiles()) add(file);
        continue;
      }
      // The ini is a file other tools and the user write by hand. Its lines are relative to the
      // installation root and have no business leaving it, so the same containment the installer
      // uses applies here — one hostile line costs that entry and nothing else.
      const packageRoot = containedJoin(installationRoot, entry.path);
      if (packageRoot !== null) add(aptDatIn(packageRoot));
    }
  }

  // Packs the ini does not mention — because it is missing, because X-Plane has not run since the
  // folder was dropped in, or because the marker was edited out. Below whatever the ini did say.
  let names: string[] = [];
  try {
    names = readdirSync(join(installationRoot, CUSTOM_SCENERY));
  } catch {
    names = [];
  }
  names.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  for (const name of names) {
    const packageRoot = containedJoin(join(installationRoot, CUSTOM_SCENERY), name);
    if (packageRoot !== null) add(aptDatIn(packageRoot));
  }

  // And the global file, if the ini never named it.
  for (const file of globalAirportsFiles()) add(file);

  return found;
}

/**
 * The files a scan would read, and what state they are in — without reading any of them.
 *
 * This is what makes the cache worth having: it answers "is what I stored still current?" in a
 * directory walk and a handful of stats, instead of in the two and a half seconds the answer itself
 * costs.
 */
export function fingerprintAptDats(installationRoot: string): AptDatFile[] {
  const files: AptDatFile[] = [];
  for (const path of findAptDatFiles(installationRoot)) {
    const stat = statOf(path);
    if (stat !== null) files.push({ path, size: stat.size, modifiedMs: stat.modifiedMs });
  }
  return files;
}

/** Read one `apt.dat`, streaming, without ever holding more than a piece of it. */
async function readAptDat(path: string): Promise<Airport[]> {
  const reader = createAptDatReader();
  const decoder = new StringDecoder('utf8');
  let carry = '';

  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    // Decode through a StringDecoder, not chunk.toString(): a multi-byte character straddling two
    // reads would otherwise come out as two replacement characters, and airport names are full of
    // them.
    const text = carry + decoder.write(chunk as Buffer);
    let start = 0;
    for (;;) {
      const newline = text.indexOf('\n', start);
      if (newline === -1) {
        carry = text.slice(start);
        break;
      }
      // Trim a CR without allocating: apt.dat ships with either ending, and the files in
      // Custom Scenery were written on whatever machine made them.
      const end = newline > start && text.charCodeAt(newline - 1) === 13 ? newline - 1 : newline;
      reader.line(text.slice(start, end));
      start = newline + 1;
    }
  }

  carry += decoder.end();
  if (carry !== '') reader.line(carry.charCodeAt(carry.length - 1) === 13 ? carry.slice(0, -1) : carry);
  return reader.finish();
}

/**
 * Every airport the installation knows about, ready to be searched.
 *
 * First description wins, by the priority order above. A file that cannot be read is skipped rather
 * than fatal: one unreadable pack should cost its own airports and no others.
 */
export async function scanAirports(installationRoot: string): Promise<AirportScan> {
  const airports: Airport[] = [];
  const sources: AirportSource[] = [];
  const claimed = new Set<string>();

  for (const path of findAptDatFiles(installationRoot)) {
    const stat = statOf(path);
    if (stat === null) continue;

    let read: Airport[];
    try {
      read = await readAptDat(path);
    } catch {
      continue;
    }

    /**
     * Both of an airport's codes. Claiming both is what makes a pack's `XEN001Z` and the global
     * file's `ENHO` one airport rather than two rows for one place.
     */
    const codesOf = (airport: Airport): string[] =>
      airport.icao === undefined
        ? [airport.id.toUpperCase()]
        : [airport.id.toUpperCase(), airport.icao.toUpperCase()];

    /**
     * Two passes over the file: decide what survives, and only then claim.
     *
     * The point is that a file never suppresses *itself*. Claiming as it went cost 20 real airports
     * out of the shipped Global Airports file, where one row's identifier is another row's declared
     * ICAO code — `PAKX` is an airport, and `PALJ` also declares `PAKX`. X-Plane keeps both, they
     * are different places with different names, and dropping the second one was our arithmetic
     * rather than anything in the data.
     */
    const fresh = read.filter((airport) => !codesOf(airport).some((code) => claimed.has(code)));
    for (const airport of fresh) for (const code of codesOf(airport)) claimed.add(code);
    airports.push(...fresh);
    const added = fresh.length;

    sources.push({ path, size: stat.size, modifiedMs: stat.modifiedMs, airports: added });
  }

  return { airports, sources };
}
