import { describe, expect, it } from 'vitest';
import {
  blockFolderName,
  dsfTileOf,
  groupByTile,
  tileFileName,
  tilePath,
} from '../src/core/dsf/tile.js';
import type { PlacedObject } from '../src/core/model.js';

describe('dsfTileOf', () => {
  it('floors, and does not truncate toward zero', () => {
    // The trap: truncation gives -33 and -70, and the objects land in a file nobody reads.
    expect(dsfTileOf({ lon: -70.7846, lat: -33.376 })).toEqual({ lat: -34, lon: -71 });
    expect(dsfTileOf({ lon: 2.3376, lat: 48.8606 })).toEqual({ lat: 48, lon: 2 });
  });

  it('puts an exact integer coordinate in the tile it opens', () => {
    expect(dsfTileOf({ lon: -71, lat: -34 })).toEqual({ lat: -34, lon: -71 });
  });

  it('handles the equator and the prime meridian', () => {
    expect(dsfTileOf({ lon: 0.5, lat: 0.5 })).toEqual({ lat: 0, lon: 0 });
    expect(dsfTileOf({ lon: -0.5, lat: -0.5 })).toEqual({ lat: -1, lon: -1 });
  });
});

describe('tileFileName', () => {
  it('matches the names X-Plane ships', () => {
    // Read off the stock Paris landmarks pack and the H0 probe.
    expect(tileFileName({ lat: 48, lon: 2 })).toBe('+48+002.dsf');
    expect(tileFileName({ lat: -34, lon: -71 })).toBe('-34-071.dsf');
  });

  it('signs zero as positive, the way the folders on disk do', () => {
    expect(tileFileName({ lat: 0, lon: 0 })).toBe('+00+000.dsf');
  });
});

describe('blockFolderName', () => {
  it('floors to a multiple of ten, in both hemispheres', () => {
    expect(blockFolderName({ lat: 48, lon: 2 })).toBe('+40+000');
    expect(blockFolderName({ lat: -34, lon: -71 })).toBe('-40-080');
  });

  it('keeps a tile on a block boundary inside its own block', () => {
    expect(blockFolderName({ lat: -40, lon: -80 })).toBe('-40-080');
    expect(blockFolderName({ lat: -31, lon: -70 })).toBe('-40-070');
  });
});

describe('tilePath', () => {
  it('reproduces the path of the H0 probe', () => {
    expect(tilePath({ lat: -34, lon: -71 })).toBe('Earth nav data/-40-080/-34-071.dsf');
  });
});

function at(id: string, lon: number, lat: number): PlacedObject {
  return { id, libraryPath: 'lib/test/thing.obj', position: { lon, lat }, rotation: 0 };
}

describe('groupByTile', () => {
  it('keeps a placement that fits in one tile together', () => {
    const groups = groupByTile([at('a', -70.78, -33.37), at('b', -70.79, -33.38)]);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]!.objects.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('splits a placement that straddles a boundary', () => {
    const groups = groupByTile([
      at('north', -70.9, -33.99),
      at('south', -70.96, -34.01),
    ]);
    expect(groups.size).toBe(2);
    const tiles = [...groups.values()].map((g) => g.tile);
    expect(tiles).toEqual([
      { lat: -35, lon: -71 },
      { lat: -34, lon: -71 },
    ]);
  });

  it('is deterministic regardless of input order', () => {
    const forward = groupByTile([at('a', 0.5, 0.5), at('b', 1.5, 1.5), at('c', -0.5, -0.5)]);
    const backward = groupByTile([at('c', -0.5, -0.5), at('b', 1.5, 1.5), at('a', 0.5, 0.5)]);
    expect([...forward.keys()]).toEqual([...backward.keys()]);
  });

  it('preserves object order within a tile', () => {
    const groups = groupByTile([at('1', 0.1, 0.1), at('2', 0.2, 0.2), at('3', 0.3, 0.3)]);
    expect([...groups.values()][0]!.objects.map((o) => o.id)).toEqual(['1', '2', '3']);
  });
});
