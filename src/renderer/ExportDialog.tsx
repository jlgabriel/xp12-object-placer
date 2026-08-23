import { useEffect, useMemo, useState } from 'react';
import type { ExportResult, InstalledPack } from '../shared/api.js';
import { groupByTile } from '../core/dsf/tile.js';
import { DEFAULT_PACK_NAME } from '../core/export/packName.js';
import { editorStore, useEditor } from './state/editorStore.js';

/**
 * Installing into X-Plane, which is the step people get wrong.
 *
 * Copying a folder is half the job — the load order in `scenery_packs.ini` decides what actually
 * wins — so this dialog is explicit about both halves: what folder was written, what line went into
 * that file, where, and where the backup of it is. Somebody who wants to undo all of this by hand
 * has everything they need on screen, which is the point.
 */
export function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const objects = useEditor((state) => state.objects);
  const [packName, setPackName] = useState(DEFAULT_PACK_NAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [installed, setInstalled] = useState<InstalledPack[] | null>(null);

  const tileCount = useMemo(() => groupByTile(objects).size, [objects]);

  // The map listens for keys on the window; while this is up, they belong to the dialog.
  useEffect(() => {
    editorStore.getState().setModalOpen(true);
    return () => editorStore.getState().setModalOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const refreshInstalled = async (): Promise<void> => {
    setInstalled(await window.xop.listInstalledPacks());
  };

  useEffect(() => {
    void refreshInstalled().catch(() => setInstalled([]));
  }, []);

  const doExport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setResult(await window.xop.exportPack({ packName, objects }));
      await refreshInstalled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const doUninstall = async (pack: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.xop.uninstallPack(pack);
      await refreshInstalled();
      if (result?.packFolder === pack) setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-label="Install into X-Plane"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>Install into X-Plane</h2>

        {error && <p className="error inline">{error}</p>}

        {result ? (
          <Installed result={result} />
        ) : (
          <>
            <p className="lead">
              {objects.length.toLocaleString()} object{objects.length === 1 ? '' : 's'} across{' '}
              {tileCount} tile{tileCount === 1 ? '' : 's'}. One file per tile goes into a new
              folder in <code>Custom Scenery</code>, and one line into{' '}
              <code>scenery_packs.ini</code> so X-Plane loads it above other overlays.
            </p>

            <label className="field">
              <span>Pack name</span>
              <input
                value={packName}
                autoFocus
                disabled={busy}
                onChange={(event) => setPackName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !busy) void doExport();
                }}
              />
            </label>
            <p className="hint">
              This becomes the folder name. XP Object Placer never overwrites a folder it did not make.
            </p>
          </>
        )}

        <div className="actions">
          {result ? (
            <button className="primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy || objects.length === 0} onClick={() => void doExport()}>
                {busy ? 'Writing…' : 'Install'}
              </button>
            </>
          )}
        </div>

        <InstalledPacks
          packs={installed}
          busy={busy}
          onRemove={(pack) => void doUninstall(pack)}
        />
      </div>
    </div>
  );
}

function Installed({ result }: { result: ExportResult }): React.JSX.Element {
  return (
    <div className="result">
      <p className="lead">
        Written: {result.fileCount} file{result.fileCount === 1 ? '' : 's'} for {result.tileCount}{' '}
        tile{result.tileCount === 1 ? '' : 's'}.
      </p>
      <dl>
        <dt>folder</dt>
        <dd className="mono wrap">{result.packRoot}</dd>
        <dt>scenery_packs.ini</dt>
        <dd className="mono wrap">{result.line}</dd>
        <dd className="note">{describePlacement(result)}</dd>
        {result.iniBackup && (
          <>
            <dt>backup of that file</dt>
            <dd className="mono wrap">{result.iniBackup}</dd>
          </>
        )}
      </dl>
      {result.warnings.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <p className="note">Restart X-Plane to see it.</p>
    </div>
  );
}

/** What actually happened to `scenery_packs.ini`, in words rather than in an enum. */
function describePlacement(result: ExportResult): string {
  switch (result.placement) {
    case 'below-global-airports':
      return 'added just below *GLOBAL_AIRPORTS*, at the top of the overlay tier';
    case 'appended':
      return 'added at the end of the file — there was no *GLOBAL_AIRPORTS* marker to aim at';
    case 'already-present':
      return 'already there, so nothing was changed';
    case 'disabled-by-user':
      return 'listed here as disabled, and left that way — switch it back on there when you want it';
  }
}

function InstalledPacks({
  packs,
  busy,
  onRemove,
}: {
  packs: InstalledPack[] | null;
  busy: boolean;
  onRemove: (packName: string) => void;
}): React.JSX.Element | null {
  if (packs === null) return null;

  return (
    <div className="installed">
      <h3>Packs installed here</h3>
      {packs.length === 0 ? (
        <p className="note">None yet.</p>
      ) : (
        <ul>
          {packs.map((pack) => (
            <li key={pack.packName}>
              <span className="name">{pack.packName}</span>
              <span className="note">
                {pack.fileCount} file{pack.fileCount === 1 ? '' : 's'} ·{' '}
                {pack.writtenAt.slice(0, 10)}
              </span>
              {/* Removing takes the folder and the line. Half an uninstall leaves either scenery
                  nobody can see or a line pointing at nothing. */}
              <button className="danger" disabled={busy} onClick={() => onRemove(pack.packName)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
