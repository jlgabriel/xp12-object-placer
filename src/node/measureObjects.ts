/**
 * Resolve catalog entries to files on disk and measure them.
 *
 * The other I/O half. Sizes and footprints come from the objects themselves — this is what X-Plane
 * gives us that Aerofly never could, and it is why XOP needs neither user-measured footprints nor
 * user-supplied photographs (docs/LINEAGE.md).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  belowGround,
  parseObj8,
  sizeOf,
  type Obj8Size,
} from '../core/obj8/parse.js';
import type { CatalogObject } from '../core/catalog/catalog.js';

export interface ObjectMeasurement {
  readonly virtualPath: string;
  /** Absolute path of the variant that was measured. */
  readonly measuredFile: string;
  readonly size: Obj8Size;
  /** Metres of geometry below the insertion plane — foundations, usually. */
  readonly belowGround: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly hasAnimation: boolean;
  readonly lodCount: number;
  /** Draped ground decal extent, when the object has one. Often much wider than the building. */
  readonly drapedSize?: Obj8Size;
  readonly textures: {
    readonly albedo?: string;
    readonly lit?: string;
    readonly normal?: string;
    readonly draped?: string;
  };
}

export type MeasureFailureReason =
  /** The library exports a path, and the file is not in the package. Common in third-party packs. */
  | 'missing-file'
  /** Read or parsed, but there is no geometry of any kind to measure. */
  | 'no-geometry'
  /** The file exists but is not readable as OBJ8. */
  | 'parse-error'
  /** The variant names a package the scan did not see. */
  | 'unknown-package';

export interface MeasureFailure {
  readonly virtualPath: string;
  readonly file: string;
  readonly reason: MeasureFailureReason;
  readonly message: string;
}

export interface MeasureResult {
  readonly measurements: readonly ObjectMeasurement[];
  readonly failures: readonly MeasureFailure[];
}

/**
 * Measure the first variant of each object.
 *
 * Only the first: variants of one virtual path are alternative looks for the same thing, so their
 * footprints agree closely enough for a catalog. Measuring all of them would multiply the work for
 * a difference nobody would see on a map.
 */
export function measureObjects(
  objects: readonly CatalogObject[],
  packagePathsByName: ReadonlyMap<string, string>,
  onProgress?: (done: number, total: number) => void,
): MeasureResult {
  const measurements: ObjectMeasurement[] = [];
  const failures: MeasureFailure[] = [];

  objects.forEach((object, index) => {
    const variant = object.variants[0];
    if (!variant) return;

    const packagePath = packagePathsByName.get(variant.packageName);
    if (!packagePath) {
      failures.push({
        virtualPath: object.virtualPath,
        file: variant.relativePath,
        reason: 'unknown-package',
        message: `unknown package ${variant.packageName}`,
      });
      return;
    }

    const file = join(packagePath, variant.relativePath);
    try {
      const geometry = parseObj8(readFileSync(file, 'latin1'));

      // Some library objects are pure ground decal — a drain, a stain, a painted marking. They have
      // no solid geometry at all, and they are still perfectly placeable. Their footprint is the
      // draped extent, so measure that rather than throwing them out of the catalog.
      const bounds = geometry.bounds ?? geometry.drapedBounds;
      if (!bounds) {
        failures.push({
          virtualPath: object.virtualPath,
          file,
          reason: 'no-geometry',
          message: 'no geometry of any kind',
        });
        return;
      }

      const measurement: {
        virtualPath: string;
        measuredFile: string;
        size: Obj8Size;
        belowGround: number;
        vertexCount: number;
        triangleCount: number;
        hasAnimation: boolean;
        lodCount: number;
        drapedSize?: Obj8Size;
        textures: ObjectMeasurement['textures'];
      } = {
        virtualPath: object.virtualPath,
        measuredFile: file,
        size: sizeOf(bounds),
        belowGround: belowGround(bounds),
        vertexCount: geometry.vertexCount,
        triangleCount: geometry.triangleCount,
        hasAnimation: geometry.hasAnimation,
        lodCount: geometry.lods.length,
        textures: geometry.textures,
      };
      if (geometry.drapedBounds) measurement.drapedSize = sizeOf(geometry.drapedBounds);

      measurements.push(measurement);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
      failures.push({
        virtualPath: object.virtualPath,
        file,
        reason: missing ? 'missing-file' : 'parse-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (onProgress && index % 250 === 0) onProgress(index, objects.length);
  });

  return { measurements, failures };
}
