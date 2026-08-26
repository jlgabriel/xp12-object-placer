/**
 * Put a group of placed objects into a tidy row.
 *
 * Copied from PCT (afs4-poi-creator, `src/core/geo/arrange.ts`), © Juan Luis Gabriel,
 * GPL-3.0-or-later. It is the second file to make the trip under D4, and the one `docs/LINEAGE.md`
 * said would come across "when XOP grows the arrange tools". It travels for the same reason
 * `geo.ts` did: it knows about the Earth and about a row, and nothing about either simulator. The
 * arithmetic below is PCT's, line for line; what changed on the way over is `EPS_M` and the reason
 * written under it.
 *
 * ## Why there is no "align left"
 *
 * The 2D-editor vocabulary — align left, align top, distribute horizontally — does not survive the
 * trip to a map. **Left is WEST**, and nobody wants seven parked aircraft snapped to the westernmost
 * meridian. On a map the real request is "put them on the line they already almost form", and that
 * line is hardly ever N-S or E-W: a row of hangars along an apron runs at whatever angle the apron
 * runs at.
 *
 * So everything here is expressed in the row's own frame: ALONG the line and ACROSS it.
 *
 *     lineUp      ->  across := 0        (straighten; each object keeps its place along the row)
 *     spaceEvenly ->  along  := even     (equalise the gaps; each object keeps its offset across)
 *
 * Which makes the two operations orthogonal and composable — run both and you get a clean row, run
 * one and the other property is untouched.
 *
 * Pure, no I/O, and it knows nothing about objects, catalogs or locking. Applying the result is the
 * store's job.
 */

import type { LonLat } from '../model.js';
import { destination, haversine, initialBearing, wrapLon } from './geo.js';

const D2R = Math.PI / 180;

/**
 * Below this the "row" is a cluster of coincident points and its bearing is meaningless.
 *
 * Five centimetres: far below anything the satellite imagery can show at any zoom it has, and far
 * above the noise in the projection underneath.
 */
const MIN_AXIS_M = 0.05;

/**
 * A move smaller than this is not a move.
 *
 * PCT set this from its file format — Aerofly's `.toc` writes seven decimals, so a millimetre could
 * not be expressed at all. That reasoning does **not** carry over: XOP writes nine decimals in text
 * DSF and a 32-bit fixed grid per tile in binary, both of which resolve far below a millimetre. The
 * number stays because the *other* half of the argument does. Five millimetres is invisible at every
 * zoom the imagery has, so a "move" that small is float residue from the projection rather than
 * something anybody asked for — and reporting it as a move would put a bullet in the title bar of a
 * document where lining up an already-straight row changed nothing.
 */
const EPS_M = 0.005;

/**
 * The line a selection forms, defined by its two FARTHEST-APART members.
 *
 * Deliberately not "first and last selected": selection order is invisible state the user cannot see
 * or verify, while "the two ends of the row stay put and everything else moves between them" is a
 * sentence they can predict before they click. It is also order-independent — the same objects give
 * the same axis however they were picked. (Best-fit/PCA was the alternative; it moves the end
 * objects too, which reads as the tool doing something you did not ask for.)
 */
export interface RowAxis {
  /** Indices into the input array of the two objects that define the row. */
  readonly startIndex: number;
  readonly endIndex: number;
  readonly start: LonLat;
  /** Compass bearing start to end. */
  readonly bearing: number;
  readonly lengthM: number;
}

/**
 * The farthest-apart pair, or null if there is no usable row — fewer than two points, or all of them
 * in the same spot.
 *
 * O(n squared), which is the right call here: these are the objects somebody selected by hand, so
 * the count is tens at most, and an exact answer with no spatial index beats a clever one.
 */
export function rowAxis(points: readonly LonLat[]): RowAxis | null {
  let best = -1;
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = haversine(points[i]!, points[j]!);
      if (d > best) {
        best = d;
        bi = i;
        bj = j;
      }
    }
  }
  if (best < MIN_AXIS_M) return null;
  return {
    startIndex: bi,
    endIndex: bj,
    start: points[bi]!,
    bearing: initialBearing(points[bi]!, points[bj]!),
    lengthM: best,
  };
}

/**
 * Decompose a point into metres ALONG the axis (from its start) and ACROSS it (positive = right of
 * the bearing). A negative `along` means the point sits behind the start — possible, since the
 * farthest pair bounds the row but a third point can still project just past an end.
 *
 * This is the tangent-plane form, on purpose. The exact spherical along-track,
 * `acos(cos(d13)/cos(dxt))`, divides two cosines that are both about 1 at these distances and then
 * takes an acos near 0 — catastrophic cancellation, jittering in the last digits of exactly the
 * values we are trying to make tidy. What the approximation costs is measured in
 * `tests/arrange.test.ts`: a decompose then rebuild round trip lands within a fraction of a
 * millimetre on a 300 m row. (Most of that residue is not this formula but the walk back out: a
 * great circle has turned a little by the time you step off it sideways.)
 */
export function alongCross(axis: RowAxis, p: LonLat): { along: number; cross: number } {
  const d = haversine(axis.start, p);
  if (d === 0) return { along: 0, cross: 0 };
  const delta = (initialBearing(axis.start, p) - axis.bearing) * D2R;
  return { along: d * Math.cos(delta), cross: d * Math.sin(delta) };
}

/** Rebuild a position from its along/across pair — the inverse of `alongCross`. */
export function fromAlongCross(axis: RowAxis, along: number, cross: number): LonLat {
  // A negative distance travels the opposite way along the bearing (sin is odd, cos is even), so the
  // sign of `along` / `cross` needs no special case.
  const onLine = destination(axis.start, along, axis.bearing);
  const p = cross === 0 ? onLine : destination(onLine, cross, axis.bearing + 90);
  return { lon: wrapLon(p.lon), lat: p.lat };
}

/**
 * Straighten: every point moves perpendicularly onto the row's line, keeping where it sits along it.
 * The two objects that define the axis are already on the line, so they do not move.
 *
 * Points that are already on the line come back as the **same reference**, which is how the caller
 * tells a real move from a no-op — and how "line up an already-straight row" reaches the store as
 * nothing at all, leaving the document clean.
 */
export function lineUp(points: readonly LonLat[]): readonly LonLat[] {
  const axis = rowAxis(points);
  if (!axis) return points;
  return points.map((p) => {
    const { along, cross } = alongCross(axis, p);
    return Math.abs(cross) < EPS_M ? p : fromAlongCross(axis, along, 0);
  });
}

/**
 * Equalise the gaps: the outermost two along the row keep their place, the rest are spread evenly
 * between them in the order they already lie. Each point keeps its offset ACROSS the row, so this
 * re-spaces a curved row without straightening it — run `lineUp` too for that.
 *
 * Same reference-preserving contract as `lineUp`.
 */
export function spaceEvenly(points: readonly LonLat[]): readonly LonLat[] {
  const axis = rowAxis(points);
  if (!axis || points.length < 3) return points;
  const ac = points.map((p) => alongCross(axis, p));
  const order = ac.map((_, i) => i).sort((a, b) => ac[a]!.along - ac[b]!.along);
  const first = ac[order[0]!]!.along;
  const last = ac[order[order.length - 1]!]!.along;
  const step = (last - first) / (points.length - 1);
  const out = points.slice();
  order.forEach((idx, k) => {
    const target = first + step * k;
    if (Math.abs(target - ac[idx]!.along) >= EPS_M) {
      out[idx] = fromAlongCross(axis, target, ac[idx]!.cross);
    }
  });
  return out;
}
