import { useEffect, useMemo, useState } from 'react';
import type { CatalogEntry, CatalogSnapshot, Installation, ScanProgress } from '../shared/api.js';
import { MapView } from './map/MapView.js';
import { PROVIDER_LABEL } from './map/tileProviders.js';
import { editorStore, useEditor } from './state/editorStore.js';
import type { TileProviderId } from './state/store.js';
import { dsfTileOf, tilePath } from '../core/dsf/tile.js';
import type { PlacedObject } from '../core/model.js';

/**
 * M1b: the catalog, the map, and one object between them.
 *
 * The shape of the screen follows the job. Pick something on the left, click where it goes, turn it
 * against the imagery until it looks right, and see on the right what will be written. Nothing here
 * asks which airport you are working on, and nothing ever will (docs/DECISIONS.md D2).
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

  // The map reads footprints out of the store, not out of this component's state, so the catalog
  // has to reach it whenever it changes — including after a rescan.
  useEffect(() => {
    editorStore.getState().setCatalog(catalog?.entries ?? []);
  }, [catalog]);

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

      {installation &&
        (progress ? (
          <Scanning progress={progress} />
        ) : catalog ? (
          <Editor catalog={catalog} onRescan={rescan} />
        ) : (
          <NoCatalog onScan={rescan} />
        ))}
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

function Scanning({ progress }: { progress: ScanProgress }): React.JSX.Element {
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

function NoCatalog({ onScan }: { onScan: () => void }): React.JSX.Element {
  return (
    <main className="picker">
      <h1>No catalog yet</h1>
      <p>XOP has not read this installation&rsquo;s libraries. It takes about fifteen seconds.</p>
      <button className="browse" onClick={onScan}>
        Scan the libraries
      </button>
    </main>
  );
}

function Editor({
  catalog,
  onRescan,
}: {
  catalog: CatalogSnapshot;
  onRescan: () => void;
}): React.JSX.Element {
  return (
    <main className="editor">
      <CatalogPanel catalog={catalog} onRescan={onRescan} />
      <Stage />
      <PlacementPanel />
    </main>
  );
}

function CatalogPanel({
  catalog,
  onRescan,
}: {
  catalog: CatalogSnapshot;
  onRescan: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [maxSize, setMaxSize] = useState(0); // 0 means no limit
  const placing = useEditor((state) => state.placing);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const limit = maxSize || Infinity;
    return catalog.entries.filter((entry) => {
      const side = entry.size ? Math.max(entry.size.width, entry.size.depth) : 0;
      if (side > limit) return false;
      if (!needle) return true;
      return entry.virtualPath.toLowerCase().includes(needle);
    });
  }, [catalog, query, maxSize]);

  const arm = (entry: CatalogEntry): void => {
    const store = editorStore.getState();
    store.arm(store.placing === entry.virtualPath ? null : entry.virtualPath);
  };

  return (
    <section className="panel catalog-panel">
      <div className="panel-head">
        <h2>Objects</h2>
        <button onClick={onRescan}>Rescan</button>
      </div>

      <div className="filters">
        <input
          type="search"
          // The count comes from the catalog, never from a number typed into this string. Every
          // installation has a different one, and a placeholder that quietly lies about the size of
          // the thing it is searching is worse than one that says nothing.
          placeholder={`Search ${catalog.entries.length.toLocaleString()} objects…`}
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
      </div>

      <ul className="entries">
        {matches.slice(0, 400).map((entry) => (
          <CatalogRow
            key={entry.virtualPath}
            entry={entry}
            armed={placing === entry.virtualPath}
            onArm={arm}
          />
        ))}
      </ul>

      {matches.length > 400 && (
        <p className="truncated">
          showing the first 400 of {matches.length.toLocaleString()} — narrow the search
        </p>
      )}

      <footer>
        {catalog.stats.libraries} libraries · {catalog.stats.offered.toLocaleString()} offered ·{' '}
        {catalog.stats.measured.toLocaleString()} measured
      </footer>
    </section>
  );
}

function CatalogRow({
  entry,
  armed,
  onArm,
}: {
  entry: CatalogEntry;
  armed: boolean;
  onArm: (entry: CatalogEntry) => void;
}): React.JSX.Element {
  // An object X-Plane would draw as nothing cannot be placed. It is still listed, dimmed, with the
  // reason: somebody looking for it deserves to be told it is missing rather than to wonder.
  const unavailable = entry.unavailable !== undefined;
  return (
    <li className={`${armed ? 'armed' : ''} ${unavailable ? 'unavailable' : ''}`.trim()}>
      <button
        disabled={unavailable}
        title={entry.unavailable ?? entry.virtualPath}
        onClick={() => onArm(entry)}
      >
        <span className="name">{entry.name}</span>
        <span className="category">{entry.category.join(' / ')}</span>
        <span className="facts">
          <span className="size">
            {entry.size
              ? `${entry.size.width.toFixed(1)} × ${entry.size.depth.toFixed(1)} m` +
                (entry.size.height > 0 ? `, ${entry.size.height.toFixed(1)} tall` : '')
              : 'not measured'}
          </span>
          {unavailable && <em className="missing">not installed</em>}
          {entry.variantCount > 1 && <em>{entry.variantCount} variants</em>}
          {entry.animated && <em>animated</em>}
          {entry.grounded && <em>ground marking</em>}
        </span>
      </button>
    </li>
  );
}

function Stage(): React.JSX.Element {
  const placing = useEditor((state) => state.placing);
  const tiles = useEditor((state) => state.tiles);

  return (
    <section className="stage">
      <div className="mapbar">
        <div className="providers">
          {(Object.keys(PROVIDER_LABEL) as TileProviderId[]).map((provider) => (
            <button
              key={provider}
              className={provider === tiles ? 'on' : ''}
              onClick={() => editorStore.getState().setTiles(provider)}
            >
              {PROVIDER_LABEL[provider]}
            </button>
          ))}
        </div>
        <GoTo />
      </div>

      {placing !== null && (
        <div className="arming">
          Click the map to place <strong>{placing}</strong> — it stays armed, so click again for
          another. <kbd>Esc</kbd> to stop.
        </div>
      )}

      <MapView />
    </section>
  );
}

/**
 * Jump the map to a coordinate.
 *
 * The only "go to" XOP has, and deliberately so: an ICAO box would mean reading airport data, and
 * the moment the app knows about airports it starts becoming a worse WED (D2). A latitude and a
 * longitude are geography, which is the thing this tool is actually about.
 */
function GoTo(): React.JSX.Element {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    // "-33.39, -70.79" and "-33.39 -70.79" both work; degrees-minutes-seconds does not, and saying
    // so with a red edge beats silently flying somewhere else.
    const parts = text.split(/[,\s]+/).filter((part) => part !== '');
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    const ok =
      parts.length === 2 &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180;
    setBad(!ok);
    if (ok) editorStore.getState().goTo({ lon, lat }, 17);
  };

  return (
    <form className="goto" onSubmit={submit}>
      <input
        className={bad ? 'bad' : ''}
        placeholder="latitude, longitude"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
        }}
      />
      <button type="submit">Go</button>
    </form>
  );
}

function PlacementPanel(): React.JSX.Element {
  const objects = useEditor((state) => state.objects);
  const selection = useEditor((state) => state.selection);
  const selected = objects.find((object) => object.id === selection) ?? null;

  return (
    <section className="panel placement-panel">
      <div className="panel-head">
        <h2>Placed</h2>
        <span className="count">{objects.length.toLocaleString()}</span>
      </div>

      {objects.length === 0 ? (
        <p className="empty">Nothing placed yet. Pick an object on the left, then click the map.</p>
      ) : (
        <ul className="placed">
          {objects.map((object) => (
            <li key={object.id} className={object.id === selection ? 'on' : ''}>
              <button
                // The row shows a short label; the title carries the identity, which is the string
                // that actually goes into the DSF.
                title={object.libraryPath}
                onClick={() => {
                  const store = editorStore.getState();
                  store.select(object.id);
                  store.goTo(object.position);
                }}
              >
                <span className="name">{object.label ?? object.libraryPath}</span>
                <span className="where">
                  {object.position.lat.toFixed(5)}, {object.position.lon.toFixed(5)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && <Inspector object={selected} />}
    </section>
  );
}

function Inspector({ object }: { object: PlacedObject }): React.JSX.Element {
  const tile = dsfTileOf(object.position);
  return (
    <div className="inspector">
      <h3>{object.label ?? object.libraryPath}</h3>
      <dl>
        <dt>library path</dt>
        <dd className="mono wrap">{object.libraryPath}</dd>
        <dt>longitude, latitude</dt>
        <dd className="mono">
          {object.position.lon.toFixed(7)}, {object.position.lat.toFixed(7)}
        </dd>
        <dt>rotation</dt>
        <dd className="mono">{object.rotation.toFixed(1)}&deg;</dd>
        <dt>goes in</dt>
        <dd className="mono wrap">{tilePath(tile)}</dd>
      </dl>
      {/* The one thing about this format that catches everybody, said where it is being used. */}
      <p className="note">
        Rotation 0 is how the artist modelled the object, not north — the stock fuel truck faces
        south at 0. Turn it by eye against the imagery with the cyan grip.
      </p>
      <button className="danger" onClick={() => editorStore.getState().deleteObject(object.id)}>
        Remove
      </button>
    </div>
  );
}
