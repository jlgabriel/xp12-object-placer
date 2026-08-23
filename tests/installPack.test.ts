import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import {
  InstallError,
  installPack,
  listInstalledPacks,
  readPackManifest,
  uninstallPack,
} from '../src/node/installPack.js';
import { planExport } from '../src/core/export/planExport.js';
import type { PlacedObject } from '../src/core/model.js';
import { newProject } from '../src/core/project/project.js';

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

const TRUCK = 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj';

const INI = [
  'I',
  '1000 Version',
  'SCENERY',
  '',
  'SCENERY_PACK Custom Scenery/Aerosoft - LFMN Nice Cote d Azur X/',
  'SCENERY_PACK *GLOBAL_AIRPORTS*',
  'SCENERY_PACK Custom Scenery/X-Plane Landmarks - Paris/',
  '',
].join('\n');

const created: string[] = [];

/** A directory shaped like an X-Plane installation, far away from any real one. */
function installation({ withIni = true }: { withIni?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'xop-install-'));
  created.push(root);
  mkdirSync(join(root, 'Custom Scenery'), { recursive: true });
  mkdirSync(join(root, 'Resources', 'default scenery'), { recursive: true });
  if (withIni) writeFileSync(join(root, 'Custom Scenery', 'scenery_packs.ini'), INI, 'latin1');
  return root;
}

afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

const objects: PlacedObject[] = [
  { id: 'a', libraryPath: TRUCK, position: { lon: -70.78, lat: -33.37 }, rotation: 0 },
  { id: 'b', libraryPath: TRUCK, position: { lon: 2.33, lat: 48.86 }, rotation: 90 },
];

const projectOf = (placed: readonly PlacedObject[]) => ({
  ...newProject('2026-08-22T12:00:00.000Z'),
  objects: placed,
});

const plan = (packName = 'Santiago') =>
  planExport({ packName, project: projectOf(objects), creationAgent: 'XOP-test', md5 });

const readIni = (root: string): string =>
  readFileSync(join(root, 'Custom Scenery', 'scenery_packs.ini'), 'latin1');

describe('installPack', () => {
  it('writes every tile where X-Plane looks for it, and a manifest saying it was us', () => {
    const root = installation();
    const result = installPack(root, plan(), '0.1.0');

    expect(existsSync(join(root, 'Custom Scenery/Santiago/Earth nav data/-40-080/-34-071.dsf'))).toBe(true);
    expect(existsSync(join(root, 'Custom Scenery/Santiago/Earth nav data/+40+000/+48+002.dsf'))).toBe(true);

    const manifest = readPackManifest(join(root, 'Custom Scenery/Santiago'));
    expect(manifest?.packName).toBe('Santiago');
    expect(manifest?.xop).toBe('0.1.0');
    expect(manifest?.files).toEqual(result.files);
  });

  it('writes the file X-Plane can actually load', () => {
    const root = installation();
    installPack(root, plan(), '0.1.0');
    const dsf = readFileSync(join(root, 'Custom Scenery/Santiago/Earth nav data/-40-080/-34-071.dsf'));
    expect(dsf.subarray(0, 8).toString('latin1')).toBe('XPLNEDSF');
  });

  it('adds one line to the ini, at the top of the overlay tier, and backs the file up first', () => {
    const root = installation();
    const result = installPack(root, plan(), '0.1.0');

    expect(result.lineWritten).toBe(true);
    expect(result.placement).toBe('below-global-airports');
    const lines = readIni(root).split('\n');
    expect(lines[lines.indexOf('SCENERY_PACK *GLOBAL_AIRPORTS*') + 1]).toBe(
      'SCENERY_PACK Custom Scenery/Santiago/',
    );

    expect(result.iniBackup).toBeDefined();
    expect(readFileSync(result.iniBackup!, 'latin1')).toBe(INI);
  });

  it('refuses a folder it did not make, whatever the user called their pack', () => {
    // The single worst thing this application could do is delete somebody's scenery because two
    // names collided.
    const root = installation();
    const theirs = join(root, 'Custom Scenery', 'Santiago');
    mkdirSync(theirs, { recursive: true });
    writeFileSync(join(theirs, 'precious.dsf'), 'not ours');

    expect(() => installPack(root, plan(), '0.1.0')).toThrow(InstallError);
    expect(() => installPack(root, plan(), '0.1.0')).toThrow(/was not made by XP Object Placer/);
    expect(readFileSync(join(theirs, 'precious.dsf'), 'utf8')).toBe('not ours');
    // And nothing was written to the ini either — a refusal has to be a whole refusal.
    expect(readIni(root)).toBe(INI);
  });

  it('replaces its own pack on a second export, and does not list it twice', () => {
    const root = installation();
    installPack(root, plan(), '0.1.0');
    const again = installPack(root, plan(), '0.2.0');

    expect(again.lineWritten).toBe(false);
    expect(again.placement).toBe('already-present');
    expect(readIni(root).split('\n').filter((l) => l.includes('/Santiago/'))).toHaveLength(1);
    expect(readPackManifest(join(root, 'Custom Scenery/Santiago'))?.xop).toBe('0.2.0');
  });

  it('leaves nothing behind from a previous export that had more tiles', () => {
    // Overwriting file by file would leave a tile from last time in a pack that no longer contains
    // it, and X-Plane would go on drawing it.
    const root = installation();
    installPack(root, plan(), '0.1.0');

    const single = planExport({
      packName: 'Santiago',
      project: projectOf([objects[0]!]),
      creationAgent: 'XOP-test',
      md5,
    });
    installPack(root, single, '0.1.0');

    expect(existsSync(join(root, 'Custom Scenery/Santiago/Earth nav data/+40+000'))).toBe(false);
    expect(existsSync(join(root, 'Custom Scenery/Santiago/Earth nav data/-40-080'))).toBe(true);
  });

  it('does not invent a scenery_packs.ini that is not there', () => {
    // Writing one would mean inventing the rest of somebody's scenery order. X-Plane makes it
    // itself, and finds the pack — at the bottom, which is worth saying out loud.
    const root = installation({ withIni: false });
    const result = installPack(root, plan(), '0.1.0');

    expect(existsSync(join(root, 'Custom Scenery/scenery_packs.ini'))).toBe(false);
    expect(result.lineWritten).toBe(false);
    expect(result.warnings.join(' ')).toContain('bottom of the list');
    // The pack itself is still installed.
    expect(existsSync(join(root, 'Custom Scenery/Santiago/Earth nav data'))).toBe(true);
  });

  it('leaves a pack the user disabled alone, and says so', () => {
    const root = installation();
    writeFileSync(
      join(root, 'Custom Scenery', 'scenery_packs.ini'),
      INI.replace(
        'SCENERY_PACK *GLOBAL_AIRPORTS*',
        'SCENERY_PACK *GLOBAL_AIRPORTS*\nSCENERY_PACK_DISABLED Custom Scenery/Santiago/',
      ),
      'latin1',
    );
    const result = installPack(root, plan(), '0.1.0');
    expect(result.placement).toBe('disabled-by-user');
    expect(result.warnings.join(' ')).toContain('disabled');
    expect(readIni(root)).toContain('SCENERY_PACK_DISABLED Custom Scenery/Santiago/');
  });

  it('refuses a pack name that would land outside Custom Scenery', () => {
    // planExport sanitises names, so this is the belt to that pair of braces: the module that
    // writes must not depend on the module that plans having been careful.
    const root = installation();
    const escaping = { ...plan(), packFolder: '../evil' };
    expect(() => installPack(root, escaping, '0.1.0')).toThrow(/not a usable pack name/);
    expect(existsSync(join(root, 'evil'))).toBe(false);
  });

  it('refuses an installation with no Custom Scenery in it', () => {
    const root = mkdtempSync(join(tmpdir(), 'xop-empty-'));
    created.push(root);
    expect(() => installPack(root, plan(), '0.1.0')).toThrow(/no "Custom Scenery" folder/);
  });

  it('carries the plan warnings through to whoever shows them', () => {
    const root = installation();
    const withUnknown = planExport({
      packName: 'Santiago',
      project: projectOf([
        ...objects,
        { id: 'c', libraryPath: 'lib/gone/shed.obj', position: { lon: -70.78, lat: -33.371 }, rotation: 0 },
      ]),
      creationAgent: 'XOP-test',
      md5,
      knownLibraryPaths: new Set([TRUCK]),
    });
    expect(installPack(root, withUnknown, '0.1.0').warnings.join(' ')).toContain('lib/gone/shed.obj');
  });
});

describe('uninstallPack', () => {
  it('takes out the folder and the line, and backs the ini up first', () => {
    const root = installation();
    installPack(root, plan(), '0.1.0');

    const result = uninstallPack(root, 'Santiago');
    expect(result.folderRemoved).toBe(true);
    expect(result.linesRemoved).toEqual(['SCENERY_PACK Custom Scenery/Santiago/']);
    expect(existsSync(join(root, 'Custom Scenery/Santiago'))).toBe(false);
    expect(readIni(root)).toBe(INI);
    expect(result.iniBackup).toBeDefined();
  });

  it('will not delete a folder XOP did not make', () => {
    const root = installation();
    const theirs = join(root, 'Custom Scenery', 'Paris');
    mkdirSync(theirs, { recursive: true });
    expect(() => uninstallPack(root, 'Paris')).toThrow(/was not made by XP Object Placer/);
    expect(existsSync(theirs)).toBe(true);
  });

  it('still tidies the line when the folder is already gone', () => {
    // Somebody deleting the folder by hand is the normal way this happens, and a line pointing at
    // nothing is exactly the litter the uninstaller exists to avoid.
    const root = installation();
    installPack(root, plan(), '0.1.0');
    rmSync(join(root, 'Custom Scenery/Santiago'), { recursive: true, force: true });

    const result = uninstallPack(root, 'Santiago');
    expect(result.folderRemoved).toBe(false);
    expect(result.linesRemoved).toHaveLength(1);
    expect(readIni(root)).toBe(INI);
  });

  it('does nothing at all for a pack that was never installed', () => {
    const root = installation();
    const result = uninstallPack(root, 'Santiago');
    expect(result).toEqual({ folderRemoved: false, linesRemoved: [] });
    expect(readIni(root)).toBe(INI);
  });
});

describe('listInstalledPacks', () => {
  it('finds the packs XOP made and ignores everything else', () => {
    const root = installation();
    installPack(root, plan('Santiago'), '0.1.0');
    installPack(root, plan('Paris'), '0.1.0');
    mkdirSync(join(root, 'Custom Scenery', 'Somebody Elses Airport'), { recursive: true });

    expect(listInstalledPacks(root).map((p) => p.packName).sort()).toEqual(['Paris', 'Santiago']);
  });

  it('is empty, not broken, on an installation with nothing in it', () => {
    expect(listInstalledPacks(mkdtempSync(join(tmpdir(), 'xop-none-')))).toEqual([]);
  });
});

describe('what is left in Custom Scenery', () => {
  it('leaves no staging folder behind after a successful install', () => {
    const root = installation();
    installPack(root, plan(), '0.1.0');
    const entries = readdirSync(join(root, 'Custom Scenery'));
    expect(entries.filter((name) => name.includes('.xop-new'))).toEqual([]);
    expect(entries.filter((name) => name.includes('.xop-tmp'))).toEqual([]);
  });
});
