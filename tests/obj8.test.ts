import { describe, expect, it } from 'vitest';
import { belowGround, parseObj8, sizeOf } from '../src/core/obj8/parse.js';

/**
 * Fixtures are built with real TAB separators on purpose. Stock X-Plane objects are tab-delimited,
 * and a parser written against space-delimited examples reads zero vertices from every one of them
 * without raising anything — which is exactly what happened the first time (reference/obj8.md).
 */
const T = '\t';

function obj(body: string[]): string {
  return ['I', '800', 'OBJ', '', ...body].join('\n');
}

/** A unit cube, 2 m on each side, sitting on the ground. 8 vertices, 12 triangles. */
function cubeVertices(scale = 1, yOffset = 0): string[] {
  const corners = [
    [-1, 0, -1],
    [1, 0, -1],
    [1, 0, 1],
    [-1, 0, 1],
    [-1, 2, -1],
    [1, 2, -1],
    [1, 2, 1],
    [-1, 2, 1],
  ];
  return corners.map(
    ([x, y, z]) =>
      `VT${T}${x! * scale}${T}${y! * scale + yOffset}${T}${z! * scale}${T}0${T}1${T}0${T}0${T}0`,
  );
}

describe('parseObj8 header', () => {
  it('accepts both line-ending markers', () => {
    expect(() => parseObj8(obj([]))).not.toThrow();
    expect(() => parseObj8(['A', '800', 'OBJ'].join('\n'))).not.toThrow();
  });

  it('rejects anything that is not OBJ8', () => {
    expect(() => parseObj8('X\n800\nOBJ')).toThrow(/I\/A/);
    expect(() => parseObj8('I\n700\nOBJ')).toThrow(/Unsupported OBJ version/);
    expect(() => parseObj8('I\n800\nLIBRARY')).toThrow(/not OBJ/);
  });

  it('survives comments and blank lines in the header', () => {
    const text = ['I', '', '# made by somebody', '800', '', 'OBJ', ''].join('\n');
    expect(() => parseObj8(text)).not.toThrow();
  });
});

describe('parseObj8 geometry', () => {
  it('reads TAB-delimited vertices', () => {
    const geometry = parseObj8(obj(cubeVertices()));
    expect(geometry.vertexCount).toBe(8);
  });

  it('measures only the vertices the triangles actually reach', () => {
    // Ten vertices, but the triangles only touch the first three.
    const body = [
      ...cubeVertices(),
      `VT${T}100${T}100${T}100${T}0${T}1${T}0${T}0${T}0`,
      `VT${T}-100${T}-100${T}-100${T}0${T}1${T}0${T}0${T}0`,
      `IDX${T}0`,
      `IDX${T}1`,
      `IDX${T}2`,
      `TRIS${T}0${T}3`,
    ];
    const geometry = parseObj8(obj(body));
    expect(geometry.vertexCount).toBe(10);
    expect(geometry.bounds).toEqual({ min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 0, z: 1 } });
  });

  it('reads IDX10 lines, which carry ten indices at once', () => {
    const body = [
      ...cubeVertices(),
      `IDX10${T}0${T}1${T}2${T}3${T}4${T}5${T}6${T}7${T}0${T}1`,
      `TRIS${T}0${T}9`,
    ];
    const geometry = parseObj8(obj(body));
    expect(geometry.bounds).toEqual({ min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } });
  });

  it('returns null bounds when nothing is drawn', () => {
    expect(parseObj8(obj(cubeVertices())).bounds).toBeNull();
  });
});

describe('parseObj8 LODs', () => {
  it('keeps every block whose near distance is zero, and drops the far ones', () => {
    // Stock objects really do ship two blocks both starting at 0 — they are drawn together, not as
    // alternatives. Keeping only the first would lose the main body of the object.
    const body = [
      ...cubeVertices(),
      `VT${T}50${T}0${T}50${T}0${T}1${T}0${T}0${T}0`,
      `IDX${T}0`,
      `IDX${T}1`,
      `IDX${T}2`,
      `IDX${T}8`,
      `ATTR_LOD${T}0${T}500`,
      `TRIS${T}0${T}3`,
      `ATTR_LOD${T}0${T}1500`,
      `TRIS${T}0${T}3`,
      `ATTR_LOD${T}1500${T}6000`,
      `TRIS${T}3${T}1`, // the far LOD reaches the distant vertex; it must not count
    ];
    const geometry = parseObj8(obj(body));
    expect(geometry.lods).toEqual([
      { near: 0, far: 500 },
      { near: 0, far: 1500 },
      { near: 1500, far: 6000 },
    ]);
    expect(geometry.bounds!.max.x).toBe(1);
  });

  it('draws everything when the object declares no LOD at all', () => {
    const body = [...cubeVertices(), `IDX${T}0`, `IDX${T}1`, `IDX${T}6`, `TRIS${T}0${T}3`];
    expect(parseObj8(obj(body)).bounds!.max.y).toBe(2);
  });
});

describe('parseObj8 draped geometry', () => {
  it('keeps ground decal out of the solid bounds and reports it separately', () => {
    // A hangar with an apron painted around it. The apron is far wider than the building, and a
    // footprint drawn from the combined bounds would be several times too large.
    const body = [
      ...cubeVertices(),
      `VT${T}-40${T}0${T}-40${T}0${T}1${T}0${T}0${T}0`,
      `VT${T}40${T}0${T}40${T}0${T}1${T}0${T}0${T}0`,
      `VT${T}40${T}0${T}-40${T}0${T}1${T}0${T}0${T}0`,
      `IDX${T}0`,
      `IDX${T}1`,
      `IDX${T}6`,
      `IDX${T}8`,
      `IDX${T}9`,
      `IDX${T}10`,
      `TRIS${T}0${T}3`,
      'ATTR_draped',
      `TRIS${T}3${T}3`,
      'ATTR_no_draped',
    ];
    const geometry = parseObj8(obj(body));
    expect(sizeOf(geometry.bounds!)).toEqual({ width: 2, height: 2, depth: 2 });
    expect(sizeOf(geometry.drapedBounds!)).toEqual({ width: 80, height: 0, depth: 80 });
    expect(geometry.triangleCount).toBe(1);
  });
});

describe('parseObj8 metadata', () => {
  it('picks up the texture family, including the one with a leading number', () => {
    const geometry = parseObj8(
      obj([
        `TEXTURE${T}building.dds`,
        `TEXTURE_LIT${T}building_LIT.dds`,
        `TEXTURE_NORMAL${T}building_NML.png`,
        `TEXTURE_DRAPED${T}apron.dds`,
        `TEXTURE_DRAPED_NORMAL${T}1.0${T}apron_NML.png`,
      ]),
    );
    expect(geometry.textures).toEqual({
      albedo: 'building.dds',
      lit: 'building_LIT.dds',
      normal: 'building_NML.png',
      draped: 'apron.dds',
    });
  });

  it('notices animation', () => {
    expect(parseObj8(obj([])).hasAnimation).toBe(false);
    expect(parseObj8(obj(['ANIM_begin', 'ANIM_end'])).hasAnimation).toBe(true);
  });
});

describe('sizeOf and belowGround', () => {
  it('reports the height above ground, not the raw vertical extent', () => {
    // The stock 16x16 hangar has foundations 1.5 m down. Its useful height is what shows.
    const bounds = { min: { x: -8, y: -1.5, z: -8 }, max: { x: 8, y: 6, z: 8 } };
    expect(sizeOf(bounds)).toEqual({ width: 16, height: 6, depth: 16 });
    expect(belowGround(bounds)).toBe(1.5);
  });

  it('reports no burial when the object sits on the plane', () => {
    expect(belowGround({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } })).toBe(0);
  });
});
