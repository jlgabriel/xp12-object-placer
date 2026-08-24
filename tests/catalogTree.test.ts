import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  buildCatalogTree,
  categoryLabel,
  hasCategoryPath,
  matchesCategory,
  UNCATEGORISED,
} from '../src/renderer/catalog/catalogTree.js';
import type { CatalogEntry } from '../src/shared/api.js';

/** Shaped like a scan: the category is the virtual path minus the `lib/` root and the filename. */
function entry(virtualPath: string): CatalogEntry {
  const segments = virtualPath.replace(/\.obj$/, '').split('/');
  const name = segments.pop() ?? virtualPath;
  const category = segments[0] === 'lib' ? segments.slice(1) : segments;
  return { virtualPath, name, category, variantCount: 1, animated: false, grounded: false };
}

const CATALOG: readonly CatalogEntry[] = [
  entry('lib/airport/hangars/arched/16x16/rusted_1.obj'),
  entry('lib/airport/hangars/arched/16x16/gray_1.obj'),
  entry('lib/airport/hangars/modern/40x40/white.obj'),
  entry('lib/airport/aircraft/general/Cessna_172.obj'),
  entry('lib/g10/US/houses/two_storey.obj'),
  entry('lib/lights/beacon.obj'),
];

describe('buildCatalogTree', () => {
  it('counts every object at the root', () => {
    expect(buildCatalogTree(CATALOG).total).toBe(6);
  });

  it('rolls counts up, so a branch says how much is behind it before it is opened', () => {
    const tree = buildCatalogTree(CATALOG);
    const airport = tree.nodes.find((n) => n.label === 'airport');
    expect(airport?.count).toBe(4);
    expect(airport?.children.find((n) => n.label === 'hangars')?.count).toBe(3);
    expect(airport?.children.find((n) => n.label === 'aircraft')?.count).toBe(1);
  });

  it('goes as deep as the paths do — four levels under airport, one under lights', () => {
    const tree = buildCatalogTree(CATALOG);
    const arched = tree.nodes
      .find((n) => n.label === 'airport')
      ?.children.find((n) => n.label === 'hangars')
      ?.children.find((n) => n.label === 'arched');
    expect(arched?.children.map((n) => n.path)).toEqual(['airport/hangars/arched/16x16']);
    expect(tree.nodes.find((n) => n.label === 'lights')?.children).toEqual([]);
  });

  it('builds a full path on every node, which is what a click filters by', () => {
    const tree = buildCatalogTree(CATALOG);
    const paths: string[] = [];
    const walk = (nodes: readonly { path: string; children: readonly unknown[] }[]): void => {
      for (const node of nodes) {
        paths.push(node.path);
        walk(node.children as readonly { path: string; children: readonly unknown[] }[]);
      }
    };
    walk(tree.nodes);
    expect(paths).toContain('airport/hangars/arched/16x16');
    expect(paths).toContain('g10/US/houses');
  });

  it('sorts by label at every level, so the tree does not reshuffle as counts change', () => {
    const tree = buildCatalogTree(CATALOG);
    expect(tree.nodes.map((n) => n.label)).toEqual(['airport', 'g10', 'lights']);
    expect(
      tree.nodes.find((n) => n.label === 'airport')?.children.map((n) => n.label),
    ).toEqual(['aircraft', 'hangars']);
  });

  it('gives an uncategorised object a home rather than dropping it', () => {
    const orphan: CatalogEntry = { ...entry('lib/loose.obj'), category: [] };
    const tree = buildCatalogTree([...CATALOG, orphan]);
    expect(tree.total).toBe(7);
    expect(tree.nodes.find((n) => n.label === UNCATEGORISED)?.count).toBe(1);
  });

  it('has no nodes and no total for an empty catalog', () => {
    expect(buildCatalogTree([])).toEqual({ total: 0, nodes: [] });
  });

  it('counts only what the list would show, so a branch cannot promise rows it has not got', () => {
    const tree = buildCatalogTree(CATALOG, (e) => e.name.includes('rusted'));
    expect(tree.total).toBe(1);
    const airport = tree.nodes.find((n) => n.label === 'airport');
    expect(airport?.count).toBe(1);
    expect(airport?.children.find((n) => n.label === 'aircraft')?.count).toBe(0);
  });

  it('keeps every branch even when the filters empty it, so the tree never reshuffles', () => {
    // The shape comes from the whole catalog; only the numbers move. A tree that dropped its empty
    // branches would rearrange itself under the cursor on every keystroke.
    const all = buildCatalogTree(CATALOG);
    const none = buildCatalogTree(CATALOG, () => false);
    expect(none.total).toBe(0);
    expect(none.nodes.map((n) => n.path)).toEqual(all.nodes.map((n) => n.path));
    expect(none.nodes.every((n) => n.count === 0)).toBe(true);
  });
});

describe('matchesCategory', () => {
  const hangar = entry('lib/airport/hangars/arched/16x16/rusted_1.obj');

  it('matches at the node and everywhere under it', () => {
    expect(matchesCategory(hangar, 'airport')).toBe(true);
    expect(matchesCategory(hangar, 'airport/hangars')).toBe(true);
    expect(matchesCategory(hangar, 'airport/hangars/arched/16x16')).toBe(true);
  });

  it('does not match a sibling', () => {
    expect(matchesCategory(hangar, 'airport/aircraft')).toBe(false);
    expect(matchesCategory(hangar, 'g10')).toBe(false);
  });

  it('matches whole segments, never a string prefix', () => {
    // The bug this exists to prevent: `startsWith` on the joined path would let `airport` drag in
    // `airportsomething`, which reads as a correct list with strangers scattered through it.
    const other = entry('lib/airportsomething/shed.obj');
    expect(matchesCategory(other, 'airport')).toBe(false);
    expect(matchesCategory(hangar, 'airport/hang')).toBe(false);
  });

  it('does not match a path deeper than the object itself', () => {
    expect(matchesCategory(entry('lib/lights/beacon.obj'), 'lights/apron')).toBe(false);
  });

  it('finds an uncategorised object under its stand-in node', () => {
    const orphan: CatalogEntry = { ...entry('lib/loose.obj'), category: [] };
    expect(matchesCategory(orphan, UNCATEGORISED)).toBe(true);
    expect(matchesCategory(orphan, 'airport')).toBe(false);
  });
});

describe('hasCategoryPath', () => {
  const tree = buildCatalogTree(CATALOG);

  it('recognises a live node at any depth', () => {
    expect(hasCategoryPath(tree, 'airport')).toBe(true);
    expect(hasCategoryPath(tree, 'airport/hangars/arched/16x16')).toBe(true);
  });

  it('rejects a branch this catalog does not have', () => {
    // A rescan, or another installation, and yesterday's selection points at nothing. Without this
    // the panel filters everything out and reads empty for every search, with no way back.
    expect(hasCategoryPath(tree, 'XCDL')).toBe(false);
    expect(hasCategoryPath(tree, 'airport/hangars/gone')).toBe(false);
  });
});

describe('ancestorsOf', () => {
  it('lists the branches that have to be open for a path to be visible', () => {
    expect(ancestorsOf('airport/hangars/arched/16x16')).toEqual([
      'airport',
      'airport/hangars',
      'airport/hangars/arched',
    ]);
  });

  it('has none for a root', () => {
    expect(ancestorsOf('airport')).toEqual([]);
  });
});

describe('categoryLabel', () => {
  it('opens up underscores', () => {
    expect(categoryLabel('Common_Elements')).toBe('Common Elements');
    expect(categoryLabel('Ramp_Equipment')).toBe('Ramp Equipment');
  });

  it('leaves the library authors’ own words alone', () => {
    // `g10` and `XCDL` are what WED and the forums call these. Prettifying them would make XOP's
    // vocabulary disagree with the simulator's.
    expect(categoryLabel('g10')).toBe('g10');
    expect(categoryLabel('XCDL')).toBe('XCDL');
  });
});
