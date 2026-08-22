import { describe, expect, it } from 'vitest';
import {
  footprintCorners,
  gripPoint,
  groundReach,
  localOffsetToLonLat,
  placeholderBox,
} from '../src/core/geo/footprint.js';
import { haversine, initialBearing } from '../src/core/geo/geo.js';
import type { GroundBox } from '../src/core/model.js';

const ANCHOR = { lon: -70.7846, lat: -33.376 };

/** Compass bearing from the anchor to a projected offset, which is what every claim here is about. */
const bearingTo = (p: { lon: number; lat: number }): number => initialBearing(ANCHOR, p);
const distanceTo = (p: { lon: number; lat: number }): number => haversine(ANCHOR, p);

describe('localOffsetToLonLat — the axis mapping', () => {
  it('sends +X east and +Z south at rotation 0', () => {
    // OBJ8's convention, read off real files: +X east, +Y up, +Z south. Getting it wrong is
    // invisible on a square object and obvious on a hangar.
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 10, 0, 0))).toBeCloseTo(90, 3);
    expect(bearingTo(localOffsetToLonLat(ANCHOR, -10, 0, 0))).toBeCloseTo(270, 3);
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 0, 10, 0))).toBeCloseTo(180, 3);
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 0, -10, 0))).toBeCloseTo(0, 3);
  });

  it('turns clockwise, which is what probe H0b measured', () => {
    // H0b: four fuel trucks at 0/90/180/270 read south, west, north, east. The truck is modelled
    // facing +Z, so following +Z through the rotations is exactly that reading.
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 0, 10, 0))).toBeCloseTo(180, 3); // south
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 0, 10, 90))).toBeCloseTo(270, 3); // west
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 0, 10, 180))).toBeCloseTo(0, 3); // north
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 0, 10, 270))).toBeCloseTo(90, 3); // east
  });

  it('is checked at a non-cardinal angle, which is the only way the sign is pinned', () => {
    // The lesson from PCT forum #120. At 45 degrees a clockwise turn takes +X (east) to south-east;
    // the wrong sign would take it north-east, and a symmetric test at 90 could not tell them apart.
    expect(bearingTo(localOffsetToLonLat(ANCHOR, 10, 0, 45))).toBeCloseTo(135, 2);
  });

  it('keeps the distance from the anchor whatever the rotation', () => {
    for (const rotation of [0, 17, 90, 213, 359]) {
      expect(distanceTo(localOffsetToLonLat(ANCHOR, 3, 4, rotation))).toBeCloseTo(5, 6);
    }
  });

  it('returns the anchor itself for a zero offset, rather than asking atan2(0, 0)', () => {
    expect(localOffsetToLonLat(ANCHOR, 0, 0, 137)).toEqual({ lon: ANCHOR.lon, lat: ANCHOR.lat });
  });
});

describe('footprintCorners', () => {
  const CENTRED: GroundBox = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
  /** A hangar anchored at the middle of its front wall: the whole box lies to the model's north. */
  const AT_THE_DOOR: GroundBox = { minX: -8, maxX: 8, minZ: -16, maxZ: 0 };

  it('puts a centred box around the anchor', () => {
    const corners = footprintCorners(ANCHOR, CENTRED, 0);
    expect(corners.filter((c) => c.lat > ANCHOR.lat)).toHaveLength(2);
    expect(corners.filter((c) => c.lat < ANCHOR.lat)).toHaveLength(2);
  });

  it('puts an off-centre box where the model puts it, not around the anchor', () => {
    // The whole reason GroundBox exists rather than a width and a depth. 45% of the real catalog is
    // anchored off its own centre, and 13% of it by more than ten metres.
    const corners = footprintCorners(ANCHOR, AT_THE_DOOR, 0);
    expect(corners.every((c) => c.lat >= ANCHOR.lat - 1e-9)).toBe(true);
    // ...and turning it 180 swings the same box to the other side of the same anchor.
    const flipped = footprintCorners(ANCHOR, AT_THE_DOOR, 180);
    expect(flipped.every((c) => c.lat <= ANCHOR.lat + 1e-9)).toBe(true);
  });

  it('returns the corners in perimeter order, so the polygon never self-intersects', () => {
    // 0 and 2 are diagonally opposite, as are 1 and 3; a bow-tie would put a pair of them adjacent.
    const corners = footprintCorners(ANCHOR, CENTRED, 33);
    const span = (a: number, b: number): number => haversine(corners[a]!, corners[b]!);
    expect(span(0, 2)).toBeGreaterThan(span(0, 1));
    expect(span(0, 2)).toBeGreaterThan(span(0, 3));
    expect(span(1, 3)).toBeGreaterThan(span(1, 2));
  });

  it('keeps the box the same size and shape at any rotation', () => {
    for (const rotation of [0, 45, 128, 300]) {
      const corners = footprintCorners(ANCHOR, AT_THE_DOOR, rotation);
      expect(haversine(corners[0]!, corners[1]!)).toBeCloseTo(16, 3); // width
      expect(haversine(corners[1]!, corners[2]!)).toBeCloseTo(16, 3); // depth
    }
  });
});

describe('groundReach', () => {
  it('measures to the farthest corner, not to half the width', () => {
    // An off-centre box reaches much further one way than the other, and a grip placed at half the
    // width would end up inside the object it is meant to turn.
    expect(groundReach({ minX: -3, maxX: 3, minZ: -4, maxZ: 4 })).toBeCloseTo(5, 9);
    expect(groundReach({ minX: 0, maxX: 30, minZ: 0, maxZ: 40 })).toBeCloseTo(50, 9);
  });
});

describe('gripPoint', () => {
  const BOX: GroundBox = { minX: -8, maxX: 8, minZ: -16, maxZ: 0 };

  it('bears exactly the rotation, which is what makes the grip readable', () => {
    // Drag the grip to a bearing and the rotation IS that number: no offset, no sign flip, and the
    // readout on the grip is the value that goes into the DSF.
    for (const rotation of [0, 45, 137, 270, 359]) {
      expect(bearingTo(gripPoint(ANCHOR, BOX, rotation, 6))).toBeCloseTo(rotation, 3);
    }
  });

  it('sits clear of the box by the margin asked for', () => {
    expect(distanceTo(gripPoint(ANCHOR, BOX, 0, 6))).toBeCloseTo(groundReach(BOX) + 6, 3);
  });
});

describe('placeholderBox', () => {
  it('is square and centred, because it is a confession of not knowing, not a measurement', () => {
    expect(placeholderBox(5)).toEqual({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 });
  });
});
