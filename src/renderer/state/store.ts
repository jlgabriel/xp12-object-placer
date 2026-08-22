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

/** Which map imagery is underneath. Satellite is the default: objects are placed against what is
 *  actually on the ground, and street tiles rarely show the apron you are decorating. */
export type TileProviderId = 'esri' | 'osm';

export interface Camera {
  readonly lon: number;
  readonly lat: number;
  readonly zoom: number;
}

/** Where the map opens before anyone has said where they want to work. */
export const DEFAULT_CAMERA: Camera = { lon: 0, lat: 20, zoom: 3 };

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
  const nextId = makeIdFactory();

  return createStore<EditorState>()(
    subscribeWithSelector((set, get) => ({
      objects: [],
      catalogIndex: new Map(),
      selection: null,
      placing: null,
      camera: DEFAULT_CAMERA,
      cameraEpoch: 0,
      tiles: 'esri',

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

      goTo(position, zoom) {
        const state = get();
        set({
          camera: { lon: position.lon, lat: position.lat, zoom: zoom ?? state.camera.zoom },
          cameraEpoch: state.cameraEpoch + 1,
        });
      },
    })),
  );
}
