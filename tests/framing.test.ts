import { describe, expect, it } from 'vitest';
import {
  cornersOf,
  frameBounds,
  multiply,
  project,
  type FramingOptions,
} from '../src/core/thumbnail/framing.js';
import type { Bounds } from '../src/core/obj8/parse.js';

const box = (w: number, h: number, d: number, atY = 0): Bounds => ({
  min: { x: -w / 2, y: atY, z: -d / 2 },
  max: { x: w / 2, y: atY + h, z: d / 2 },
});

/** Where the eight corners land on the picture, in normalised device coordinates. */
function cornersInFrame(bounds: Bounds, options: FramingOptions = {}) {
  const framing = frameBounds(bounds, options);
  const matrix = multiply(framing.projection, framing.view);
  return cornersOf(bounds).map((corner) => project(matrix, corner));
}

/**
 * Real objects, measured from the installation, spanning what the library actually contains: the
 * smallest thing worth placing and an autogen city block a thousand metres across.
 */
const REAL: ReadonlyArray<readonly [string, Bounds]> = [
  ['a garden chair', box(0.6, 0.9, 0.6)],
  ['a fuel truck', box(2.5, 2.4, 5.2)],
  ['a 16×16 hangar', box(16.4, 6, 16.1)],
  ['a control tower', box(8.8, 18.6, 8.1)],
  ['an airliner', box(34, 12, 38)],
  ['a city block', box(1123, 60, 517)],
  ['a flagpole: tall and thin', box(0.3, 24, 0.3)],
  ['a taxiway line: flat and wide', box(120, 0.02, 0.5)],
];

describe('every object ends up inside the picture', () => {
  it.each(REAL)('%s', (_name, bounds) => {
    for (const [x, y, z] of cornersInFrame(bounds)) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
      // Inside the depth range too: a corner behind the near plane is clipped away, and the
      // thumbnail is of half an object with no sign that anything went wrong.
      expect(z).toBeGreaterThan(-1);
      expect(z).toBeLessThan(1);
    }
  });

  // Fitting is only half the job. An object framed correctly but tiny in the middle of the square
  // is exactly as useless as one hanging out of frame, and it is the failure nobody reports.
  it.each(REAL)('%s fills the frame', (_name, bounds) => {
    const corners = cornersInFrame(bounds);
    const widest = Math.max(...corners.map(([x]) => Math.abs(x)));
    const tallest = Math.max(...corners.map(([, y]) => Math.abs(y)));
    expect(Math.max(widest, tallest)).toBeGreaterThan(0.8);
  });
});

describe('the framing itself', () => {
  it('looks down at the object from above', () => {
    const bounds = box(16, 6, 16);
    const { eye, target } = frameBounds(bounds);
    expect(eye[1]).toBeGreaterThan(target[1]);
  });

  // A hangar photographed square-on is a grey wall. Off-axis shows two sides and the roof, which
  // is what makes one box tell itself apart from another.
  it('stands off the object’s axes, so a symmetrical thing is not a flat rectangle', () => {
    const { eye, target } = frameBounds(box(10, 10, 10));
    expect(Math.abs(eye[0] - target[0])).toBeGreaterThan(0.1);
    expect(Math.abs(eye[2] - target[2])).toBeGreaterThan(0.1);
  });

  it('centres on the object, not on the origin', () => {
    // An object modelled well off its own insertion point — 45% of the library is off-centre, and
    // 13% by more than ten metres.
    const offset: Bounds = { min: { x: 100, y: 0, z: 100 }, max: { x: 110, y: 8, z: 110 } };
    const { target } = frameBounds(offset);
    expect(target[0]).toBeCloseTo(105);
    expect(target[2]).toBeCloseTo(105);

    for (const [x, y] of cornersInFrame(offset)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
    }
  });

  it('fits a wide picture as well as a square one', () => {
    for (const aspect of [1, 16 / 9, 0.5]) {
      for (const [x, y] of cornersInFrame(box(20, 5, 8), { aspect })) {
        expect(Math.abs(x)).toBeLessThanOrEqual(1);
        expect(Math.abs(y)).toBeLessThanOrEqual(1);
      }
    }
  });

  // An object whose geometry failed to parse, or a marker with no size at all. Dividing by zero
  // here produces NaN matrices and a blank square with nothing to explain it.
  it('survives a bounding box with no size', () => {
    const point: Bounds = { min: { x: 5, y: 0, z: 5 }, max: { x: 5, y: 0, z: 5 } };
    const framing = frameBounds(point);
    expect([...framing.view, ...framing.projection].every(Number.isFinite)).toBe(true);
    expect(framing.eye.every(Number.isFinite)).toBe(true);
  });

  it('never puts the camera inside the object', () => {
    for (const [, bounds] of REAL) {
      const { eye } = frameBounds(bounds);
      const inside =
        eye[0] > bounds.min.x && eye[0] < bounds.max.x &&
        eye[1] > bounds.min.y && eye[1] < bounds.max.y &&
        eye[2] > bounds.min.z && eye[2] < bounds.max.z;
      expect(inside).toBe(false);
    }
  });
});
