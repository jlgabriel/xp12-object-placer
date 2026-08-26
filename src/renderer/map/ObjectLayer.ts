/**
 * The Leaflet layer that draws placed objects and owns their direct manipulation.
 *
 * Deliberately not react-leaflet. The layer is driven from **outside** React by a store
 * subscription, because a drag updates on every mousemove and must never wait for a render.
 *
 * ## What an object looks like, and what it deliberately does not
 *
 * A turned rectangle — the object's real ground box from OBJ8 — plus a dot on the **anchor**, which
 * is the model origin and is where the DSF coordinate actually puts the object. The dot is often
 * not in the middle of the box, and showing that is the point: it is the difference between where
 * you clicked and where the building lands.
 *
 * There is **no nose arrow**. Rotation 0 means "as the artist modelled it", not "facing north" —
 * the stock fuel truck faces south at 0 — and an object's base heading is not recorded anywhere in
 * OBJ8. A box is a fact; an arrow would be a guess that is wrong for a good part of the library.
 * See src/core/geo/footprint.ts and probes/H0b/FLIGHT.md.
 *
 * The rotate grip hangs off the model's -Z side, so **the grip's compass bearing is the rotation
 * value**: dragging it to a bearing sets that number, and that number is what goes into the DSF.
 * It is drawn as a control — its own colour, a dashed arm, only while selected — so it cannot be
 * mistaken for a claim about which way the object faces. It appears only when **one** object is
 * selected: a handle on every member of a group would be a thicket, and turning several objects
 * about their own origins at once is what the toolbar's rotation field is for.
 *
 * ## Several at once
 *
 * Ctrl-click (Cmd on a Mac) or Shift-click adds an object to the selection instead of replacing it,
 * and dragging any member of a selection carries the whole of it — one shared offset, so the group
 * arrives with its shape intact and reaches the store as a single edit. What that selection is *for*
 * is the arrange tools: three or more objects have a row, and a row can be straightened and spaced.
 *

 * ## Interaction rules, all of them paid for in PCT
 *
 *   - The body takes `mousedown`, not just `click`. Without it Leaflet's pan wins the gesture and
 *     the object simply refuses to move, which reads as the app being broken.
 *   - `bubblingMouseEvents: false` on everything interactive, so selecting never also places, and
 *     grabbing never also pans.
 *   - Left button only. Leaflet's `mousedown` fires for every button, and a right-click that starts
 *     a drag no matching mouseup ever ends leaves the object glued to the cursor.
 *   - Release is caught on the **document**, not the map: the panels flank the map, and letting go
 *     over one of them has to end the drag.
 *   - The store is untouched until release — one commit per gesture, which is what an undo stack
 *     will want later.
 *   - No `L.Icon.Default`. Every mark is a vector, so there is no broken-marker-PNG trap under Vite
 *     and no image asset to ship.
 */

import * as L from 'leaflet';
import type { GroundBox, LonLat, PlacedObject } from '../../core/model.js';
import { footprintCorners, gripPoint } from '../../core/geo/footprint.js';
import { initialBearing, snapAngle, wrapLon } from '../../core/geo/geo.js';
import type { CatalogEntry } from '../../shared/api.js';
import type { ObjectMove, SelectMode } from '../state/store.js';
import { diffEntry, drawnBox, type Unknown } from './syncDiff.js';

export interface ObjectLayerCallbacks {
  /** `mode` is what the modifier keys made of the click — see `SelectMode`. */
  onSelect(id: string, mode: SelectMode): void;
  /**
   * Fired once, on release, with every object the gesture moved.
   *
   * An array even for one object, because dragging any member of a multi-selection drags all of
   * them: the caller commits the lot as a single edit rather than as N edits that happen to be
   * adjacent.
   */
  onMove(moves: readonly ObjectMove[]): void;
  /** Fired once, on release. */
  onRotate(id: string, rotation: number): void;
}

const COLOR = '#4da3ff';
const COLOR_SELECTED = '#f59e0b';
/** An object whose footprint is not known — not in this installation, or unmeasurable. */
const COLOR_UNKNOWN = '#ef4444';
/** The rotate grip. Cyan, complementary to the amber selection, so a control never reads as cargo. */
const COLOR_GRIP = '#22d3ee';

const SNAP_DEG = 5;
/** Gap in metres between the box's farthest corner and the grip, so the grip is always reachable. */
const GRIP_MARGIN_M = 6;

const toLatLng = (p: LonLat): L.LatLngExpression => [p.lat, p.lon];

interface Entry {
  object: PlacedObject;
  /**
   * The box this was built from. Cached rather than looked up per mousemove; a catalog swap
   * rebuilds every entry, so it cannot go stale.
   */
  box: GroundBox;
  unknown: Unknown | null;
  selected: boolean;
  poly: L.Polygon;
  anchor: L.CircleMarker;
  arm?: L.Polyline;
  grip?: L.CircleMarker;
}

/** One object being carried by a move gesture, and where it was when the gesture started. */
interface MoveLeg {
  readonly id: string;
  readonly startAnchor: LonLat;
}

/**
 * One gesture at a time.
 *
 * A move remembers the latest previewed offset so a release outside the map — where there is no map
 * coordinate to read — still commits the right spot. A rotate remembers the latest bearing for the
 * same reason, and the starting rotation so a release that lands back where it started commits
 * nothing.
 *
 * A move carries a **list**: grabbing one of several selected objects drags the whole selection, and
 * every one of them has to be previewed and committed. The offset is shared — this is a translation,
 * so the group keeps its shape and nothing has to be re-derived per object.
 */
type Drag =
  | {
      mode: 'move';
      legs: readonly MoveLeg[];
      startMouse: L.LatLng;
      /** Latest previewed offset from where the gesture began, in degrees. */
      dLon: number;
      dLat: number;
      moved: boolean;
    }
  | {
      mode: 'rotate';
      id: string;
      anchor: LonLat;
      startRotation: number;
      rotation: number;
      moved: boolean;
    };

export class ObjectLayer {
  private readonly group: L.LayerGroup;
  private readonly entries = new Map<string, Entry>();
  private catalogIndex: ReadonlyMap<string, CatalogEntry> = new Map();
  /**
   * What is selected, as a set, kept from the last `sync`.
   *
   * The layer needs this outside a paint: `mousedown` has to know, before any store round trip,
   * whether the object under the cursor is part of a group that should move with it.
   */
  private chosen: ReadonlySet<string> = new Set();
  private drag: Drag | null = null;

  constructor(
    private readonly map: L.Map,
    private readonly cb: ObjectLayerCallbacks,
  ) {
    this.group = L.layerGroup().addTo(map);
    map.on('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  destroy(): void {
    this.map.off('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    if (this.drag) this.map.dragging.enable();
    this.drag = null;
    this.group.remove();
    this.entries.clear();
  }

  /** Reconcile what is drawn with what the store holds. O(changed). */
  sync(
    objects: readonly PlacedObject[],
    catalogIndex: ReadonlyMap<string, CatalogEntry>,
    selection: readonly string[],
  ): void {
    const catalogChanged = this.catalogIndex !== catalogIndex;
    this.catalogIndex = catalogIndex;
    const chosen = new Set(selection);
    this.chosen = chosen;

    const seen = new Set<string>();
    for (const object of objects) {
      seen.add(object.id);
      const selected = chosen.has(object.id);
      const previous = this.entries.get(object.id);
      switch (diffEntry(previous, object, selected, catalogChanged)) {
        case 'skip':
          break;
        case 'restyle':
          this.restyle(previous as Entry, selected);
          break;
        case 'rebuild':
          if (previous) this.remove(object.id);
          this.add(object, selected);
          break;
      }
      // Outside the switch, and deliberately. The grip belongs to a selection of **one** — a handle
      // on every member of a group would be a thicket of them, and turning several objects about
      // their own origins at once is what the toolbar's rotation field is for. That makes grip
      // visibility depend on the size of the selection, which `diffEntry` cannot see: going from one
      // selected object to two leaves the first one's own flags untouched, so it reports `skip` while
      // its grip still has to go. `syncGrip` is idempotent, so asking every time costs nothing.
      const entry = this.entries.get(object.id);
      if (entry) this.syncGrip(entry, selected && chosen.size === 1);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  private add(object: PlacedObject, selected: boolean): void {
    const { box, unknown } = drawnBox(object, this.catalogIndex);
    const color = selected ? COLOR_SELECTED : unknown ? COLOR_UNKNOWN : COLOR;

    const poly = L.polygon(footprintCorners(object.position, box, object.rotation).map(toLatLng), {
      color,
      weight: selected ? 3 : 2,
      fillOpacity: 0.2,
      ...(unknown ? { dashArray: '5,5' } : {}),
      bubblingMouseEvents: false,
    });
    const anchor = L.circleMarker(toLatLng(object.position), {
      radius: 4,
      color,
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
      interactive: false,
    });

    // Ctrl (Cmd on a Mac) adds to the selection instead of replacing it, and Shift does the same —
    // the map has no order to make a range out of, so the key people reach for first should not do
    // nothing. Both land on the store as `toggle`.
    poly.on('click', (event) => this.cb.onSelect(object.id, ObjectLayer.modeOf(event)));
    poly.on('mousedown', (event) => this.onGrabBody(object.id, event));

    this.group.addLayer(poly);
    this.group.addLayer(anchor);

    const entry: Entry = { object, box, unknown, selected, poly, anchor };
    this.entries.set(object.id, entry);
  }

  private restyle(entry: Entry, selected: boolean): void {
    const color = selected ? COLOR_SELECTED : entry.unknown ? COLOR_UNKNOWN : COLOR;
    entry.poly.setStyle({ color, weight: selected ? 3 : 2 });
    entry.anchor.setStyle({ color });
    entry.selected = selected;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.group.removeLayer(entry.poly);
    this.group.removeLayer(entry.anchor);
    if (entry.arm) this.group.removeLayer(entry.arm);
    if (entry.grip) this.group.removeLayer(entry.grip);
    this.entries.delete(id);
  }

  private gripAt(anchor: LonLat, box: GroundBox, rotation: number): LonLat {
    return gripPoint(anchor, box, rotation, GRIP_MARGIN_M);
  }

  private syncGrip(entry: Entry, selected: boolean): void {
    const want = selected && !entry.object.locked;
    if (want && !entry.grip) {
      const tip = this.gripAt(entry.object.position, entry.box, entry.object.rotation);
      entry.arm = L.polyline([toLatLng(entry.object.position), toLatLng(tip)], {
        color: COLOR_GRIP,
        weight: 2,
        // Dashed, so the arm reads as a control reaching out to a handle rather than as a line the
        // object is pointing along. It is not a heading.
        dashArray: '4,4',
        interactive: false,
      });
      entry.grip = L.circleMarker(toLatLng(tip), {
        radius: 6,
        color: COLOR_GRIP,
        weight: 2,
        fillColor: COLOR_GRIP,
        fillOpacity: 1,
        className: 'xop-rotate-grip',
        bubblingMouseEvents: false,
      });
      entry.grip.on('mousedown', (event) => this.onGrabGrip(entry.object.id, event));
      this.group.addLayer(entry.arm);
      this.group.addLayer(entry.grip);
    } else if (!want && entry.grip) {
      if (entry.arm) this.group.removeLayer(entry.arm);
      this.group.removeLayer(entry.grip);
      delete entry.arm;
      delete entry.grip;
    }
  }

  private static isPrimary(event: L.LeafletMouseEvent): boolean {
    return event.originalEvent.button === 0;
  }

  private static modeOf(event: L.LeafletMouseEvent): SelectMode {
    const native = event.originalEvent;
    return native.ctrlKey || native.metaKey || native.shiftKey ? 'toggle' : 'replace';
  }

  private onGrabBody = (id: string, event: L.LeafletMouseEvent): void => {
    if (!ObjectLayer.isPrimary(event)) return;
    const entry = this.entries.get(id);
    if (!entry || entry.object.locked) return;

    // Grabbing something that is already part of the selection drags the whole selection; grabbing
    // anything else drags only it, and the click at the end of the gesture is what will select it.
    // A modifier is on its way to changing the selection rather than to moving anything, so it takes
    // the group case off the table — otherwise Ctrl-clicking a member of a row to drop it would
    // shove the entire row a pixel first.
    const group =
      this.chosen.has(id) && this.chosen.size > 1 && ObjectLayer.modeOf(event) === 'replace';
    const ids = group ? [...this.chosen] : [id];
    const legs = ids.flatMap((other) => {
      const member = this.entries.get(other);
      // A locked object in the group stays put while the rest of it moves. That is the same rule as
      // arrange: locked means the map does not move this, not that the gesture is refused.
      return member && !member.object.locked
        ? [{ id: other, startAnchor: member.object.position }]
        : [];
    });
    if (legs.length === 0) return;

    this.map.dragging.disable();
    this.drag = { mode: 'move', legs, startMouse: event.latlng, dLon: 0, dLat: 0, moved: false };
  };

  private onGrabGrip = (id: string, event: L.LeafletMouseEvent): void => {
    if (!ObjectLayer.isPrimary(event)) return;
    const entry = this.entries.get(id);
    if (!entry || entry.object.locked) return;
    this.map.dragging.disable();
    this.drag = {
      mode: 'rotate',
      id,
      anchor: entry.object.position,
      startRotation: entry.object.rotation,
      rotation: entry.object.rotation,
      moved: false,
    };
    // The store is not touched until release, so without a readout on the grip the angle being
    // dragged to is invisible. It says "rotation" in full: this is the DSF's fourth argument, not a
    // compass heading, and the two are only ever the same number by accident.
    entry.grip
      ?.bindTooltip(`rotation ${Math.round(entry.object.rotation)}°`, {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: 'xop-rotate-tip',
      })
      .openTooltip();
  };

  private layOut(entry: Entry, anchor: LonLat, rotation: number): void {
    entry.poly.setLatLngs(footprintCorners(anchor, entry.box, rotation).map(toLatLng));
    entry.anchor.setLatLng(toLatLng(anchor));
    if (entry.arm && entry.grip) {
      const tip = this.gripAt(anchor, entry.box, rotation);
      entry.arm.setLatLngs([toLatLng(anchor), toLatLng(tip)]);
      entry.grip.setLatLng(toLatLng(tip));
    }
  }

  /** Where one leg of a move gesture currently sits, given the offset dragged so far. */
  private static legAt(leg: MoveLeg, dLon: number, dLat: number): LonLat {
    return { lon: leg.startAnchor.lon + dLon, lat: leg.startAnchor.lat + dLat };
  }

  private onMouseMove = (event: L.LeafletMouseEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    drag.moved = true;

    if (drag.mode === 'move') {
      // Track the cursor's delta from where it grabbed, not the cursor itself: grabbing a hangar by
      // its corner should not teleport its origin under the pointer. One offset for every leg, so a
      // group keeps its shape exactly — the alternative, re-deriving each anchor from the cursor,
      // would let rounding pull the row apart over a long drag.
      drag.dLon = event.latlng.lng - drag.startMouse.lng;
      drag.dLat = event.latlng.lat - drag.startMouse.lat;
      for (const leg of drag.legs) {
        const entry = this.entries.get(leg.id);
        if (entry) {
          this.layOut(entry, ObjectLayer.legAt(leg, drag.dLon, drag.dLat), entry.object.rotation);
        }
      }
      return;
    }

    const entry = this.entries.get(drag.id);
    if (!entry) return;
    // The grip's bearing from the anchor IS the rotation — that is what gripPoint is built for, so
    // there is no conversion here and no sign to get wrong.
    let rotation = initialBearing(drag.anchor, { lon: event.latlng.lng, lat: event.latlng.lat });
    if (event.originalEvent.shiftKey) rotation = snapAngle(rotation, SNAP_DEG);
    drag.rotation = rotation;
    this.layOut(entry, drag.anchor, rotation);
    entry.grip?.setTooltipContent(`rotation ${Math.round(rotation)}°`);
  };

  /** A DOM listener, so it needs no map coordinate — see the note on Drag. */
  private onMouseUp = (): void => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.map.dragging.enable();

    // The readout belongs to the gesture, not to the grip, so it goes on *any* release — including
    // a click on the grip that never moved, which would otherwise leave it stuck open.
    if (drag.mode === 'rotate') this.entries.get(drag.id)?.grip?.unbindTooltip();
    if (!drag.moved) return; // a click, not a drag; the body's own click handler owns selection

    if (drag.mode === 'move') {
      // Wrap only here. During the preview a drag across the antimeridian stays visually continuous;
      // what reaches the store is normalised.
      this.cb.onMove(
        drag.legs.map((leg) => {
          const at = ObjectLayer.legAt(leg, drag.dLon, drag.dLat);
          return { id: leg.id, position: { lon: wrapLon(at.lon), lat: at.lat } };
        }),
      );
    } else if (drag.rotation !== drag.startRotation) {
      this.cb.onRotate(drag.id, drag.rotation);
    }
  };
}
