/**
 * The editor store: what is placed, what is selected, and where the map is looking.
 *
 * A pure factory with no DOM in it, so it unit-tests under the node config. The single live
 * instance and the React hook live next door in editorStore.ts — the same split PCT uses, and for
 * the same reason: the map layer subscribes to this store from **outside** React, because a
 * per-mousemove drag must never round-trip through a render.
 *
 * Structural sharing is a contract, not an optimisation. Every action leaves untouched objects at
 * the same reference, which is what lets the map layer diff by reference and rebuild only what
 * actually changed.
 */

import { createStore, type Mutate, type StoreApi } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LonLat, PlacedObject } from '../../core/model.js';
import { normalizeDegrees, wrapLon } from '../../core/geo/geo.js';
import type { CatalogEntry } from '../../shared/api.js';
import {
  DEFAULT_CAMERA,
  newProject,
  nextIdSeed,
  UNTITLED,
  type Camera,
  type Project,
} from '../../core/project/project.js';

/** Which map imagery is underneath. Satellite is the default: objects are placed against what is
 *  actually on the ground, and street tiles rarely show the apron you are decorating. */
export type TileProviderId = 'esri' | 'osm';

export interface EditorState {
  readonly objects: readonly PlacedObject[];
  /** The catalog, by virtual path. The map reads footprints out of it. */
  readonly catalogIndex: ReadonlyMap<string, CatalogEntry>;
  readonly selection: string | null;
  /** Virtual path of the object armed for placement, or null. */
  readonly placing: string | null;
  /**
   * Where the map is looking. Ephemeral: panning and zooming update it and nothing else, so the
   * camera never counts as an edit.
   */
  readonly camera: Camera;
  /**
   * Bumped only when something asks the map to *go* somewhere. Pan and zoom never bump it, so
   * looking around is never yanked back — the map watches this, not `camera`.
   */
  readonly cameraEpoch: number;
  readonly tiles: TileProviderId;
  /**
   * True while a dialog is over the map.
   *
   * The map listens for keys on the window, so without this a Delete pressed with a dialog open —
   * on its way to a button, or by reflex — quietly removes the selected object behind it.
   */
  readonly modalOpen: boolean;

  /**
   * Whether there is work in here that is not on disk.
   *
   * Maintained by a subscription rather than by each action remembering to set it — see
   * `watchForEdits`. An action added next year cannot forget to be an edit.
   */
  readonly dirty: boolean;
  /** What the open document is called. Main is the authority; this is its answer, for display. */
  readonly documentName: string;
  /** Carried through save so a project keeps the date it was first made. */
  readonly createdAt: string;
  /**
   * Bumped whenever the objects are replaced wholesale by opening or clearing a project.
   *
   * Internal bookkeeping for `watchForEdits`, which otherwise cannot tell "the user moved
   * something" from "a whole different project just arrived" — both look like new objects.
   */
  readonly documentEpoch: number;

  setCatalog(entries: readonly CatalogEntry[]): void;
  arm(virtualPath: string | null): void;
  placeAt(position: LonLat): void;
  select(id: string | null): void;
  moveObject(id: string, position: LonLat): void;
  rotateObject(id: string, rotation: number): void;
  deleteObject(id: string): void;
  setCamera(camera: Camera): void;
  goTo(position: LonLat, zoom?: number): void;
  setTiles(provider: TileProviderId): void;
  setModalOpen(open: boolean): void;

  /** Replace everything with a project read off the disk. Leaves the store clean. */
  loadProject(project: Project, documentName: string): void;
  /** Empty the map and start again. Leaves the store clean. */
  resetProject(): void;
  /** The work is on disk now, under this name. */
  markSaved(documentName: string): void;
  markDirty(): void;
}

/** The store's contents as a project, ready to be written. */
export function projectOf(state: EditorState): Project {
  return {
    schemaVersion: 1,
    app: 'xop',
    name: state.documentName,
    createdAt: state.createdAt,
    // Stamped by main at the moment of writing, which is the only clock that knows when that was.
    modifiedAt: state.createdAt,
    camera: state.camera,
    objects: state.objects,
  };
}

/**
 * The store type keeps the `subscribeWithSelector` mutation, and that is not cosmetic: without it
 * `subscribe` narrows back to the one-argument form and the map layer loses the ability to watch a
 * slice. Which would mean repainting every object on every keystroke in the search box.
 */
export type EditorStore = Mutate<StoreApi<EditorState>, [['zustand/subscribeWithSelector', never]]>;

/**
 * Ids are a session counter, not a UUID.
 *
 * They have to be stable and unique, and they end up in nothing but this store — the DSF identifies
 * an object by its line, not by a name. A counter is also reproducible, which makes every test in
 * this file readable. When project files arrive, loading one seeds the counter past the highest id
 * it contains.
 */
function makeIdFactory(start = 1): () => string {
  let next = start;
  return () => `obj-${next++}`;
}

export function createEditorStore(): EditorStore {
  // Reassigned when a project is loaded, so new work cannot collide with ids that came out of the
  // file. The store's own comment asked for this before there were project files to load.
  let nextId = makeIdFactory();

  const store = createStore<EditorState>()(
    subscribeWithSelector((set, get) => ({
      objects: [],
      catalogIndex: new Map(),
      selection: null,
      placing: null,
      camera: DEFAULT_CAMERA,
      cameraEpoch: 0,
      tiles: 'esri',
      modalOpen: false,
      dirty: false,
      documentName: UNTITLED,
      createdAt: newProject().createdAt,
      documentEpoch: 0,

      setCatalog(entries) {
        const index = new Map(entries.map((entry) => [entry.virtualPath, entry]));
        // A rescan can retire an object. Disarming a path that is no longer in the catalog beats
        // leaving the map armed with something it can no longer draw a footprint for.
        const placing = get().placing;
        set({
          catalogIndex: index,
          ...(placing !== null && !index.has(placing) ? { placing: null } : {}),
        });
      },

      arm(virtualPath) {
        set({ placing: virtualPath });
      },

      placeAt(position) {
        const { placing, catalogIndex, objects } = get();
        if (placing === null) return;
        const entry = catalogIndex.get(placing);
        const object: PlacedObject = {
          id: nextId(),
          libraryPath: placing,
          // Wrap at the point of committing, never in a live preview: a click in a repeated world
          // copy is a real place, it just needs saying in the range everything downstream accepts.
          position: { lon: wrapLon(position.lon), lat: position.lat },
          rotation: 0,
          ...(entry ? { label: entry.name } : {}),
        };
        // Stays armed on purpose. Decorating means placing the same thing several times, and having
        // to re-pick the object between every tree would make that miserable. Escape disarms.
        set({ objects: [...objects, object], selection: object.id });
      },

      select(id) {
        set({ selection: id });
      },

      moveObject(id, position) {
        set({
          objects: get().objects.map((object) =>
            object.id === id
              ? { ...object, position: { lon: wrapLon(position.lon), lat: position.lat } }
              : object,
          ),
        });
      },

      rotateObject(id, rotation) {
        set({
          objects: get().objects.map((object) =>
            object.id === id ? { ...object, rotation: normalizeDegrees(rotation) } : object,
          ),
        });
      },

      deleteObject(id) {
        const { objects, selection } = get();
        set({
          objects: objects.filter((object) => object.id !== id),
          ...(selection === id ? { selection: null } : {}),
        });
      },

      setCamera(camera) {
        set({ camera });
      },

      setTiles(provider) {
        set({ tiles: provider });
      },

      setModalOpen(open) {
        set({ modalOpen: open });
      },

      goTo(position, zoom) {
        const state = get();
        set({
          camera: { lon: position.lon, lat: position.lat, zoom: zoom ?? state.camera.zoom },
          cameraEpoch: state.cameraEpoch + 1,
        });
      },

      loadProject(project, documentName) {
        nextId = makeIdFactory(nextIdSeed(project.objects));
        set({
          objects: project.objects,
          camera: project.camera,
          cameraEpoch: get().cameraEpoch + 1,
          documentEpoch: get().documentEpoch + 1,
          selection: null,
          placing: null,
          documentName,
          createdAt: project.createdAt,
          dirty: false,
        });
      },

      resetProject() {
        const fresh = newProject();
        nextId = makeIdFactory();
        set({
          objects: [],
          camera: DEFAULT_CAMERA,
          cameraEpoch: get().cameraEpoch + 1,
          documentEpoch: get().documentEpoch + 1,
          selection: null,
          placing: null,
          documentName: UNTITLED,
          createdAt: fresh.createdAt,
          dirty: false,
        });
      },

      markSaved(documentName) {
        set({ documentName, dirty: false });
      },

      markDirty() {
        if (!get().dirty) set({ dirty: true });
      },
    })),
  );

  watchForEdits(store);
  return store;
}

/**
 * Mark the store dirty whenever the objects change, from wherever.
 *
 * Deliberately a subscription and not a line inside each action. Placing, moving, rotating and
 * deleting all have to count as edits, and so does whatever gets added later — and the one that
 * forgets is the one that loses somebody's work silently, because the close guard would let the
 * window go without asking.
 *
 * It watches `objects` only. Panning the map is not an edit, which is the same rule the camera
 * already lives by in this file, and it means looking around a project never puts a bullet in the
 * title bar.
 *
 * Opening or clearing a project also changes the objects, and must **not** count: a project you
 * just opened has nothing unsaved in it. Those two bump `documentEpoch` in the same `set`, which
 * is how this tells the two apart — "the objects are different" is true either way.
 */
function watchForEdits(store: EditorStore): void {
  let epoch = store.getState().documentEpoch;
  store.subscribe(
    (state) => state.objects,
    () => {
      const current = store.getState().documentEpoch;
      if (current !== epoch) {
        epoch = current;
        return;
      }
      store.getState().markDirty();
    },
  );
}
