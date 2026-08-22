/**
 * Where a placed object's bounding box lands on the map.
 *
 * This is the subtlest arithmetic in the renderer, so it lives here — pure, no Leaflet, no DOM —
 * and it is tested. PCT shipped a rotation-sense bug (forum #120) in exactly this calculation, and
 * the reason it survived is that a rectangle is 180°-symmetric: the wrong sign looks plausible.
 *
 * ## The axis mapping
 *
 * OBJ8 is **+X east, +Y up, +Z south** (reference/obj8.md, read off real files). A DSF `OBJECT`
 * turns the model **clockwise**, ordinary compass sense — measured by probe H0b, four fuel trucks
 * at 0/90/180/270 reading south → west → north → east.
 *
 * So a model-local ground offset `(x, z)` sits at compass azimuth `atan2(x, -z) + rotation`, at
 * distance `hypot(x, z)`. Check it against the axes: `(1, 0)` gives 90° = east = +X ✔;
 * `(0, 1)` gives 180° = south = +Z ✔; and adding `rotation` turns that clockwise ✔.
 *
 * ## Rotation 0 is not north, and nothing here pretends otherwise
 *
 * The stock fuel truck faces **south** at rotation 0, because it was modelled looking down +Z. An
 * object's real compass heading is `artistBaseHeading + rotation`, and `artistBaseHeading` is
 * nowhere in the file — which end of a mesh is "the front" is semantics, not geometry.
 *
 * That is why this module draws a **turned box** and offers no nose arrow: a box is a fact, an
 * arrow would be a guess. See src/core/model.ts and probes/H0b/FLIGHT.md.
 */

import type { GroundBox, LonLat } from '../model.js';
import { destination } from './geo.js';

const R2D = 180 / Math.PI;

/**
 * Project a model-local ground offset onto the map.
 *
 * `x` is metres along the model's +X (east at rotation 0), `z` metres along +Z (south at 0).
 * A zero offset returns the anchor itself, rather than asking `atan2(0, 0)` for an azimuth.
 */
export function localOffsetToLonLat(
  anchor: LonLat,
  x: number,
  z: number,
  rotation: number,
): LonLat {
  const distance = Math.hypot(x, z);
  if (distance === 0) return { lon: anchor.lon, lat: anchor.lat };
  return destination(anchor, distance, Math.atan2(x, -z) * R2D + rotation);
}

/**
 * The four ground corners of a placed object's box, as map points.
 *
 * Returned in perimeter order — the model-local rectangle walked as a closed loop — so they can go
 * straight into a polygon without self-intersecting at any rotation:
 *
 *   0: (minX, minZ)   1: (maxX, minZ)   2: (maxX, maxZ)   3: (minX, maxZ)
 *
 * The anchor is the model **origin**, which is where the DSF coordinate puts the object. It is not
 * the centre of the box and frequently nowhere near it — that is what `GroundBox` is for.
 */
export function footprintCorners(
  anchor: LonLat,
  box: GroundBox,
  rotation: number,
): [LonLat, LonLat, LonLat, LonLat] {
  return [
    localOffsetToLonLat(anchor, box.minX, box.minZ, rotation),
    localOffsetToLonLat(anchor, box.maxX, box.minZ, rotation),
    localOffsetToLonLat(anchor, box.maxX, box.maxZ, rotation),
    localOffsetToLonLat(anchor, box.minX, box.maxZ, rotation),
  ];
}

/**
 * How far the box reaches from the origin, in metres — the distance to its farthest corner.
 *
 * Not half the width: with an off-centre origin the far corner can be a long way past that, and a
 * rotate grip placed at half-width would end up inside the object it is meant to turn.
 */
export function groundReach(box: GroundBox): number {
  return Math.max(
    Math.hypot(box.minX, box.minZ),
    Math.hypot(box.maxX, box.minZ),
    Math.hypot(box.maxX, box.maxZ),
    Math.hypot(box.minX, box.maxZ),
  );
}

/**
 * Where the rotate grip sits, and the identity that makes it readable.
 *
 * The grip hangs along the model's **-Z** — the side that points north at rotation 0 — so its
 * compass bearing from the anchor **is the rotation value**, with no offset and no sign flip.
 * Dragging it to a bearing therefore sets the rotation to that same number, and the readout on the
 * grip is the number that goes into the DSF.
 *
 * -Z is a geometric reference, not a claim about the object's front. The grip is drawn as a control
 * (its own colour, only while selected), never as a heading arrow, precisely because rotation 0 is
 * "as the artist modelled it" and the front is unknowable from the file.
 */
export function gripPoint(
  anchor: LonLat,
  box: GroundBox,
  rotation: number,
  marginM: number,
): LonLat {
  return destination(anchor, groundReach(box) + marginM, rotation);
}

/** A square box of half-extent `half`, centred on the origin. What an unmeasured object draws. */
export function placeholderBox(half: number): GroundBox {
  return { minX: -half, maxX: half, minZ: -half, maxZ: half };
}
