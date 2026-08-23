import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { planExport } from '../src/core/export/planExport.js';
import { DEFAULT_PACK_NAME, packFolderName } from '../src/core/export/packName.js';
import type { PlacedObject } from '../src/core/model.js';

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

const TRUCK = 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj';

function object(id: string, lon: number, lat: number, libraryPath = TRUCK): PlacedObject {
  return { id, libraryPath, position: { lon, lat }, rotation: 0 };
}

const plan = (objects: readonly PlacedObject[], packName = 'Santiago', extra = {}) =>
  planExport({ packName, objects, creationAgent: 'XOP-test', md5, ...extra });

describe('packFolderName', () => {
  it('leaves a perfectly ordinary name alone', () => {
    // Spaces and hyphens are legal, and a rule that mangled them would be inventing a restriction
    // the filesystem does not have — "X-Plane Landmarks - Paris" is a real pack on a real disk.
    expect(packFolderName('SCEL apron detail')).toEqual({ folder: 'SCEL apron detail' });
    expect(packFolderName('X-Plane - my stuff')).toEqual({ folder: 'X-Plane - my stuff' });
  });

  it('trims, and falls back when there is nothing left', () => {
    expect(packFolderName('  Santiago  ').folder).toBe('Santiago');
    expect(packFolderName('   ').folder).toBe(DEFAULT_PACK_NAME);
    expect(packFolderName('   ').changed).toContain(DEFAULT_PACK_NAME);
  });

  it('replaces characters a path cannot hold, and says it did', () => {
    const result = packFolderName('SCEL: apron/detail?');
    expect(result.folder).toBe('SCEL_ apron_detail_');
    expect(result.changed).toContain('characters a folder name cannot hold');
  });

  it('drops a trailing dot or space, which Windows would drop anyway', () => {
    // Created as "Santiago." the folder is afterwards called "Santiago", and everything that goes
    // looking for the name it asked for fails to find it.
    const result = packFolderName('Santiago.');
    expect(result.folder).toBe('Santiago');
    expect(result.changed).toContain('trailing dot or space');
  });

  it('refuses the DOS device names, with or without an extension', () => {
    expect(packFolderName('CON').folder).toBe('CON_pack');
    expect(packFolderName('nul').folder).toBe('nul_pack');
    expect(packFolderName('COM1.stuff').folder).toBe('COM1.stuff_pack');
    expect(packFolderName('CON').changed).toContain('Windows reserves');
    // …and does not panic about a name that merely contains one.
    expect(packFolderName('Concepcion')).toEqual({ folder: 'Concepcion' });
  });

  it('truncates a very long name without leaving it ending in a dot', () => {
    const result = packFolderName(`${'a'.repeat(70)}.`);
    expect(result.folder).toHaveLength(64);
    expect(result.folder.endsWith('.')).toBe(false);
  });
});

describe('planExport', () => {
  it('produces one file per tile, named the way X-Plane looks for them', () => {
    const result = plan([object('a', -70.78, -33.37), object('b', 2.33, 48.86)]);
    // Ascending tile order — latitude first, then longitude — so two exports of one project are
    // comparable line by line. Santiago is south of Paris, so Santiago's file comes first.
    expect(result.files.map((file) => file.path)).toEqual([
      'Earth nav data/-40-080/-34-071.dsf',
      'Earth nav data/+40+000/+48+002.dsf',
    ]);
    expect(result.tiles).toEqual([
      { lat: -34, lon: -71 },
      { lat: 48, lon: 2 },
    ]);
  });

  it('writes real DSFs, not placeholders', () => {
    const [file] = plan([object('a', -70.78, -33.37)]).files;
    expect(Buffer.from(file!.bytes.subarray(0, 8)).toString('latin1')).toBe('XPLNEDSF');
  });

  it('hands back the single line the installer will add', () => {
    expect(plan([object('a', -70.78, -33.37)]).sceneryPackLine).toBe(
      'SCENERY_PACK Custom Scenery/Santiago/',
    );
  });

  it('refuses to build a pack out of nothing', () => {
    // A folder with no DSF in it is an installation that looks like it worked and does nothing.
    expect(() => plan([])).toThrow(/nothing placed/i);
  });

  it('passes on the reason a pack name had to change', () => {
    expect(plan([object('a', -70.78, -33.37)], 'CON').packFolder).toBe('CON_pack');
    expect(plan([object('a', -70.78, -33.37)], 'CON').warnings[0]).toContain('Windows reserves');
  });

  it('mentions a project spread across many tiles, and says nothing about one or two', () => {
    const near = plan([object('a', -70.78, -33.37), object('b', -70.78, -34.01)]);
    expect(near.warnings).toEqual([]);

    const far = plan([
      object('a', -70.78, -33.37),
      object('b', 2.33, 48.86),
      object('c', -0.45, 51.47),
    ]);
    expect(far.warnings.join(' ')).toContain('3 one-degree tiles');
  });

  it('warns once per object the installation cannot resolve, however often it was placed', () => {
    // X-Plane answers an unresolvable library path by drawing nothing, silently. This is the last
    // place anybody could be told, and forty copies of one bollard is one problem, not forty.
    const objects = [
      object('a', -70.78, -33.37),
      object('b', -70.78, -33.371, 'lib/gone/shed.obj'),
      object('c', -70.78, -33.372, 'lib/gone/shed.obj'),
    ];
    const result = plan(objects, 'Santiago', { knownLibraryPaths: new Set([TRUCK]) });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('lib/gone/shed.obj');
    expect(result.warnings[0]).toContain('placed 2 times');
    expect(result.warnings[0]).toContain('will not say so');
  });

  it('says nothing about resolvable objects when it is given the catalog', () => {
    const result = plan([object('a', -70.78, -33.37)], 'Santiago', {
      knownLibraryPaths: new Set([TRUCK]),
    });
    expect(result.warnings).toEqual([]);
  });

  it('never emits a path that climbs out of the pack', () => {
    // What makes a name safe is that it cannot be read as more than one path component, not that
    // it avoids dots: a folder literally called ".._.._evil" is a perfectly ordinary
    // folder, and refusing it would be theatre. The separators are what matter, and `..` on its own
    // is not a name at all.
    const result = plan([object('a', -70.78, -33.37), object('b', 2.33, 48.86)], '../../evil');
    expect(result.packFolder).toBe('.._.._evil');
    expect(result.packFolder).not.toMatch(/[/\\]/);

    expect(packFolderName('..').folder).toBe(DEFAULT_PACK_NAME);
    expect(packFolderName('.').folder).toBe(DEFAULT_PACK_NAME);
    expect(packFolderName('..\\..\\evil').folder).not.toMatch(/[/\\]/);

    for (const file of result.files) {
      expect(file.path).not.toContain('..');
      expect(file.path.startsWith('/')).toBe(false);
    }
  });
});
