/**
 * The category tree, derived from the virtual paths themselves.
 *
 * `lib/airport/hangars/arched/16x16/rusted_1.obj` already says what it is. Whoever authored the
 * library sorted it, so XOP does not classify anything: it groups by the segments that are already
 * there and counts them. PCT had to hand-write a taxonomy for 911 flat names; that machinery would
 * be answering a question this catalog does not ask — and shipping a curated table of Laminar's
 * object names is exactly the kind of packaged data XOP does not do.
 *
 * ⚠️ Unlike PCT's, this tree is not two levels. A real installation runs one to five segments deep
 * (`lights` alone; `airport/hangars/arched/16x16` four down), so every level here is the same shape
 * and expands the same way. Fourteen roots, 249 nodes in all, on a 3 837-object catalog.
 *
 * Pure: entries in, tree out. No React, so it tests under the node config like the rest of core.
 */

import type { CatalogEntry } from '../../shared/api.js';

export interface CategoryNode {
  /** What a click writes to the filter: the full path from the root, e.g. `airport/hangars`. */
  readonly path: string;
  /** This segment alone, as it will be displayed: `hangars`. */
  readonly label: string;
  /** Objects at or under this node, counted from whatever was passed in. */
  readonly count: number;
  readonly children: readonly CategoryNode[];
}

export interface CatalogTree {
  /** Every object counted — the number beside "All objects". */
  readonly total: number;
  readonly nodes: readonly CategoryNode[];
}

/** Uncategorised objects still need somewhere to be. Nothing is ever dropped from the tree. */
export const UNCATEGORISED = 'uncategorised';

interface Building {
  count: number;
  children: Map<string, Building>;
}

/**
 * Group entries into a tree of their category segments, with a count on every node.
 *
 * A node's count includes everything beneath it, so `airport` reads 1 809 while `airport/hangars`
 * reads 380 — the number tells you how much is behind the arrow before you open it.
 *
 * Sorted by label at every level, and only by label: a stable order means the tree does not
 * reshuffle under the cursor when the counts change as somebody types.
 *
 * @param entries every object in the catalog. The *shape* of the tree comes from all of them and
 *   therefore never changes while the filters do.
 * @param counted which of them the list would show right now. The *counts* follow the filters, so a
 *   branch never promises rows the panel would not produce — a `hangars 380` that yields nothing
 *   under `max size 10 m` is the same quiet lie as a list that truncates without saying so. A
 *   branch that falls to zero stays where it is; the panel dims it rather than removing it, because
 *   a tree that rearranges itself under the cursor as somebody types is unusable.
 */
export function buildCatalogTree(
  entries: readonly CatalogEntry[],
  counted: (entry: CatalogEntry) => boolean = () => true,
): CatalogTree {
  const root: Building = { count: 0, children: new Map() };

  for (const entry of entries) {
    const segments = entry.category.length > 0 ? entry.category : [UNCATEGORISED];
    const hit = counted(entry) ? 1 : 0;
    let node = root;
    root.count += hit;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = { count: 0, children: new Map() };
        node.children.set(segment, child);
      }
      child.count += hit;
      node = child;
    }
  }

  return { total: root.count, nodes: harden(root, '') };
}

function harden(node: Building, prefix: string): CategoryNode[] {
  return [...node.children]
    .map(([label, child]) => {
      const path = prefix === '' ? label : `${prefix}/${label}`;
      return { path, label, count: child.count, children: harden(child, path) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Is this object at or under the selected category?
 *
 * Whole segments only. `airport` must not match a hypothetical `airportsomething`, and a plain
 * `startsWith` on the joined string would — the kind of bug that shows up as a handful of strangers
 * in an otherwise correct list, which is far harder to notice than an empty one.
 */
export function matchesCategory(entry: CatalogEntry, path: string): boolean {
  const wanted = path.split('/');
  const actual = entry.category.length > 0 ? entry.category : [UNCATEGORISED];
  if (wanted.length > actual.length) return false;
  return wanted.every((segment, index) => actual[index] === segment);
}

/**
 * Is `path` still a node in this tree?
 *
 * A selection outlives the catalog it was made against — it is only ever written by a click, and a
 * rescan or a different installation can leave it pointing at a branch that is gone. The gate would
 * then reject every object and the panel would read empty for every search, with no visible cause
 * and no way out but guessing. PCT learned this one; the panel treats a vanished branch as no
 * filter at all.
 */
export function hasCategoryPath(tree: CatalogTree, path: string): boolean {
  const wanted = path.split('/');
  let nodes: readonly CategoryNode[] = tree.nodes;
  for (const segment of wanted) {
    const found = nodes.find((node) => node.label === segment);
    if (!found) return false;
    nodes = found.children;
  }
  return true;
}

/**
 * Every ancestor of `path`, outermost first — `['airport', 'airport/hangars']` for
 * `airport/hangars/arched`. What the panel opens so that a selection made by other means (a search
 * hit, a restored session) is visible rather than hidden inside a collapsed branch.
 */
export function ancestorsOf(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

/**
 * `Common_Elements` → `Common Elements`.
 *
 * Underscores only. The words themselves stay verbatim — `g10`, `XCDL`, `TNCM_Only` are what the
 * library authors called these branches, and they are what a user comparing against WED or a forum
 * post will be looking for. Renaming them to something friendlier would be a curated table by
 * another name, and it would make the app's vocabulary disagree with the simulator's.
 */
export function categoryLabel(label: string): string {
  return label.replace(/_/g, ' ');
}
