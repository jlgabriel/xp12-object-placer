/**
 * Where to stand so the object fills the picture.
 *
 * Pure arithmetic, deliberately kept out of the WebGL module. Framing is where thumbnail renderers
 * go wrong — an object half out of frame, or a speck in the middle of a grey square — and those are
 * bugs in matrices, which are the most tedious thing to debug through a canvas and the easiest
 * thing to check in a test: project the eight corners of the bounding box and see where they land.
 *
 * Axes are X-Plane's: +X east, +Y up, +Z south, metres, origin at the object's insertion point.
 */

import type { Bounds } from '../obj8/parse.js';

/** Column-major 4×4, the layout WebGL's `uniformMatrix4fv` expects. */
export type Mat4 = Float32Array;

export interface Framing {
  readonly view: Mat4;
  readonly projection: Mat4;
  /** Where the camera ended up, in world metres. Useful for lighting and for tests. */
  readonly eye: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

export interface FramingOptions {
  /** Vertical field of view, radians. */
  readonly fieldOfView?: number;
  /** Width ÷ height of the picture. */
  readonly aspect?: number;
  /** Fraction of the frame left empty around the object. */
  readonly margin?: number;
  /** Compass direction the camera looks **from**, radians clockwise from north. */
  readonly azimuth?: number;
  /** How far above the horizon the camera sits, radians. */
  readonly elevation?: number;
}

/**
 * Three quarters from above, which is how a catalogue photographs a thing.
 *
 * Straight on hides the depth, straight down hides everything that makes a building recognisable,
 * and the corner view shows two sides and the roof. The azimuth is deliberately **not** a multiple
 * of 90°: a symmetrical object seen down its own axis of symmetry looks like a flat rectangle, and
 * a hangar photographed square-on is a grey wall.
 */
const DEFAULTS = {
  fieldOfView: (35 * Math.PI) / 180,
  aspect: 1,
  margin: 0.08,
  azimuth: (-135 * Math.PI) / 180,
  elevation: (26 * Math.PI) / 180,
} as const;

type Vec = readonly [number, number, number];

const subtract = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize(v: Vec): Vec {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 1] : [v[0] / length, v[1] / length, v[2] / length];
}

export function lookAt(eye: Vec, target: Vec, up: Vec = [0, 1, 0]): Mat4 {
  const forward = normalize(subtract(target, eye));
  // A camera looking straight down has a forward parallel to up, and their cross product is zero —
  // every row of the matrix becomes NaN and the picture is blank with nothing to explain it.
  const reference = Math.abs(dot(forward, up)) > 0.999 ? ([0, 0, 1] as Vec) : up;
  const right = normalize(cross(forward, reference));
  const trueUp = cross(right, forward);

  return new Float32Array([
    right[0], trueUp[0], -forward[0], 0,
    right[1], trueUp[1], -forward[1], 0,
    right[2], trueUp[2], -forward[2], 0,
    -dot(right, eye), -dot(trueUp, eye), dot(forward, eye), 1,
  ]);
}

export function perspective(fieldOfView: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fieldOfView / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

/** Apply a column-major 4×4 to a point, returning normalised device coordinates. */
export function project(matrix: Mat4, point: Vec): readonly [number, number, number] {
  const [x, y, z] = point;
  const clip = [0, 1, 2, 3].map(
    (row) => matrix[row]! * x + matrix[4 + row]! * y + matrix[8 + row]! * z + matrix[12 + row]!,
  );
  const w = clip[3]!;
  return w === 0 ? [0, 0, 0] : [clip[0]! / w, clip[1]! / w, clip[2]! / w];
}

export function cornersOf(bounds: Bounds): readonly Vec[] {
  const { min, max } = bounds;
  const corners: Vec[] = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) corners.push([x, y, z]);
    }
  }
  return corners;
}

/**
 * Frame a bounding box: how far back the camera has to stand, and the matrices to draw with.
 *
 * The distance is solved rather than guessed. For a camera at `centre − direction · d`, a corner's
 * depth is `direction · (corner − centre) + d`, and its sideways offset does not depend on `d` at
 * all — the camera only ever moves along `direction`. So "this corner is inside the frustum" is
 * `|offset| ≤ (depthAtCentre + d) · tan(fov/2)`, one inequality per corner per axis, each solved
 * for `d` directly. The largest answer frames every corner.
 *
 * Fitting by trial — render, look, move back a bit — is the version that leaves one object in
 * eighty clipped, and nobody finds which eighty.
 */
export function frameBounds(bounds: Bounds, options: FramingOptions = {}): Framing {
  const { fieldOfView, aspect, margin, azimuth, elevation } = { ...DEFAULTS, ...options };

  const centre: Vec = [
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  ];

  // Where the camera looks *from*, as a unit vector pointing from the camera towards the object.
  const direction = normalize([
    -Math.sin(azimuth) * Math.cos(elevation),
    -Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ]);
  const right = normalize(cross(direction, [0, 1, 0]));
  const up = cross(right, direction);

  const tanY = Math.tan(fieldOfView / 2) * (1 - margin);
  const tanX = tanY * aspect;

  let distance = 0;
  for (const corner of cornersOf(bounds)) {
    const offset = subtract(corner, centre);
    const depthAtCentre = dot(direction, offset);
    distance = Math.max(
      distance,
      Math.abs(dot(right, offset)) / tanX - depthAtCentre,
      Math.abs(dot(up, offset)) / tanY - depthAtCentre,
    );
  }

  // A zero-sized bounding box — a marker object, or one whose geometry failed to parse — would
  // put the camera exactly on the object and divide by zero on the way to a blank square.
  const radius = Math.hypot(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
  distance = Math.max(distance, radius * 0.5, 0.001);

  const eye: Vec = [
    centre[0] - direction[0] * distance,
    centre[1] - direction[1] * distance,
    centre[2] - direction[2] * distance,
  ];

  // Generous, and relative to the object rather than fixed: the library runs from a 0.4 m bollard
  // to a 1 123 m block of city, and one near plane cannot serve both without z-fighting at one end
  // or clipping at the other.
  const near = Math.max(distance * 0.01, 0.001);
  const far = distance * 4 + radius * 4;

  return {
    view: lookAt(eye, centre, up),
    projection: perspective(fieldOfView, aspect, near, far),
    eye,
    target: centre,
  };
}

/** Column-major 4×4 product: `a` then `b`, so `multiply(projection, view)` projects a world point. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
}
