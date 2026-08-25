/**
 * Build the renderer's view of the catalog, and cache it.
 *
 * A full scan with geometry takes about fifteen seconds on a real installation. Doing that on every
 * launch would be rude; doing it never would leave the catalog stale after the user installs a
 * library. So: cache keyed by installation path, rescan on demand.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from '../node/fsAtomic.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { buildCatalog, placeableObjects } from '../core/catalog/catalog.js';
import { scanLibraries } from '../node/scanLibraries.js';
import { measureObjects } from '../node/measureObjects.js';
import type { CatalogEntry, CatalogSnapshot, ScanProgress } from '../shared/api.js';
import type { GroundBox } from '../core/model.js';

/**
 * Bump when a snapshot field the renderer relies on is added or changes meaning.
 *
 * 2: entries carry `ground`, the object's footprint rectangle. Version 1 snapshots had only a size,
 *    which cannot be turned into a footprint after the fact — the origin's place inside the box is
 *    not recoverable from width and depth.
 * 3: a companion file records where each object's .obj lives, which is what thumbnails need. A
 *    version 2 cache has no such file, and rebuilding one from the snapshot is not possible.
 */
const SNAPSHOT_VERSION = 3;

function cacheFile(userData: string, installation: string): string {
  // The installation path is not safe as a filename; its digest is, and it is stable.
  const digest = createHash('sha256').update(installation).digest('hex').slice(0, 16);
  return join(userData, 'catalog', `${digest}.json`);
}

/**
 * Where each object's file is, kept beside the snapshot rather than inside it.
 *
 * Thumbnails need to open the `.obj`, and only main may do that. Putting these paths in the
 * snapshot would send four hundred kilobytes of the user's own directory layout across the bridge
 * on every launch, to a renderer that has no use for it and could not open a file anyway.
 */
function fileMapPath(userData: string, installation: string): string {
  return cacheFile(userData, installation).replace(/.json$/, '.files.json');
}

/** virtual path → the .obj on disk, for the installation currently cached. Null if not scanned. */
export function readCachedObjectFiles(
  userData: string,
  installation: string,
): ReadonlyMap<string, string> | null {
  try {
    const raw = JSON.parse(readFileSync(fileMapPath(userData, installation), 'utf8')) as {
      installation: string;
      files: Record<string, string>;
    };
    if (raw.installation !== installation) return null;
    return new Map(Object.entries(raw.files));
  } catch {
    return null;
  }
}

export function readCachedCatalog(userData: string, installation: string): CatalogSnapshot | null {
  try {
    const snapshot = JSON.parse(
      readFileSync(cacheFile(userData, installation), 'utf8'),
    ) as CatalogSnapshot;
    // A cache built for a different installation is worse than none: it would offer objects that
    // are not there. One written by an older build is worse than none for the same kind of reason —
    // the renderer would draw whatever it could and quietly leave out what it could not.
    if (snapshot.installation !== installation) return null;
    if (snapshot.version !== SNAPSHOT_VERSION) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function scanCatalog(
  userData: string,
  installation: string,
  onProgress?: (progress: ScanProgress) => void,
): CatalogSnapshot {
  onProgress?.({ phase: 'libraries', done: 0, total: 0 });

  const { sources } = scanLibraries(installation);
  const catalog = buildCatalog(sources);
  const offered = placeableObjects(catalog);

  const { measurements, failures } = measureObjects(offered, (done, total) =>
    onProgress?.({ phase: 'measuring', done, total }),
  );
  const byPath = new Map(measurements.map((m) => [m.virtualPath, m]));

  /**
   * Why an object would draw nothing.
   *
   * A `parse-error` is deliberately absent: that means *we* could not read the file, and X-Plane
   * very likely can. Blaming the object for our own gap would hide good content.
   */
  const unavailableByPath = new Map<string, string>();
  for (const failure of failures) {
    if (failure.reason === 'missing-file') {
      unavailableByPath.set(failure.virtualPath, 'the library exports it, but the file is not there');
    } else if (failure.reason === 'no-geometry') {
      unavailableByPath.set(failure.virtualPath, 'an empty placeholder — it draws nothing');
    }
  }

  const entries: CatalogEntry[] = offered.map((object) => {
    const measured = byPath.get(object.virtualPath);
    const unavailable = unavailableByPath.get(object.virtualPath);
    const entry: {
      virtualPath: string;
      name: string;
      category: readonly string[];
      size?: { width: number; height: number; depth: number };
      ground?: GroundBox;
      variantCount: number;
      animated: boolean;
      grounded: boolean;
      unavailable?: string;
    } = {
      virtualPath: object.virtualPath,
      name: object.name,
      category: object.category,
      variantCount: object.variants.length,
      animated: measured?.hasAnimation ?? false,
      // Height of zero and a draped extent means the object is a marking, not a building.
      grounded: measured !== undefined && measured.size.height === 0,
    };
    if (measured) {
      entry.size = measured.size;
      entry.ground = measured.ground;
    }
    if (unavailable) entry.unavailable = unavailable;
    return entry;
  });

  const snapshot: CatalogSnapshot = {
    version: SNAPSHOT_VERSION,
    installation,
    scannedAt: new Date().toISOString(),
    entries,
    stats: {
      libraries: sources.length,
      totalExports: catalog.stats.totalExports,
      objectExports: catalog.stats.objectExports,
      distinctObjects: catalog.stats.distinctObjects,
      offered: offered.length,
      measured: measurements.length,
      unmeasured: offered.length - measurements.length,
    },
  };

  mkdirSync(join(userData, 'catalog'), { recursive: true });

  // The file map goes first. A snapshot present without its companion is the state that would make
  // every thumbnail fail for a catalog that otherwise looks complete; the other way round, a stray
  // file map, costs nothing and is overwritten by the next scan.
  writeFileAtomic(
    fileMapPath(userData, installation),
    JSON.stringify({
      installation,
      files: Object.fromEntries([...byPath].map(([path, m]) => [path, m.measuredFile])),
    }),
  );
  writeFileAtomic(cacheFile(userData, installation), JSON.stringify(snapshot));

  onProgress?.({ phase: 'done', done: entries.length, total: entries.length });
  return snapshot;
}
