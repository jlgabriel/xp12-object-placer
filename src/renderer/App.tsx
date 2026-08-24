import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogEntry, CatalogSnapshot, Installation, ScanProgress } from '../shared/api.js';
import { MapView } from './map/MapView.js';
import { PROVIDER_LABEL } from './map/tileProviders.js';
import { editorStore, useEditor } from './state/editorStore.js';
import type { TileProviderId } from './state/store.js';
import { dsfTileOf, tilePath } from '../core/dsf/tile.js';
import { ExportDialog } from './ExportDialog.js';
import { createDocumentCommands } from './documentCommands.js';
import { forgetThumbnails, ObjectThumbnail } from './thumbnails/ObjectThumbnail.js';
import { AirportSearch } from './AirportSearch.js';
import type { PlacedObject } from '../core/model.js';

/**
 * The catalog, the map, and one object between them.
 *
 * The shape of the screen follows the job. Pick something on the left, click where it goes, turn it
 * against the imagery until it looks right, and see on the right what will be written. There is a
 * box for going to an airport, because that is where most people want to stand; there is nothing
 * that asks which airport you are *editing*, and there never will be (docs/DECISIONS.md D2, D15).
 */
export function App(): React.JSX.Element {
  const [version, setVersion] = useState('');
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [candidates, setCandidates] = useState<Installation[] | null>(null);
  // Whether the picker is open on purpose, as opposed to being the first-run screen. The two look
  // the same and mean different things: one of them has a way out.
  const [picking, setPicking] = useState(false);
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Rescan, so anything else read off the installation gets re-read with it. */
  const [rescans, setRescans] = useState(0);

  const dirty = useEditor((state) => state.dirty);
  const documentName = useEditor((state) => state.documentName);

  useEffect(() => window.xop.onScanProgress(setProgress), []);

  const report = useCallback((cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const commands = useMemo(
    () =>
      createDocumentCommands({
        store: editorStore,
        api: window.xop,
        confirm: (message) => window.confirm(message),
      }),
    [],
  );

  // Main keeps the title bar and the close guard honest, and neither of them can see this store.
  useEffect(() => {
    void window.xop.markDirty(dirty).catch(report);
  }, [dirty, documentName, report]);

  // The window is closing and the user chose Save. Closing only happens if the save actually
  // lands: a cancelled file dialog leaves the window open, which is the right answer and needs no
  // further message to arrange.
  useEffect(
    () =>
      window.xop.onSaveBeforeClose(() => {
        void commands
          .save()
          .then((saved) => {
            if (saved) void window.xop.closeWindow();
          })
          .catch(report);
      }),
    [commands, report],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      // A dialog over the map owns the keyboard while it is up — the same rule Delete already
      // follows, and for the same reason.
      if (editorStore.getState().modalOpen) return;

      const key = event.key.toLowerCase();

      // Duplicate acts on the selection rather than the document, but it lives here because this
      // is where Ctrl already means something and where the modal guard already is.
      if (key === 'd') {
        const selection = editorStore.getState().selection;
        if (selection !== null) {
          event.preventDefault();
          editorStore.getState().duplicateObject(selection);
        }
        return;
      }

      const command =
        key === 's'
          ? event.shiftKey
            ? commands.saveAs
            : commands.save
          : key === 'o'
            ? commands.open
            : key === 'n'
              ? commands.newProject
              : null;
      if (!command) return;

      event.preventDefault();
      setError(null);
      void Promise.resolve(command()).catch(report);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands, report]);

  const runCommand = (command: () => Promise<unknown>) => (): void => {
    setError(null);
    void command().catch(report);
  };

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

  /**
   * Fetch the airports for whichever installation is in use.
   *
   * In the background, deliberately: the first read of a 380 MB `apt.dat` takes a couple of seconds
   * and nothing on the screen depends on it. The box says it is still reading, and everything else —
   * the catalog, the map, placing objects — carries on meanwhile.
   *
   * Keyed on the installation because the list *is* the installation: a different X-Plane is a
   * different set of airports, and the release install and the beta will not agree. And on the
   * rescan counter, because "read my installation again" means all of it — a scenery pack installed
   * while the window was open brings airports as well as objects, and main decides for itself
   * whether anything actually changed.
   */
  const installationPath = installation?.usable === true ? installation.path : null;
  useEffect(() => {
    if (installationPath === null) return;
    let live = true;
    editorStore.getState().setAirportsStatus('loading');
    void window.xop.getAirports().then(
      (airports) => {
        if (live) editorStore.getState().setAirports(airports);
      },
      (cause: unknown) => {
        // Not raised to the error bar. Nothing the user asked for has failed — they can still type
        // a coordinate — and an alarm about a feature they have not reached yet is noise. The box
        // says so where the answer would have appeared, and main has already logged the reason.
        if (live) editorStore.getState().setAirportsStatus('failed');
        console.warn('airports could not be read', cause);
      },
    );
    return () => {
      live = false;
    };
  }, [installationPath, rescans]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /**
   * Settle on an installation, from either door.
   *
   * The thumbnails have to go: they are keyed by virtual path, and the whole point of a virtual
   * path is that two installations can answer it with two different objects. Keeping them would
   * show the previous X-Plane's picture beside the new one's name, which is the sort of wrong that
   * looks right.
   */
  const settle = async (chosen: Installation): Promise<void> => {
    setInstallation(chosen);
    forgetThumbnails();
    setCatalog(await window.xop.getCatalog());
    setPicking(false);
  };

  const choose = (path: string): Promise<void> =>
    run(async () => {
      await settle(await window.xop.selectInstallation(path));
    });

  const browse = (): Promise<void> =>
    run(async () => {
      const chosen = await window.xop.browseForInstallation();
      if (!chosen) return;
      await settle(chosen);
    });

  /**
   * Reopen the picker on an installation already in use.
   *
   * v1.0.0 had no way back: the picker was the first-run screen and nothing else, so whoever keeps
   * a release install and a beta side by side — which the X-Plane crowd does as a matter of course,
   * and this machine records four — was married to whichever one they clicked first. The list is
   * re-read rather than reused: an installation can have appeared or been deleted since launch.
   */
  const changeInstallation = (): Promise<void> =>
    run(async () => {
      setCandidates(await window.xop.listInstallations());
      setPicking(true);
    });

  const rescan = (): Promise<void> =>
    run(async () => {
      setProgress({ phase: 'libraries', done: 0, total: 0 });
      setCatalog(await window.xop.rescanCatalog());
      forgetThumbnails();
      setRescans((n) => n + 1);
      setProgress(null);
    });

  return (
    <div className="app">
      <header>
        <strong>XP Object Placer</strong>
        <span className="version">{version}</span>

        <span className="documents">
          <button onClick={runCommand(commands.newProject)} title="New project (Ctrl+N)">
            New
          </button>
          <button onClick={runCommand(commands.open)} title="Open a project (Ctrl+O)">
            Open
          </button>
          <button onClick={runCommand(commands.save)} title="Save (Ctrl+S)">
            Save
          </button>
          <button onClick={runCommand(commands.saveAs)} title="Save as (Ctrl+Shift+S)">
            Save as
          </button>
        </span>

        {/* The bullet is the unsaved mark, and it is the same one in the title bar, so the window
            list and the window itself agree about whether there is work at risk. */}
        <span className="document" title={dirty ? 'Unsaved changes' : 'Saved'}>
          {documentName}
          {dirty && <b aria-label="unsaved changes"> •</b>}
        </span>
        {/* The installation is a control, not a caption. It reads as the path either way, so the
            header looks the same as it always did — but it is now the way out of a wrong one. */}
        {installation && (
          <button
            className="installation"
            title={`${installation.path}\nClick to use a different X-Plane 12 installation`}
            onClick={() => void changeInstallation()}
          >
            {installation.path}
            {installation.version && <em> · X-Plane {installation.version}</em>}
          </button>
        )}
      </header>

      {error && (
        <div className="error">
          <span>{error}</span>
          <button onClick={() => void window.xop.openLog()}>Open log</button>
        </div>
      )}

      {/* One screen at a time. The picker takes the whole body while it is open — laying it over
          the editor, or beside it, would leave two <main> elements arguing about what the window
          is currently for. */}
      {(picking || !installation) && candidates ? (
        <InstallationPicker
          candidates={candidates}
          onChoose={choose}
          onBrowse={browse}
          {...(installation ? { onCancel: () => setPicking(false) } : {})}
        />
      ) : installation ? (
        progress ? (
          <Scanning progress={progress} />
        ) : catalog ? (
          <Editor catalog={catalog} onRescan={rescan} />
        ) : (
          <NoCatalog onScan={rescan} />
        )
      ) : null}
    </div>
  );
}

function InstallationPicker({
  candidates,
  onChoose,
  onBrowse,
  onCancel,
}: {
  candidates: readonly Installation[];
  onChoose: (path: string) => void;
  onBrowse: () => void;
  /** Absent on a first run: there is nothing to go back to until something has been chosen. */
  onCancel?: () => void;
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
      <div className="picker-actions">
        <button className="browse" onClick={onBrowse}>
          Choose a folder…
        </button>
        {onCancel && (
          <button className="browse" onClick={onCancel}>
            Keep the current one
          </button>
        )}
      </div>
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
      <p>XP Object Placer has not read this installation&rsquo;s libraries. It takes about fifteen seconds.</p>
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
  const [exporting, setExporting] = useState(false);
  return (
    <main className="editor">
      <CatalogPanel catalog={catalog} onRescan={onRescan} />
      <Stage />
      <PlacementPanel onExport={() => setExporting(true)} />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
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
        <ObjectThumbnail virtualPath={entry.virtualPath} unavailable={unavailable} />
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
        <div className="mapbar-go">
          <AirportSearch />
          <GoTo />
        </div>
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
 * The other half of getting somewhere, and the half that answers everywhere the airport box cannot:
 * a ridge, a city block, a field with no name. It zooms closer than the airport box does, because a
 * coordinate is a place you already know and an airport is a place you want to see the whole of.
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

function PlacementPanel({ onExport }: { onExport: () => void }): React.JSX.Element {
  const objects = useEditor((state) => state.objects);
  const selection = useEditor((state) => state.selection);
  const selected = objects.find((object) => object.id === selection) ?? null;

  return (
    <section className="panel placement-panel">
      <div className="panel-head">
        <h2>Placed</h2>
        <span className="count">{objects.length.toLocaleString()}</span>
        {/* Stays available with nothing placed, and that is not an oversight. This dialog is also
            the only way to *remove* a pack, so disabling the door because one of the two things
            behind it is unavailable locks the other one out — and somebody who opens the app just
            to uninstall has, by definition, nothing placed. It was disabled at first on the
            reasoning that nothing placed is nothing to install, which is true and was the wrong
            thing to hang the button on. The dialog says which of the two is available. */}
        <button
          className="primary"
          title={
            objects.length === 0
              ? 'Nothing to install yet — but you can remove a pack from here'
              : 'Write this into X-Plane'
          }
          onClick={onExport}
        >
          Install…
        </button>
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
      <div className="inspector-actions">
        <button
          onClick={() => editorStore.getState().duplicateObject(object.id)}
          title="Place another one beside this (Ctrl+D)"
        >
          Duplicate
        </button>
        <button className="danger" onClick={() => editorStore.getState().deleteObject(object.id)}>
          Remove
        </button>
      </div>
    </div>
  );
}
