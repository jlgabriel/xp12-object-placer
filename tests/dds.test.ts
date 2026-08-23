import { describe, expect, it } from 'vitest';
import {
  chooseMipLevel,
  DdsError,
  readDdsHeader,
  readDdsMip,
  textureCandidates,
} from '../src/core/dds/dds.js';

const BLOCK_BYTES = { BC1: 8, BC3: 16 } as const;
const blocksFor = (w: number, h: number): number =>
  Math.ceil(Math.max(1, w) / 4) * Math.ceil(Math.max(1, h) / 4);

/**
 * A DDS shaped like the real ones, with every level filled with its own level number.
 *
 * That fill is the whole trick: reading level 3 and finding nothing but 3s proves the offset
 * arithmetic walked past exactly the right number of earlier levels. A test with zeroed data would
 * pass with the offsets wrong.
 */
function dds(options: {
  format?: 'DXT1' | 'DXT5';
  width?: number;
  height?: number;
  mips?: number;
  fourCC?: string;
  compressed?: boolean;
  truncateAfterLevel?: number;
}): Uint8Array {
  const { width = 256, height = 256, mips = 9, compressed = true } = options;
  const format = options.format ?? 'DXT1';
  const blockBytes = format === 'DXT1' ? 8 : 16;

  const levels: Uint8Array[] = [];
  const stored = options.truncateAfterLevel ?? mips;
  for (let level = 0; level < stored; level += 1) {
    const bytes = blocksFor(width >> level, height >> level) * blockBytes;
    levels.push(new Uint8Array(bytes).fill(level));
  }

  const total = 128 + levels.reduce((n, l) => n + l.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x20534444, true);
  view.setUint32(4, 124, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(28, mips, true);
  view.setUint32(80, compressed ? 0x4 : 0x40, true);
  const code = options.fourCC ?? format;
  for (let i = 0; i < 4; i += 1) view.setUint8(84 + i, code.charCodeAt(i));
  view.setUint32(88, 32, true); // bit count, only read for the uncompressed complaint

  let at = 128;
  for (const level of levels) {
    out.set(level, at);
    at += level.byteLength;
  }
  return out;
}

describe('reading the header', () => {
  it('recognises the two formats the library actually uses', () => {
    expect(readDdsHeader(dds({ format: 'DXT1' })).format).toBe('BC1');
    expect(readDdsHeader(dds({ format: 'DXT5' })).format).toBe('BC3');
  });

  it('reports width, height and mip count', () => {
    expect(readDdsHeader(dds({ width: 2048, height: 1024, mips: 12 }))).toMatchObject({
      width: 2048,
      height: 1024,
      mipCount: 12,
    });
  });

  it('treats a zero mip count as one level, which is what it means', () => {
    expect(readDdsHeader(dds({ mips: 0 })).mipCount).toBe(1);
  });

  // These are the ones that would arrive from a library that is not stock, and the message has to
  // name which, or nobody can tell "unsupported" from "broken".
  it('names the format it cannot read', () => {
    expect(() => readDdsHeader(dds({ fourCC: 'DX10' }))).toThrow(/DX10/);
    expect(() => readDdsHeader(dds({ fourCC: 'ATI2' }))).toThrow(/ATI2/);
    expect(() => readDdsHeader(dds({ compressed: false }))).toThrow(/uncompressed/);
  });

  it('refuses something that is not a DDS at all', () => {
    expect(() => readDdsHeader(new Uint8Array(200))).toThrow(DdsError);
    expect(() => readDdsHeader(new Uint8Array(4))).toThrow(/too short/);
  });
});

describe('choosing a mip', () => {
  const header = { format: 'BC1' as const, width: 2048, height: 2048, mipCount: 12 };

  // A 2048² texture for a 128-pixel thumbnail is four megapixels of decode for sixteen kilopixels
  // of picture. Every file in the library has the smaller levels already sitting in it.
  it('skips down to the smallest level that still covers what was asked for', () => {
    expect(chooseMipLevel(header, 256)).toBe(3); // 2048 >> 3 = 256
    expect(chooseMipLevel(header, 128)).toBe(4);
    expect(chooseMipLevel(header, 2048)).toBe(0);
  });

  it('never goes past the levels the file has', () => {
    expect(chooseMipLevel({ ...header, mipCount: 2 }, 16)).toBe(1);
    expect(chooseMipLevel({ ...header, mipCount: 1 }, 16)).toBe(0);
  });

  it('handles a non-square texture by its longest side', () => {
    expect(chooseMipLevel({ ...header, width: 2048, height: 512 }, 256)).toBe(3);
  });
});

describe('reading a mip', () => {
  it('lands on the right level, not near it', () => {
    const mip = readDdsMip(dds({ width: 256, height: 256, mips: 9 }), 32);
    expect(mip.level).toBe(3);
    expect(mip.width).toBe(32);
    expect(mip.height).toBe(32);
    // Every byte of level 3 was filled with 3 when the file was built.
    expect([...new Set(mip.data)]).toEqual([3]);
  });

  it('gets the length right for both formats', () => {
    for (const [format, expected] of [
      ['DXT1', blocksFor(32, 32) * BLOCK_BYTES.BC1],
      ['DXT5', blocksFor(32, 32) * BLOCK_BYTES.BC3],
    ] as const) {
      const mip = readDdsMip(dds({ format, width: 256, height: 256 }), 32);
      expect(mip.data.byteLength).toBe(expected);
    }
  });

  it('is a view, so nothing is copied on the way to the GPU', () => {
    const bytes = dds({});
    expect(readDdsMip(bytes, 32).data.buffer).toBe(bytes.buffer);
  });

  // A file claiming twelve levels and storing four would otherwise hand WebGL a short buffer, and
  // the error that produces names neither the file nor the reason.
  it('says so when the file stops before the level it advertises', () => {
    const truncated = dds({ width: 256, height: 256, mips: 9, truncateAfterLevel: 2 });
    expect(() => readDdsMip(truncated, 4)).toThrow(/stops before level/);
  });

  it('copes with a mip smaller than one block', () => {
    const mip = readDdsMip(dds({ width: 8, height: 8, mips: 4 }), 1);
    expect(mip.width).toBe(1);
    expect(mip.data.byteLength).toBe(BLOCK_BYTES.BC1);
  });
});

describe('finding the file an OBJ8 means', () => {
  // Measured on a real installation: 3 193 of 3 446 albedo references only resolve after this
  // swap. Trusting the extension in the OBJ renders 93% of the library untextured.
  it('tries the .dds first, whatever the object said', () => {
    expect(textureCandidates('Keypad.png')).toEqual(['Keypad.dds', 'Keypad.png']);
    expect(textureCandidates('../shared/small.png')).toEqual([
      '../shared/small.dds',
      '../shared/small.png',
    ]);
  });

  it('does not offer the same file twice when it was already a dds', () => {
    expect(textureCandidates('hangars_2_ALB.dds')).toEqual(['hangars_2_ALB.dds']);
    expect(textureCandidates('SHOUTING.DDS')).toEqual(['SHOUTING.DDS']);
  });

  it('leaves a dot in a directory name alone', () => {
    expect(textureCandidates('../v1.2/tex.png')).toEqual(['../v1.2/tex.dds', '../v1.2/tex.png']);
  });
});

/**
 * The positive control: real files, from a real installation.
 *
 * Synthetic DDS files prove the arithmetic and prove nothing about the library. This reads what
 * X-Plane actually ships. It is skipped when there is no installation to point at, exactly like
 * the DSFTool control, and nothing from Laminar is ever committed here:
 *
 *   XOP_XPLANE="D:/Laminar/XP12-Last-Release/X-Plane 12" npx vitest run
 */
const installation = process.env.XOP_XPLANE;
describe.skipIf(!installation)('against a real installation', () => {
  const found: string[] = [];

  it('finds DDS files where the library keeps them', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const walk = (dir: string, depth: number): void => {
      if (depth > 4 || found.length >= 25) return;
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (found.length >= 25) return;
        const path = join(dir, entry);
        let isDirectory = false;
        try {
          isDirectory = statSync(path).isDirectory();
        } catch {
          continue;
        }
        if (isDirectory) walk(path, depth + 1);
        else if (entry.toLowerCase().endsWith('.dds')) found.push(path);
      }
    };
    walk(join(installation!, 'Resources', 'default scenery'), 0);
    expect(found.length).toBeGreaterThan(0);
  });

  it('reads every one of them as DXT1 or DXT5 with mipmaps', async () => {
    const { readFileSync } = await import('node:fs');
    expect(found.length).toBeGreaterThan(0);

    for (const file of found) {
      const header = readDdsHeader(readFileSync(file));
      expect(['BC1', 'BC3']).toContain(header.format);
      expect(header.mipCount).toBeGreaterThan(1);
    }
  });

  it('lands inside the file when asked for a thumbnail-sized level', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of found) {
      const bytes = readFileSync(file);
      const mip = readDdsMip(bytes, 256);
      expect(Math.max(mip.width, mip.height)).toBeGreaterThanOrEqual(
        Math.min(256, Math.max(readDdsHeader(bytes).width, readDdsHeader(bytes).height)),
      );
      expect(mip.data.byteLength).toBeGreaterThan(0);
    }
  });
});
