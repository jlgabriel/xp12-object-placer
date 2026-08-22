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
 * mistaken for a claim about which way the object faces.
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
import { diffEntry, drawnBox, type Unknown } from './syncDiff.js';

export interface ObjectLayerCallbacks {
  onSelect(id: string): void;
  /** Fired once, on release. */
  onMove(id: string, position: LonLat): void;
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

/**
 * One gesture at a time.
 *
 * A move remembers the latest previewed anchor so a release outside the map — where there is no map
 * coordinate to read — still commits the right spot. A rotate remembers the latest bearing for the
 * same reason, and the starting rotation so a release that lands back where it started commits
 * nothing.
 */
type Drag =
  | {
      mode: 'move';
      id: string;
      startAnchor: LonLat;
      startMouse: L.LatLng;
      anchor: LonLat;
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
    selection: string | null,
  ): void {
    const catalogChanged = this.catalogIndex !== catalogIndex;
    this.catalogIndex = catalogIndex;

    const seen = new Set<string>();
    for (const object of objects) {
      seen.add(object.id);
      const selected = object.id === selection;
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

    poly.on('click', () => this.cb.onSelect(object.id));
    poly.on('mousedown', (event) => this.onGrabBody(object.id, event));

    this.group.addLayer(poly);
    this.group.addLayer(anchor);

    const entry: Entry = { object, box, unknown, selected, poly, anchor };
    this.entries.set(object.id, entry);
    this.syncGrip(entry, selected);
  }

  private restyle(entry: Entry, selected: boolean): void {
    const color = selected ? COLOR_SELECTED : entry.unknown ? COLOR_UNKNOWN : COLOR;
    entry.poly.setStyle({ color, weight: selected ? 3 : 2 });
    entry.anchor.setStyle({ color });
    this.syncGrip(entry, selected);
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

  private onGrabBody = (id: string, event: L.LeafletMouseEvent): void => {
    if (!ObjectLayer.isPrimary(event)) return;
    const entry = this.entries.get(id);
    if (!entry || entry.object.locked) return;
    this.map.dragging.disable();
    this.drag = {
      mode: 'move',
      id,
      startAnchor: entry.object.position,
      startMouse: event.latlng,
      anchor: entry.object.position,
      moved: false,
    };
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

  private onMouseMove = (event: L.LeafletMouseEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    const entry = this.entries.get(drag.id);
    if (!entry) return;
    drag.moved = true;

    if (drag.mode === 'move') {
      // Track the cursor's delta from where it grabbed, not the cursor itself: grabbing a hangar by
      // its corner should not teleport its origin under the pointer.
      const anchor: LonLat = {
        lon: drag.startAnchor.lon + (event.latlng.lng - drag.startMouse.lng),
        lat: drag.startAnchor.lat + (event.latlng.lat - drag.startMouse.lat),
      };
      drag.anchor = anchor;
      this.layOut(entry, anchor, entry.object.rotation);
      return;
    }

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
      this.cb.onMove(drag.id, { lon: wrapLon(drag.anchor.lon), lat: drag.anchor.lat });
    } else if (drag.rotation !== drag.startRotation) {
      this.cb.onRotate(drag.id, drag.rotation);
    }
  };
}
