/**
 * Spherical geometry: distance, bearing, and the point you reach by walking.
 *
 * Copied from PCT (afs4-poi-creator, `src/core/geo/geo.ts`), © Juan Luis Gabriel, GPL-3.0-or-later.
 * Both projects are GPL-3.0 (docs/DECISIONS.md D4), and this is the part of PCT that is genuinely
 * simulator-agnostic: it knows about the Earth, not about Aerofly. Nothing Aerofly-shaped came
 * across with it — `wad`, `orientation` and `poiName` stayed behind on purpose (docs/LINEAGE.md).
 *
 * Conventions: points are `{ lon, lat }` in degrees; a bearing is a compass azimuth — 0 = north,
 * 90 = east, clockwise. Pure, no I/O.
 */

import type { LonLat } from '../model.js';

/** Mean Earth radius (IUGG). One radius everywhere, so nothing has to agree with anything twice. */
export const EARTH_RADIUS_M = 6371008.8;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Great-circle distance in metres. */
export function haversine(a: LonLat, b: LonLat): number {
  const lat1 = a.lat * D2R;
  const lat2 = b.lat * D2R;
  const dlat = (b.lat - a.lat) * D2R;
  const dlon = (b.lon - a.lon) * D2R;
  const h =
    Math.sin(dlat / 2) * Math.sin(dlat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) * Math.sin(dlon / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Initial great-circle bearing from `a` to `b`, degrees in [0, 360). */
export function initialBearing(a: LonLat, b: LonLat): number {
  const lat1 = a.lat * D2R;
  const lat2 = b.lat * D2R;
  const dlon = (b.lon - a.lon) * D2R;
  const x = Math.sin(dlon) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);
  return (Math.atan2(x, y) * R2D + 360) % 360;
}

/** The point reached from `p` after `distanceM` metres along `bearingDeg`. */
export function destination(p: LonLat, distanceM: number, bearingDeg: number): LonLat {
  const ang = distanceM / EARTH_RADIUS_M;
  const br = bearingDeg * D2R;
  const lat1 = p.lat * D2R;
  const lon1 = p.lon * D2R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lon: lon2 * R2D, lat: lat2 * R2D };
}

/**
 * Wrap a longitude into [-180, 180) — the same real point, in the range everything else accepts.
 *
 * Leaflet hands out longitudes it never wraps: a click or a drag in a repeated world copy (panning
 * at low zoom), or a drag across the antimeridian, lands at 181 or -181. That is a real place, but
 * `writeDsfText` refuses it as "not on Earth" and the tile it belongs to would be nonsense.
 *
 * In-range values pass through byte-identical, so a coordinate that was already valid never picks
 * up float noise. Keep this out of `haversine` / `initialBearing` / `destination`: those three are
 * numerically identical to PCT's, and that is worth preserving.
 */
export function wrapLon(lon: number): number {
  if (lon >= -180 && lon < 180) return lon;
  return (((lon % 360) + 540) % 360) - 180;
}

/** Normalise an angle into [0, 360). */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Round an angle to the nearest multiple of `step`, in [0, 360). The rotate grip's Shift-snap. */
export function snapAngle(deg: number, step: number): number {
  return normalizeDegrees(Math.round(deg / step) * step);
}
