import { describe, expect, it } from 'vitest';
import {
  destination,
  haversine,
  initialBearing,
  normalizeDegrees,
  snapAngle,
  wrapLon,
} from '../src/core/geo/geo.js';

const SCEL = { lon: -70.7858, lat: -33.393 };

describe('haversine and destination', () => {
  it('round-trip: walk a distance on a bearing and it is that far away, on that bearing', () => {
    for (const bearing of [0, 37, 90, 183, 271, 359]) {
      const there = destination(SCEL, 250, bearing);
      expect(haversine(SCEL, there)).toBeCloseTo(250, 6);
      expect(initialBearing(SCEL, there)).toBeCloseTo(bearing, 4);
    }
  });

  it('walks north into a bigger latitude and east into a bigger longitude', () => {
    expect(destination(SCEL, 1000, 0).lat).toBeGreaterThan(SCEL.lat);
    expect(destination(SCEL, 1000, 180).lat).toBeLessThan(SCEL.lat);
    expect(destination(SCEL, 1000, 90).lon).toBeGreaterThan(SCEL.lon);
    expect(destination(SCEL, 1000, 270).lon).toBeLessThan(SCEL.lon);
  });

  it('a degree of latitude is about 111 km, anywhere', () => {
    expect(haversine({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(111195, 0);
    expect(haversine({ lon: -70, lat: -33 }, { lon: -70, lat: -34 })).toBeCloseTo(111195, 0);
  });

  it('a degree of longitude shrinks toward the poles', () => {
    const equator = haversine({ lon: 0, lat: 0 }, { lon: 1, lat: 0 });
    const sixty = haversine({ lon: 0, lat: 60 }, { lon: 1, lat: 60 });
    expect(sixty / equator).toBeCloseTo(0.5, 3); // cos 60 degrees
  });

  it('a zero walk stays put', () => {
    expect(haversine(SCEL, destination(SCEL, 0, 45))).toBeCloseTo(0, 9);
  });
});

describe('wrapLon', () => {
  it('leaves an in-range longitude byte-identical', () => {
    // Not "close to": a coordinate that was already valid must not pick up float noise on its way
    // through, or every saved project would drift a little every time it was touched.
    for (const lon of [0, -70.78462, 179.9999999, -180]) {
      expect(wrapLon(lon)).toBe(lon);
    }
  });

  it('folds a world-copy longitude back onto the same real place', () => {
    // Leaflet hands these out when the map is panned into a repeated copy of the world.
    expect(wrapLon(181)).toBeCloseTo(-179, 9);
    expect(wrapLon(-181)).toBeCloseTo(179, 9);
    expect(wrapLon(360 - 70.5)).toBeCloseTo(-70.5, 9);
    expect(wrapLon(-360 + 12.25)).toBeCloseTo(12.25, 9);
  });

  it('sends exactly 180 to the -180 edge, which is the same meridian', () => {
    expect(wrapLon(180)).toBe(-180);
  });
});

describe('normalizeDegrees and snapAngle', () => {
  it('normalizes into [0, 360)', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(0)).toBe(0);
  });

  it('snaps to the step and wraps 360 back to 0', () => {
    expect(snapAngle(43, 5)).toBe(45);
    expect(snapAngle(42, 5)).toBe(40);
    expect(snapAngle(358.5, 5)).toBe(0);
    expect(snapAngle(-2, 5)).toBe(0);
  });
});
