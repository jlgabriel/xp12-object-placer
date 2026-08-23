/**
 * The airport list, built once and kept.
 *
 * Reading every `apt.dat` in an installation takes about two and a half seconds, almost all of it
 * the 380 MB file X-Plane ships. That is fine once and unacceptable on every launch, so the result
 * is cached next to the catalog cache and rebuilt when the files behind it change.
 *
 * "Change" is decided by what the files say about themselves — path, size, modification time — and
 * by the set of files being the same set. That covers the cases that actually happen: X-Plane
 * updates its airports, the user installs or removes a scenery pack, the user switches a pack off
 * in `scenery_packs.ini`. It does not cover a pack edited in place to the same byte count in the
 * same millisecond, and nothing short of re-reading 380 MB would.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeFileAtomic } from '../node/fsAtomic.js';
import { fingerprintAptDats, scanAirports, type AptDatFile } from '../node/scanAirports.js';
import type { Airport } from '../core/airports/aptDat.js';

/**
 * Bump when the shape of a cached entry changes.
 *
 * 1: id, optional icao, name, lat, lon.
 */
const CACHE_VERSION = 1;

interface AirportCacheFile {
  readonly version: number;
  readonly installation: string;
  readonly builtAt: string;
  readonly sources: readonly AptDatFile[];
  readonly airports: readonly Airport[];
}

function cacheFile(userData: string, installation: string): string {
  // Same scheme as the catalog cache: the installation path is not safe as a filename, its digest
  // is, and it is stable.
  const digest = createHash('sha256').update(installation).digest('hex').slice(0, 16);
  return join(userData, 'airports', `${digest}.json`);
}

/** Do these two lists describe the same files in the same state? Order counts: it is priority. */
function sameSources(a: readonly AptDatFile[], b: readonly AptDatFile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((source, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      source.path === other.path &&
      source.size === other.size &&
      source.modifiedMs === other.modifiedMs
    );
  });
}

function readCache(userData: string, installation: string): AirportCacheFile | null {
  try {
    const cached = JSON.parse(
      readFileSync(cacheFile(userData, installation), 'utf8'),
    ) as AirportCacheFile;
    if (cached.version !== CACHE_VERSION) return null;
    if (cached.installation !== installation) return null;
    if (!Array.isArray(cached.airports) || !Array.isArray(cached.sources)) return null;
    return cached;
  } catch {
    return null;
  }
}

/**
 * One build at a time per installation.
 *
 * The renderer asks for the airports as the editor mounts, and a reload while the first build is
 * still running would otherwise start a second pass over 380 MB alongside the first.
 */
const inFlight = new Map<string, Promise<readonly Airport[]>>();

export async function loadAirports(
  userData: string,
  installation: string,
): Promise<readonly Airport[]> {
  const running = inFlight.get(installation);
  if (running) return running;

  const build = (async (): Promise<readonly Airport[]> => {
    const cached = readCache(userData, installation);
    // Stat before trusting: a directory walk and a few stats, against the two and a half seconds
    // the answer costs. The alternative is offering airports from a pack uninstalled last week.
    if (cached !== null && sameSources(cached.sources, fingerprintAptDats(installation))) {
      return cached.airports;
    }

    const scan = await scanAirports(installation);
    const file: AirportCacheFile = {
      version: CACHE_VERSION,
      installation,
      builtAt: new Date().toISOString(),
      sources: scan.sources,
      airports: scan.airports,
    };
    mkdirSync(join(userData, 'airports'), { recursive: true });
    writeFileAtomic(cacheFile(userData, installation), JSON.stringify(file));
    return scan.airports;
  })();

  inFlight.set(installation, build);
  void build.catch(() => undefined).finally(() => inFlight.delete(installation));
  return build;
}
