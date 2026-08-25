/**
 * Turn parsed library files into a catalog of placeable objects.
 *
 * Pure: takes what the libraries declared, returns the catalog. No filesystem, no geometry — the
 * scanner adds sizes afterwards by parsing the objects it finds.
 */

import type { LibraryExport, LibraryVisibility, ParsedLibrary } from './library.js';

export interface CatalogVariant {
  /** Name of the scenery package that declared it — the folder under Custom Scenery or default. */
  readonly packageName: string;
  /**
   * Absolute path of that package, as the scanner found it. This is what `relativePath` resolves
   * against.
   *
   * ⚠️ The name cannot stand in for it. Two package roots can each hold a folder called
   * `Object Library`, and resolving by name would quietly read one package's files for the other's
   * exports — no error, the wrong object, and nothing on screen to say so.
   */
  readonly packagePath: string;
  /** Physical path relative to that package root, verbatim. */
  readonly relativePath: string;
  readonly directive: string;
  readonly ratio?: number;
  readonly seasons?: readonly string[];
}

export interface CatalogObject {
  /** The virtual path, verbatim and case-sensitive. This is the identity — never the filename. */
  readonly virtualPath: string;
  /** Filename without its extension, e.g. `rusted_1`. */
  readonly name: string;
  /** Path segments between `lib/` and the filename, e.g. `[airport, hangars, arched, 16x16]`. */
  readonly category: readonly string[];
  readonly visibility: LibraryVisibility;
  /** One entry per physical implementation. More than one means X-Plane picks among them. */
  readonly variants: readonly CatalogVariant[];
  /** Regions the object is restricted to, if any were in force. */
  readonly regions: readonly string[];
}

export interface CatalogPackage {
  readonly name: string;
  /** Absolute path of the package root, as the scanner found it. */
  readonly path: string;
  readonly exportCount: number;
  readonly unrecognizedLines: number;
}

export interface Catalog {
  readonly objects: readonly CatalogObject[];
  readonly packages: readonly CatalogPackage[];
  readonly stats: {
    /** Every export seen, of every asset type. */
    readonly totalExports: number;
    /** Exports whose virtual path ends in `.obj`. */
    readonly objectExports: number;
    /** Distinct `.obj` virtual paths, which is what `objects` holds. */
    readonly distinctObjects: number;
    /** Virtual paths with more than one implementation. */
    readonly withVariants: number;
    /** Counts by virtual-path extension, so what was skipped is visible rather than implied. */
    readonly byExtension: Readonly<Record<string, number>>;
    readonly unrecognizedLines: number;
  };
}

export interface LibrarySource {
  readonly packageName: string;
  readonly packagePath: string;
  readonly parsed: ParsedLibrary;
}

/** private beats deprecated beats semi-deprecated beats public. Most restrictive wins. */
const RESTRICTION: Readonly<Record<LibraryVisibility, number>> = {
  public: 0,
  'semi-deprecated': 1,
  deprecated: 2,
  private: 3,
};

function extensionOf(virtualPath: string): string {
  const dot = virtualPath.lastIndexOf('.');
  return dot === -1 ? '' : virtualPath.slice(dot).toLowerCase();
}

/**
 * `lib/airport/hangars/arched/16x16/rusted_1.obj`
 *   -> name `rusted_1`, category `[airport, hangars, arched, 16x16]`
 *
 * The tree comes free with the path. PCT had to hand-write a category table for 911 objects; here
 * ten thousand arrive already sorted by whoever authored the library.
 */
function splitVirtualPath(virtualPath: string): { name: string; category: string[] } {
  const segments = virtualPath.split('/').filter((s) => s !== '');
  const file = segments.pop() ?? virtualPath;
  const dot = file.lastIndexOf('.');
  const name = dot === -1 ? file : file.slice(0, dot);
  // Drop the conventional `lib` root. Anything else stays: some libraries use their own prefix.
  const category = segments[0] === 'lib' ? segments.slice(1) : segments;
  return { name, category };
}

export function buildCatalog(sources: readonly LibrarySource[]): Catalog {
  const byPath = new Map<
    string,
    { visibility: LibraryVisibility; variants: CatalogVariant[]; regions: Set<string> }
  >();
  const byExtension: Record<string, number> = {};
  const packages: CatalogPackage[] = [];

  let totalExports = 0;
  let objectExports = 0;
  let unrecognizedLines = 0;

  for (const source of sources) {
    packages.push({
      name: source.packageName,
      path: source.packagePath,
      exportCount: source.parsed.exports.length,
      unrecognizedLines: source.parsed.unrecognized.length,
    });
    unrecognizedLines += source.parsed.unrecognized.length;

    for (const entry of source.parsed.exports) {
      totalExports++;
      const extension = extensionOf(entry.virtualPath);
      byExtension[extension] = (byExtension[extension] ?? 0) + 1;
      if (extension !== '.obj') continue;
      objectExports++;
      addVariant(byPath, entry, source);
    }
  }

  const objects: CatalogObject[] = [...byPath.entries()]
    .map(([virtualPath, acc]) => {
      const { name, category } = splitVirtualPath(virtualPath);
      return {
        virtualPath,
        name,
        category,
        visibility: acc.visibility,
        variants: acc.variants,
        regions: [...acc.regions],
      };
    })
    .sort((a, b) => (a.virtualPath < b.virtualPath ? -1 : a.virtualPath > b.virtualPath ? 1 : 0));

  return {
    objects,
    packages,
    stats: {
      totalExports,
      objectExports,
      distinctObjects: objects.length,
      withVariants: objects.filter((o) => o.variants.length > 1).length,
      byExtension,
      unrecognizedLines,
    },
  };
}

function addVariant(
  byPath: Map<string, { visibility: LibraryVisibility; variants: CatalogVariant[]; regions: Set<string> }>,
  entry: LibraryExport,
  source: LibrarySource,
): void {
  let acc = byPath.get(entry.virtualPath);
  if (!acc) {
    acc = { visibility: entry.visibility, variants: [], regions: new Set() };
    byPath.set(entry.virtualPath, acc);
  }

  if (RESTRICTION[entry.visibility] > RESTRICTION[acc.visibility]) {
    acc.visibility = entry.visibility;
  }
  if (entry.region) acc.regions.add(entry.region);

  const variant: {
    packageName: string;
    packagePath: string;
    relativePath: string;
    directive: string;
    ratio?: number;
    seasons?: readonly string[];
  } = {
    packageName: source.packageName,
    packagePath: source.packagePath,
    relativePath: entry.relativePath,
    directive: entry.directive,
  };
  if (entry.ratio !== undefined) variant.ratio = entry.ratio;
  if (entry.seasons !== undefined) variant.seasons = entry.seasons;
  acc.variants.push(variant);
}

/** Objects a user should be offered. Private and deprecated entries are library plumbing. */
export function placeableObjects(catalog: Catalog): readonly CatalogObject[] {
  return catalog.objects.filter(
    (o) => o.visibility === 'public' || o.visibility === 'semi-deprecated',
  );
}
