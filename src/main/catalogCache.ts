/**
 * Build the renderer's view of the catalog, and cache it.
 *
 * A full scan with geometry takes about fifteen seconds on a real installation. Doing that on every
 * launch would be rude; doing it never would leave the catalog stale after the user installs a
 * library. So: cache keyed by installation path, rescan on demand.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
 */
const SNAPSHOT_VERSION = 2;

function cacheFile(userData: string, installation: string): string {
  // The installation path is not safe as a filename; its digest is, and it is stable.
  const digest = createHash('sha256').update(installation).digest('hex').slice(0, 16);
  return join(userData, 'catalog', `${digest}.json`);
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

  const packagePaths = new Map(catalog.packages.map((p) => [p.name, p.path]));
  const { measurements, failures } = measureObjects(offered, packagePaths, (done, total) =>
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
    if (failure.reason === 'missing-file' || failure.reason === 'unknown-package') {
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

  const target = cacheFile(userData, installation);
  mkdirSync(join(userData, 'catalog'), { recursive: true });
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot), 'utf8');
  renameSync(temporary, target);

  onProgress?.({ phase: 'done', done: entries.length, total: entries.length });
  return snapshot;
}
