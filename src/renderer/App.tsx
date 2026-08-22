import { useEffect, useMemo, useState } from 'react';
import type { CatalogEntry, CatalogSnapshot, Installation, ScanProgress } from '../shared/api.js';

/**
 * M1a: the shell, and enough of a catalog to prove the data reaches the window.
 *
 * No map yet. What this has to answer is narrower and comes first: does main find the
 * installation, does the scan run behind the sandbox, and are ~3 800 objects usable as a list.
 */
export function App(): React.JSX.Element {
  const [version, setVersion] = useState('');
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [candidates, setCandidates] = useState<Installation[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.xop.onScanProgress(setProgress), []);

  useEffect(() => {
    void (async () => {
      setVersion(await window.xop.getVersion());
      const current = await window.xop.currentInstallation();
      if (current?.usable) {
        setInstallation(current);
        setCatalog(await window.xop.getCatalog());
      } else {
        setCandidates(await window.xop.listInstallations());
      }
    })();
  }, []);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const choose = (path: string): Promise<void> =>
    run(async () => {
      setInstallation(await window.xop.selectInstallation(path));
      setCatalog(await window.xop.getCatalog());
    });

  const browse = (): Promise<void> =>
    run(async () => {
      const chosen = await window.xop.browseForInstallation();
      if (!chosen) return;
      setInstallation(chosen);
      setCatalog(await window.xop.getCatalog());
    });

  const rescan = (): Promise<void> =>
    run(async () => {
      setProgress({ phase: 'libraries', done: 0, total: 0 });
      setCatalog(await window.xop.rescanCatalog());
      setProgress(null);
    });

  return (
    <div className="app">
      <header>
        <strong>XOP</strong>
        <span className="version">{version}</span>
        {installation && (
          <span className="installation" title={installation.path}>
            {installation.path}
            {installation.version && <em> · X-Plane {installation.version}</em>}
          </span>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {!installation && candidates && (
        <InstallationPicker candidates={candidates} onChoose={choose} onBrowse={browse} />
      )}

      {installation && (
        <Catalog catalog={catalog} progress={progress} onRescan={rescan} />
      )}
    </div>
  );
}

function InstallationPicker({
  candidates,
  onChoose,
  onBrowse,
}: {
  candidates: readonly Installation[];
  onChoose: (path: string) => void;
  onBrowse: () => void;
}): React.JSX.Element {
  return (
    <main className="picker">
      <h1>Which X-Plane 12?</h1>
      {candidates.length === 0 ? (
        <p>X-Plane has not recorded any installation on this machine.</p>
      ) : (
        <p>These are the installations X-Plane itself has a record of.</p>
      )}
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.path} className={candidate.usable ? '' : 'unusable'}>
            <button disabled={!candidate.usable} onClick={() => onChoose(candidate.path)}>
              <span className="path">{candidate.path}</span>
              <span className="note">
                {candidate.usable
                  ? candidate.version
                    ? `X-Plane ${candidate.version}`
                    : 'never run yet'
                  : candidate.problem}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="browse" onClick={onBrowse}>
        Choose a folder…
      </button>
    </main>
  );
}

function Catalog({
  catalog,
  progress,
  onRescan,
}: {
  catalog: CatalogSnapshot | null;
  progress: ScanProgress | null;
  onRescan: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [maxSize, setMaxSize] = useState(0); // 0 means no limit

  const matches = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    const limit = maxSize || Infinity;
    return catalog.entries.filter((entry) => {
      const side = entry.size ? Math.max(entry.size.width, entry.size.depth) : 0;
      if (side > limit) return false;
      if (!needle) return true;
      return entry.virtualPath.toLowerCase().includes(needle);
    });
  }, [catalog, query, maxSize]);

  if (progress) {
    return (
      <main className="scanning">
        <h1>Reading the libraries…</h1>
        <p>
          {progress.phase === 'measuring'
            ? `measuring ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} objects`
            : 'finding library files'}
        </p>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="picker">
        <h1>No catalog yet</h1>
        <p>XOP has not read this installation&rsquo;s libraries. It takes about fifteen seconds.</p>
        <button className="browse" onClick={onRescan}>
          Scan the libraries
        </button>
      </main>
    );
  }

  return (
    <main className="catalog">
      <div className="toolbar">
        <input
          type="search"
          // The count comes from the catalog, never from a number typed into this string. Every
          // installation has a different one, and a placeholder that quietly lies about the size of
          // the thing it is searching is worse than one that says nothing.
          placeholder={`Search ${catalog.entries.length.toLocaleString()} objects — try hangar, tower, truck…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label>
          max size
          <select value={maxSize} onChange={(event) => setMaxSize(Number(event.target.value))}>
            <option value={0}>any</option>
            <option value={10}>10 m</option>
            <option value={25}>25 m</option>
            <option value={60}>60 m</option>
            <option value={150}>150 m</option>
          </select>
        </label>
        <span className="count">
          {matches.length.toLocaleString()} of {catalog.entries.length.toLocaleString()}
        </span>
        <button onClick={onRescan}>Rescan</button>
      </div>

      {/* Header and rows share one scroll container so a scrollbar cannot knock the columns out of
          alignment, and the header sticks rather than scrolling away just when it is needed. */}
      <div className="listing">
        <div className="columns">
          <span>Object</span>
          <span>Category</span>
          <span>Footprint &amp; height</span>
          <span>Notes</span>
        </div>
        <ul className="entries">
          {matches.slice(0, 400).map((entry) => (
            <Entry key={entry.virtualPath} entry={entry} />
          ))}
        </ul>
      </div>
      {matches.length > 400 && (
        <p className="truncated">
          showing the first 400 of {matches.length.toLocaleString()} — narrow the search
        </p>
      )}

      <footer>
        {catalog.stats.libraries} libraries · {catalog.stats.totalExports.toLocaleString()} exports ·{' '}
        {catalog.stats.objectExports.toLocaleString()} objects ·{' '}
        {catalog.stats.offered.toLocaleString()} offered ·{' '}
        {catalog.stats.measured.toLocaleString()} measured
      </footer>
    </main>
  );
}

function Entry({ entry }: { entry: CatalogEntry }): React.JSX.Element {
  return (
    <li className={entry.unavailable ? 'unavailable' : ''} title={entry.unavailable ?? ''}>
      <span className="name">{entry.name}</span>
      <span className="category">{entry.category.join(' / ')}</span>
      <span className="size">
        {entry.size
          ? `${entry.size.width.toFixed(1)} × ${entry.size.depth.toFixed(1)} m` +
            (entry.size.height > 0 ? `, ${entry.size.height.toFixed(1)} tall` : '')
          : '—'}
      </span>
      <span className="flags">
        {entry.unavailable && <em className="missing">not installed</em>}
        {entry.variantCount > 1 && <em>{entry.variantCount} variants</em>}
        {entry.animated && <em>animated</em>}
        {entry.grounded && <em>ground marking</em>}
      </span>
    </li>
  );
}
