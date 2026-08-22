/**
 * The contract between the renderer and everything privileged.
 *
 * One rule governs this file, inherited from PCT's security review: **the renderer never names a
 * file path it invented.** It picks from a list main produced, or main opens a dialog. Anything
 * else would make the sandbox decorative.
 */

import type { GroundBox } from '../core/model.js';

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
}

declare global {
  interface Window {
    readonly xop: XopApi;
  }
}
