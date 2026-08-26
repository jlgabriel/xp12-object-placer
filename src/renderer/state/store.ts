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
import { destination, haversine, normalizeDegrees, wrapLon } from '../../core/geo/geo.js';
import { lineUp, spaceEvenly } from '../../core/geo/arrange.js';
import type { CatalogEntry } from '../../shared/api.js';
import type { Airport } from '../../core/airports/aptDat.js';
import { buildAirportIndex, EMPTY_AIRPORT_INDEX, type AirportIndex } from '../../core/airports/search.js';
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

/**
 * How close the map goes when the airport box picks somewhere.
 *
 * Wide enough to frame a whole field rather than land on one taxiway: at this zoom a thousand
 * pixels of map is about eight kilometres of ground, which holds the longest runway anyone has
 * built and still shows what is next to it. Typing a coordinate is a different intention — you know
 * exactly where you meant — so that box keeps its tighter zoom.
 */
export const AIRPORT_ZOOM = 14;

/** Being read from the installation, ready to search, or it could not be read. */
export type AirportsStatus = 'loading' | 'ready' | 'failed';

/**
 * What a click on an object means for the selection.
 *
 * `replace` is a plain click — this one, and only this one. `toggle` is a Ctrl-click (Cmd on a Mac):
 * add it if it is not there, drop it if it is. Nothing here is called "shift-click", because the
 * placed list uses Shift for a range and the map has no order to make a range out of; both arrive as
 * one of these two.
 */
export type SelectMode = 'replace' | 'toggle';

/** One leg of a group move: where this object ends up. */
export interface ObjectMove {
  readonly id: string;
  readonly position: LonLat;
}

/**
 * How far a duplicate lands from what it was copied from, in metres east.
 *
 * The whole group moves by the same amount — the copies keep the arrangement of the originals, which
 * is the point of duplicating a row rather than an object. The amount is the group's own east-west
 * extent plus the widest footprint in it plus a metre, so the copy lands *clear* of the original
 * however big the objects are: a fixed nudge hides a hangar behind a hangar and leaves a bollard
 * metres from its twin.
 */
function duplicateStep(
  objects: readonly PlacedObject[],
  catalogIndex: ReadonlyMap<string, CatalogEntry>,
): number {
  let widest = 0;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let latSum = 0;
  for (const object of objects) {
    const ground = catalogIndex.get(object.libraryPath)?.ground;
    if (ground) widest = Math.max(widest, ground.maxX - ground.minX);
    minLon = Math.min(minLon, object.position.lon);
    maxLon = Math.max(maxLon, object.position.lon);
    latSum += object.position.lat;
  }
  // The spread of the anchors, measured on the ground rather than in degrees of longitude — which is
  // a different distance at every latitude and nothing at all near the poles. One representative
  // latitude for the lot of them is plenty: this only has to be big enough, not exact.
  const lat = latSum / objects.length;
  const span = haversine({ lon: minLon, lat }, { lon: maxLon, lat });
  return span + Math.max(widest, 2) + 1;
}

export interface EditorState {
  readonly objects: readonly PlacedObject[];
  /** The catalog, by virtual path. The map reads footprints out of it. */
  readonly catalogIndex: ReadonlyMap<string, CatalogEntry>;
  /**
   * The installation's airports, ready to search.
   *
   * Reference data, like the catalog: read from the user's own `apt.dat` files, never edited, and
   * no part of any document. It exists so the map can be told "take me to SCEL" and for nothing
   * else (D15).
   */
  readonly airports: AirportIndex;
  /**
   * Where that list is up to.
   *
   * Reading it means reading every `apt.dat` in the installation, which is a couple of seconds the
   * first time. The box has to be able to say so, and to say when it could not be read at all —
   * otherwise "no airports here" and "not finished looking" are the same empty dropdown.
   */
  readonly airportsStatus: AirportsStatus;
  /**
   * What is selected, in no particular order.
   *
   * An array rather than a single id since v1.4, and the order in it is deliberately **not** the
   * order things were clicked. Nothing reads it as history: the arrange tools take the two objects
   * that are farthest apart, which is a fact about the map somebody can see, rather than the first
   * and last of an invisible sequence they cannot.
   *
   * Empty means nothing is selected. Never contains a duplicate, and never an id that is no longer
   * placed — `deleteSelection` and the two document loads prune it.
   */
  readonly selection: readonly string[];
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
  setAirports(airports: readonly Airport[]): void;
  setAirportsStatus(status: AirportsStatus): void;
  arm(virtualPath: string | null): void;
  placeAt(position: LonLat): void;
  /**
   * Select one object, add one to what is already selected, or clear the selection.
   *
   * `null` clears whatever the mode says: a click on empty map is not a click on an object, so it
   * means "nothing", never "toggle nothing".
   */
  select(id: string | null, mode?: SelectMode): void;
  /** Replace the selection wholesale. The placed list's shift-click range comes through here. */
  selectMany(ids: readonly string[]): void;
  /**
   * Move one object.
   *
   * Nothing in the UI reaches for this any more — a map drag is a group drag of one, so it goes
   * through `moveObjects`. It stays because "move this object to here" is the primitive the rest is
   * built out of, and because the tests say what it does.
   */
  moveObject(id: string, position: LonLat): void;
  /**
   * Move several objects at once, as a single edit.
   *
   * The map's group drag. One `set` rather than a loop of `moveObject`, so the layer repaints once
   * and the dirty flag is raised once — and so an undo stack, when there is one, sees one gesture.
   */
  moveObjects(moves: readonly ObjectMove[]): void;
  rotateObject(id: string, rotation: number): void;
  /** Give every unlocked object in the selection this rotation. */
  setSelectionRotation(rotation: number): void;
  /** Turn every unlocked object in the selection by `delta` degrees, from wherever it is now. */
  turnSelectionBy(delta: number): void;
  /**
   * Remove one object, whether or not it is selected, and drop it out of the selection if it was.
   *
   * Like `moveObject`, no longer on any path the user can take — Del removes the selection. Kept as
   * the primitive, and because removing something that is *not* selected is a thing a context menu
   * will eventually want.
   */
  deleteObject(id: string): void;
  /** Remove everything selected, and leave nothing selected. */
  deleteSelection(): void;
  /** Place a copy of everything selected beside it, clear of the originals, and select the copies. */
  duplicateSelection(): void;
  /**
   * Straighten the selection: every unlocked object moves onto the line through the two that are
   * farthest apart. A row that is already straight is left alone entirely — no write, no bullet in
   * the title bar.
   */
  lineUpSelection(): void;
  /** Equalise the gaps along that same line, keeping each object's offset across it. */
  spaceSelectionEvenly(): void;
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
 * The objects, with the selection put into a tidy row — or **null** when nothing actually moved.
 *
 * Null rather than an equal array, because "nothing moved" has to reach the store as *no `set` at
 * all*. `watchForEdits` marks the document dirty on any change to `objects`, so lining up a row that
 * is already straight would otherwise put a bullet in the title bar for doing nothing at all. The
 * reference-preserving contract in `core/geo/arrange.ts` is what makes that detectable: an untouched
 * point comes back as the same object.
 *
 * A locked object still helps *define* the row — it is one of the points handed to the transform —
 * but is never written back. So locking the two ends is how somebody pins the axis by hand.
 * (Consequence worth knowing: locking a middle object leaves `spaceEvenly` with uneven gaps, because
 * the even spacing was computed for all of them. That is PCT's behaviour too, and the alternative —
 * silently re-spacing around the locked ones — is a harder thing to predict than a gap that visibly
 * did not close.)
 */
function arrangedObjects(
  state: EditorState,
  transform: (points: readonly LonLat[]) => readonly LonLat[],
): readonly PlacedObject[] | null {
  const { selection, objects } = state;
  // Two objects are a line already, and are evenly spaced by definition.
  if (selection.length < 3) return null;
  const wanted = new Set(selection);
  const picked = objects.filter((object) => wanted.has(object.id));
  if (picked.length < 3) return null;

  const before = picked.map((object) => object.position);
  const after = transform(before);
  const moved = new Map<string, LonLat>();
  picked.forEach((object, i) => {
    if (object.locked || after[i] === before[i]) return;
    moved.set(object.id, after[i]!);
  });
  if (moved.size === 0) return null;

  // `fromAlongCross` already wraps the longitude it hands back, so nothing here has to.
  return objects.map((object) => {
    const position = moved.get(object.id);
    return position ? { ...object, position } : object;
  });
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

/**
 * One empty array for every empty selection.
 *
 * A fresh `[]` each time would be a new reference each time, and both the map layer's subscription
 * and React's `useEditor` compare selections by reference. Clicking empty map twice would repaint
 * every footprint on the second click for no reason.
 */
const NOTHING_SELECTED: readonly string[] = Object.freeze([]);

export function createEditorStore(): EditorStore {
  // Reassigned when a project is loaded, so new work cannot collide with ids that came out of the
  // file. The store's own comment asked for this before there were project files to load.
  let nextId = makeIdFactory();

  const store = createStore<EditorState>()(
    subscribeWithSelector((set, get) => ({
      objects: [],
      catalogIndex: new Map(),
      airports: EMPTY_AIRPORT_INDEX,
      airportsStatus: 'loading',
      selection: NOTHING_SELECTED,
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

      setAirports(airports) {
        // The searchable forms are worked out here, once, rather than on every keystroke: there are
        // tens of thousands of these and folding a name for accent-insensitive matching is not free.
        set({ airports: buildAirportIndex(airports), airportsStatus: 'ready' });
      },

      setAirportsStatus(status) {
        set({ airportsStatus: status });
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
        set({ objects: [...objects, object], selection: [object.id] });
      },

      select(id, mode = 'replace') {
        if (id === null) {
          // Already empty is already right, and re-setting it would repaint every footprint.
          if (get().selection.length > 0) set({ selection: NOTHING_SELECTED });
          return;
        }
        const selection = get().selection;
        if (mode === 'toggle') {
          const next = selection.includes(id)
            ? selection.filter((other) => other !== id)
            : [...selection, id];
          set({ selection: next.length === 0 ? NOTHING_SELECTED : next });
          return;
        }
        // A plain click on the one thing already selected is not a change. Worth the check: the map
        // fires a click at the end of every drag that never moved, and a new array each time would
        // restyle the whole layer.
        if (selection.length === 1 && selection[0] === id) return;
        set({ selection: [id] });
      },

      selectMany(ids) {
        // Deduplicated here rather than trusted from the caller: a range in the placed list and a
        // Ctrl-click can overlap, and the invariant "no id twice" is what lets arrange treat the
        // selection as a set of distinct points.
        const next = [...new Set(ids)];
        set({ selection: next.length === 0 ? NOTHING_SELECTED : next });
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

      moveObjects(moves) {
        if (moves.length === 0) return;
        const where = new Map(moves.map((move) => [move.id, move.position]));
        set({
          objects: get().objects.map((object) => {
            const position = where.get(object.id);
            return position
              ? { ...object, position: { lon: wrapLon(position.lon), lat: position.lat } }
              : object;
          }),
        });
      },

      rotateObject(id, rotation) {
        set({
          objects: get().objects.map((object) =>
            object.id === id ? { ...object, rotation: normalizeDegrees(rotation) } : object,
          ),
        });
      },

      setSelectionRotation(rotation) {
        const { selection, objects } = get();
        if (selection.length === 0) return;
        const wanted = new Set(selection);
        const turned = normalizeDegrees(rotation);
        let changed = false;
        const next = objects.map((object) => {
          // `locked` reads "the map may not drag or turn this". A bulk turn is a turn.
          if (!wanted.has(object.id) || object.locked || object.rotation === turned) return object;
          changed = true;
          return { ...object, rotation: turned };
        });
        if (changed) set({ objects: next });
      },

      turnSelectionBy(delta) {
        const { selection, objects } = get();
        if (selection.length === 0 || normalizeDegrees(delta) === 0) return;
        const wanted = new Set(selection);
        let changed = false;
        const next = objects.map((object) => {
          if (!wanted.has(object.id) || object.locked) return object;
          changed = true;
          return { ...object, rotation: normalizeDegrees(object.rotation + delta) };
        });
        if (changed) set({ objects: next });
      },

      duplicateSelection() {
        const { objects, catalogIndex, selection } = get();
        const wanted = new Set(selection);
        // Filtered out of `objects` rather than looked up per id, so the copies are appended in the
        // order they were placed. The selection's own order is not an order (see its comment).
        const originals = objects.filter((object) => wanted.has(object.id));
        if (originals.length === 0) return;

        const step = duplicateStep(originals, catalogIndex);
        const copies = originals.map((original) => ({
          ...original,
          id: nextId(),
          // Due east, in metres on the ground — not a constant added to the longitude, which would
          // be a different distance at every latitude and nothing at all near the poles.
          position: destination(original.position, step, 90),
        }));
        // The copies are selected, not the originals: duplicating is nearly always the first half of
        // "and now put this one over there".
        set({
          objects: [...objects, ...copies],
          selection: copies.map((copy) => copy.id),
        });
      },

      lineUpSelection() {
        const objects = arrangedObjects(get(), lineUp);
        if (objects) set({ objects });
      },

      spaceSelectionEvenly() {
        const objects = arrangedObjects(get(), spaceEvenly);
        if (objects) set({ objects });
      },

      deleteObject(id) {
        const { objects, selection } = get();
        const next = objects.filter((object) => object.id !== id);
        if (next.length === objects.length) return;
        const kept = selection.filter((other) => other !== id);
        set({
          objects: next,
          ...(kept.length === selection.length
            ? {}
            : { selection: kept.length === 0 ? NOTHING_SELECTED : kept }),
        });
      },

      deleteSelection() {
        const { objects, selection } = get();
        if (selection.length === 0) return;
        const wanted = new Set(selection);
        set({
          objects: objects.filter((object) => !wanted.has(object.id)),
          selection: NOTHING_SELECTED,
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
          selection: NOTHING_SELECTED,
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
          selection: NOTHING_SELECTED,
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
