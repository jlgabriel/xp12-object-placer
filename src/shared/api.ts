/**
 * The contract between the renderer and everything privileged.
 *
 * One rule governs this file, inherited from PCT's security review: **the renderer never names a
 * file path it invented.** It picks from a list main produced, or main opens a dialog. Anything
 * else would make the sandbox decorative.
 */

import type { GroundBox, PlacedObject } from '../core/model.js';
import type { Project } from '../core/project/project.js';

export interface Installation {
  readonly path: string;
  readonly version?: string;
  readonly usable: boolean;
  readonly problem?: string;
}

/** What the catalog looks like to the renderer: slimmed, because there are thousands of them. */
export interface CatalogEntry {
  /** Identity. Verbatim, case-sensitive — this string goes into the DSF. */
  readonly virtualPath: string;
  readonly name: string;
  readonly category: readonly string[];
  /** Absent when the object could not be measured; the UI has to cope rather than assume. */
  readonly size?: { readonly width: number; readonly height: number; readonly depth: number };
  /**
   * The footprint the map draws: the object's ground rectangle in model-local metres, with the
   * anchor at (0, 0) wherever that falls inside it. Absent alongside `size`, for the same reason.
   *
   * `size` cannot stand in for it. The model origin sits off the centre of its own box for 45% of
   * the real catalog, and by more than ten metres for 13% of it, so a width × depth rectangle drawn
   * around the anchor would be visibly in the wrong place for a great many objects.
   */
  readonly ground?: GroundBox;
  readonly variantCount: number;
  readonly animated: boolean;
  /** True when the object is nothing but a ground decal — a marking, a stain, a drain. */
  readonly grounded: boolean;
  /**
   * Present when placing this object would produce nothing in the simulator, with the reason.
   *
   * X-Plane resolves a virtual path it cannot find by drawing nothing, silently. An object whose
   * files are missing, or which contains no geometry at all, is therefore a trap: it can be placed,
   * exported and flown to, and the user finds bare grass and no explanation anywhere. Say so up
   * front instead.
   */
  readonly unavailable?: string;
}

export interface CatalogSnapshot {
  /**
   * The shape of this snapshot. Bumped whenever a field the UI depends on is added, so a cache
   * written by an older build is discarded instead of being drawn with a piece missing.
   *
   * Falling back — inventing a centred box for an entry that predates `ground`, say — would put a
   * silently wrong footprint on the map, which is the one failure this project keeps refusing to
   * ship. A rescan takes fifteen seconds and says so.
   */
  readonly version: number;
  readonly installation: string;
  readonly scannedAt: string;
  readonly entries: readonly CatalogEntry[];
  readonly stats: {
    readonly libraries: number;
    readonly totalExports: number;
    readonly objectExports: number;
    readonly distinctObjects: number;
    readonly offered: number;
    readonly measured: number;
    readonly unmeasured: number;
  };
}

export interface ScanProgress {
  readonly phase: 'libraries' | 'measuring' | 'done';
  readonly done: number;
  readonly total: number;
}

/** Where the installer put its line, and why. */
export type SceneryPackPlacement =
  | 'below-global-airports'
  | 'appended'
  | 'already-present'
  | 'disabled-by-user';

export interface ExportRequest {
  /** What the user typed. A name, not a path — main decides what folder that becomes. */
  readonly packName: string;
  /**
   * The whole project, not just its objects: the pack carries a copy of it, and sending the
   * objects separately would be two sources for one fact.
   */
  readonly project: Project;
}

/**
 * The open document, as the window title and the header show it.
 *
 * `path` is for display only. It travels renderer-ward and never back: main already knows where
 * the project lives, and accepting a path from the renderer is the one thing this boundary exists
 * to prevent.
 */
export interface DocumentState {
  readonly name: string;
  readonly path: string | null;
  readonly dirty: boolean;
}

export interface OpenedProject {
  readonly document: DocumentState;
  readonly project: Project;
}

export interface ExportResult {
  readonly packFolder: string;
  /** Where it landed, for telling the user. Display only; the renderer never sends a path back. */
  readonly packRoot: string;
  readonly fileCount: number;
  readonly tileCount: number;
  /** The exact `scenery_packs.ini` line, and whether it had to be written. */
  readonly line: string;
  readonly lineWritten: boolean;
  readonly placement: SceneryPackPlacement;
  readonly iniBackup?: string;
  readonly warnings: readonly string[];
}

export interface InstalledPack {
  readonly packName: string;
  readonly writtenAt: string;
  readonly fileCount: number;
  readonly xop: string;
}

export interface UninstallResult {
  readonly folderRemoved: boolean;
  readonly linesRemoved: readonly string[];
}

export interface XopApi {
  /**
   * The application version.
   *
   * Deliberately an IPC call rather than something the preload reads from `process.env`: what a
   * sandboxed preload can see of `process` is not something to build on a guess about. Main knows
   * the answer for certain.
   */
  getVersion(): Promise<string>;

  /** Installations X-Plane itself records, each already checked against the disk. */
  listInstallations(): Promise<Installation[]>;
  /** The one in use, or null on a first run. */
  currentInstallation(): Promise<Installation | null>;
  /**
   * Choose one of the installations `listInstallations` returned. Main rejects anything it did not
   * offer, so a compromised renderer cannot point XOP at an arbitrary directory.
   */
  selectInstallation(path: string): Promise<Installation>;
  /** Open a folder picker. Main owns the dialog and validates what comes back. */
  browseForInstallation(): Promise<Installation | null>;

  /** The cached catalog for the current installation, or null if there is none yet. */
  getCatalog(): Promise<CatalogSnapshot | null>;
  /** Rescan from disk and replace the cache. */
  rescanCatalog(): Promise<CatalogSnapshot>;
  /** Progress during a rescan. Returns an unsubscribe function. */
  onScanProgress(listener: (progress: ScanProgress) => void): () => void;

  /**
   * Write the placed objects into the chosen installation as a scenery pack, and add its line to
   * `scenery_packs.ini`.
   *
   * The renderer supplies a **name** and the objects. It does not say where anything goes: main
   * owns the installation path, sanitises the name into a folder, and refuses anything that would
   * land outside `Custom Scenery`. That is the same rule as `selectInstallation` — the renderer
   * never names a path it invented.
   */
  exportPack(request: ExportRequest): Promise<ExportResult>;

  /** The packs XOP has installed here, so they can be offered for removal. */
  listInstalledPacks(): Promise<InstalledPack[]>;

  /** Remove a pack: its folder and its line. Main refuses any folder it did not write. */
  uninstallPack(packName: string): Promise<UninstallResult>;

  /**
   * The document. Every one of these says *what*, never *where* — main owns the path and draws
   * every dialog, exactly as with installations.
   */
  newProject(): Promise<DocumentState>;
  /** Open a picker and read the chosen project. Null when the user cancels; throws on a bad file. */
  openProject(): Promise<OpenedProject | null>;
  /** Save to the open file, asking where only if there is not one yet. Null when cancelled. */
  saveProject(project: Project): Promise<DocumentState | null>;
  /** Always asks where. Null when cancelled. */
  saveProjectAs(project: Project): Promise<DocumentState | null>;
  /** Tell main whether there is unsaved work, which is what the title and the close guard use. */
  markDirty(dirty: boolean): Promise<DocumentState>;

  /**
   * Main is asking for a save because the window is closing and the user chose Save.
   *
   * The renderer answers by saving and then calling `closeWindow`. If the save is cancelled it
   * simply does not call it, and the window stays open — which is the right outcome and needs no
   * extra message to say so.
   */
  onSaveBeforeClose(listener: () => void): () => void;
  /** Close for real, past the unsaved-work guard. */
  closeWindow(): Promise<void>;
}

declare global {
  interface Window {
    readonly xop: XopApi;
  }
}
