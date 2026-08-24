/**
 * The category navigator above the object list.
 *
 * Until now the panel could only be searched, which means it only worked for somebody who already
 * knew what the thing was called. Three thousand eight hundred objects arrive sorted by the people
 * who built the libraries, and this puts that sorting on the screen so the catalog can be walked
 * instead of guessed at.
 *
 * Every level is the same row, drawn recursively, because X-Plane's paths are not a fixed depth —
 * `lights` stands alone, `airport/hangars/arched/16x16` is four down.
 *
 * Expanding is local view state. It never touches the store or the document: what a user has open
 * in a tree is not part of their project.
 */

import { useState } from 'react';
import { ancestorsOf, categoryLabel, type CatalogTree, type CategoryNode } from './catalogTree.js';

export function CategoryTree({
  tree,
  active,
  onSelect,
}: {
  tree: CatalogTree;
  /** The selected path, or null for "All objects". */
  active: string | null;
  onSelect: (path: string | null) => void;
}): React.JSX.Element {
  // Whatever is selected starts open, so a selection that outlived a rescan is visible rather than
  // buried inside a collapsed branch with the list mysteriously narrowed.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(active === null ? [] : [...ancestorsOf(active), active]),
  );

  const toggle = (path: string): void =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Selecting a branch opens it too. Choosing "hangars" and being shown a closed arrow would make
  // the user click twice to do the one thing they meant.
  const select = (path: string): void => {
    onSelect(path);
    setExpanded((previous) => new Set(previous).add(path));
  };

  return (
    <nav className="cat-tree" aria-label="Categories">
      <button
        type="button"
        className={`cat-node all${active === null ? ' sel' : ''}`}
        aria-pressed={active === null}
        onClick={() => onSelect(null)}
      >
        <span className="cat-label">All objects</span>
        <span className="cat-count">{tree.total.toLocaleString()}</span>
      </button>

      <CategoryLevel
        nodes={tree.nodes}
        depth={0}
        active={active}
        expanded={expanded}
        onToggle={toggle}
        onSelect={select}
      />
    </nav>
  );
}

function CategoryLevel({
  nodes,
  depth,
  active,
  expanded,
  onToggle,
  onSelect,
}: {
  nodes: readonly CategoryNode[];
  depth: number;
  active: string | null;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const open = expanded.has(node.path);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.path} className="cat-group">
            <div className="cat-row" style={{ paddingLeft: `${6 + depth * 13}px` }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="cat-toggle"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
                  onClick={() => onToggle(node.path)}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="cat-toggle empty" aria-hidden="true" />
              )}
              <button
                type="button"
                // A branch with nothing in it under the filters in force is dimmed rather than
                // hidden. Removing it would make the tree jump about while somebody is typing, and
                // "hangars 0" is a real answer to "are there hangars under 10 m".
                className={`cat-node${active === node.path ? ' sel' : ''}${node.count === 0 ? ' empty' : ''}`}
                aria-pressed={active === node.path}
                onClick={() => onSelect(node.path)}
              >
                <span className="cat-label">{categoryLabel(node.label)}</span>
                <span className="cat-count">{node.count.toLocaleString()}</span>
              </button>
            </div>

            {hasChildren && open && (
              <CategoryLevel
                nodes={node.children}
                depth={depth + 1}
                active={active}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
