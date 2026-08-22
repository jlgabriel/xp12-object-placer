/**
 * Resolve catalog entries to files on disk and measure them.
 *
 * The other I/O half. Sizes and footprints come from the objects themselves — this is what X-Plane
 * gives us that Aerofly never could, and it is why XOP needs neither user-measured footprints nor
 * user-supplied photographs (docs/LINEAGE.md).
 */

import { readFileSync } from 'node:fs';
import { containedJoin } from './containedPath.js';
import {
  belowGround,
  groundOf,
  parseObj8,
  sizeOf,
  type Obj8Size,
} from '../core/obj8/parse.js';
import type { CatalogObject } from '../core/catalog/catalog.js';
import type { GroundBox } from '../core/model.js';

export interface ObjectMeasurement {
  readonly virtualPath: string;
  /** Absolute path of the variant that was measured. */
  readonly measuredFile: string;
  readonly size: Obj8Size;
  /**
   * The same geometry as a ground rectangle rather than a size, because the model origin is not
   * reliably in the middle of it. This is what the map draws — see GroundBox.
   */
  readonly ground: GroundBox;
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
  /** The exported path would resolve outside its own package. Never read; see containedPath.ts. */
  | 'escapes-package'
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
 * Measure each object, taking the first variant that can actually be read.
 *
 * Not simply the first variant. Variants of one virtual path are alternative looks for the same
 * thing, so measuring one is enough — but a library can export a file its package does not ship,
 * and stopping at a missing first variant would report an object as unmeasurable while another
 * package holds a perfectly good copy of it.
 *
 * When every variant fails, that matters more than a blank size: X-Plane resolves a virtual path it
 * cannot find by drawing **nothing at all**, with no error anywhere. Offering such an object would
 * let somebody place it, export, fly out to look, and find bare grass.
 */
export function measureObjects(
  objects: readonly CatalogObject[],
  packagePathsByName: ReadonlyMap<string, string>,
  onProgress?: (done: number, total: number) => void,
): MeasureResult {
  const measurements: ObjectMeasurement[] = [];
  const failures: MeasureFailure[] = [];

  objects.forEach((object, index) => {
    const measurement = measureOne(object, packagePathsByName, failures);
    if (measurement) measurements.push(measurement);
    if (onProgress && index % 250 === 0) onProgress(index, objects.length);
  });

  return { measurements, failures };
}

function measureOne(
  object: CatalogObject,
  packagePathsByName: ReadonlyMap<string, string>,
  failures: MeasureFailure[],
): ObjectMeasurement | null {
  const attempts: MeasureFailure[] = [];

  for (const variant of object.variants) {
    const packagePath = packagePathsByName.get(variant.packageName);
    if (!packagePath) {
      attempts.push({
        virtualPath: object.virtualPath,
        file: variant.relativePath,
        reason: 'unknown-package',
        message: `unknown package ${variant.packageName}`,
      });
      continue;
    }

    const file = containedJoin(packagePath, variant.relativePath);
    if (file === null) {
      attempts.push({
        virtualPath: object.virtualPath,
        file: variant.relativePath,
        reason: 'escapes-package',
        message: 'the exported path points outside its own package',
      });
      continue;
    }

    try {
      const geometry = parseObj8(readFileSync(file, 'latin1'));

      // Some library objects are pure ground decal — a drain, a stain, a painted marking. They have
      // no solid geometry at all, and they are still perfectly placeable. Their footprint is the
      // draped extent, so measure that rather than throwing them out of the catalog.
      const bounds = geometry.bounds ?? geometry.drapedBounds;
      if (!bounds) {
        attempts.push({
          virtualPath: object.virtualPath,
          file,
          reason: 'no-geometry',
          message: 'no geometry of any kind',
        });
        continue;
      }

      const measurement: {
        virtualPath: string;
        measuredFile: string;
        size: Obj8Size;
        ground: GroundBox;
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
        ground: groundOf(bounds),
        belowGround: belowGround(bounds),
        vertexCount: geometry.vertexCount,
        triangleCount: geometry.triangleCount,
        hasAnimation: geometry.hasAnimation,
        lodCount: geometry.lods.length,
        textures: geometry.textures,
      };
      if (geometry.drapedBounds) measurement.drapedSize = sizeOf(geometry.drapedBounds);

      return measurement;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
      attempts.push({
        virtualPath: object.virtualPath,
        file,
        reason: missing ? 'missing-file' : 'parse-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Every variant failed. Report the first reason — they are almost always the same, and a list of
  // five identical "file not found" lines helps nobody.
  if (attempts[0]) failures.push(attempts[0]);
  return null;
}
