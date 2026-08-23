/**
 * The promises a pack makes to every future version.
 *
 * An exported pack is written into somebody's simulator and stays there. It outlives the build that
 * wrote it, the project file it came from, and very likely the user's memory of making it. So two
 * things about it are frozen as of 1.0:
 *
 *   1. `xop-pack.json` with a non-empty `packName` is what marks a folder as ours.
 *   2. `SCENERY_PACK Custom Scenery/<folder>/` is the line, and removal finds it.
 *
 * Everything here is checked against **literal fixtures** rather than against whatever the code
 * currently produces. A test that builds its expectation by calling the code under test passes
 * happily through a change of format, which is exactly the change this file exists to catch.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { installPack, readPackManifest, uninstallPack } from '../src/node/installPack.js';
import { planExport } from '../src/core/export/planExport.js';
import { sceneryPackLine } from '../src/core/install/sceneryPacksIni.js';
import { newProject } from '../src/core/project/project.js';
import type { PlacedObject } from '../src/core/model.js';

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

const TRUCK = 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj';
const OBJECTS: PlacedObject[] = [
  { id: 'obj-1', libraryPath: TRUCK, position: { lon: -70.78, lat: -33.37 }, rotation: 0 },
];

const INI = [
  'I',
  '1000 Version',
  'SCENERY',
  '',
  'SCENERY_PACK *GLOBAL_AIRPORTS*',
  '',
].join('\n');

const created: string[] = [];
function installation(): string {
  const root = mkdtempSync(join(tmpdir(), 'xop-contract-'));
  created.push(root);
  mkdirSync(join(root, 'Custom Scenery'), { recursive: true });
  mkdirSync(join(root, 'Resources', 'default scenery'), { recursive: true });
  writeFileSync(join(root, 'Custom Scenery', 'scenery_packs.ini'), INI, 'latin1');
  return root;
}
afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

const plan = (packName = 'Santiago') =>
  planExport({
    packName,
    project: { ...newProject('2026-08-22T12:00:00.000Z'), objects: OBJECTS },
    creationAgent: 'XOP-test',
    md5,
  });

/** Put a folder in Custom Scenery with exactly this manifest text, and nothing else. */
function pack(root: string, folder: string, manifestText: string | null): string {
  const packRoot = join(root, 'Custom Scenery', folder);
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(join(packRoot, 'placeholder.dsf'), 'not a real dsf');
  if (manifestText !== null) writeFileSync(join(packRoot, 'xop-pack.json'), manifestText, 'utf8');
  return packRoot;
}

/**
 * The manifest exactly as 1.0 writes it.
 *
 * Copied out of a real install rather than generated here. If a field is renamed or removed, the
 * next assertion fails and somebody has to decide, on purpose, what happens to the packs already
 * on disk.
 */
const MANIFEST_1_0 = JSON.stringify(
  {
    manifest: 1,
    xop: '1.0.0',
    packName: 'Santiago',
    writtenAt: '2026-08-22T12:00:00.000Z',
    files: ['Earth nav data/-40-080/-34-071.dsf', 'project.xop'],
  },
  null,
  2,
);

describe('what 1.0 writes', () => {
  it('is a manifest of exactly these fields', () => {
    const root = installation();
    installPack(root, plan(), '1.0.0');

    const written = JSON.parse(
      readFileSync(join(root, 'Custom Scenery', 'Santiago', 'xop-pack.json'), 'utf8'),
    ) as Record<string, unknown>;

    // Names and types, against a literal. Adding a field is safe and will not fail this; renaming
    // or dropping one is what has to be a decision rather than an accident.
    expect(Object.keys(written).sort()).toEqual(
      ['files', 'manifest', 'packName', 'writtenAt', 'xop'].sort(),
    );
    expect(written.manifest).toBe(1);
    expect(written.packName).toBe('Santiago');
    expect(typeof written.xop).toBe('string');
    expect(typeof written.writtenAt).toBe('string');
    expect(Array.isArray(written.files)).toBe(true);
  });

  it('is this exact line in scenery_packs.ini', () => {
    expect(sceneryPackLine('Santiago')).toBe('SCENERY_PACK Custom Scenery/Santiago/');
    // Relative, always. An absolute path in this file is never correct, and a pack that wrote one
    // would load on the machine that made it and nowhere else.
    expect(sceneryPackLine('Santiago')).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(sceneryPackLine('X-Plane Landmarks - Paris')).toBe(
      'SCENERY_PACK Custom Scenery/X-Plane Landmarks - Paris/',
    );
  });

  it('puts the line into the file verbatim', () => {
    const root = installation();
    const result = installPack(root, plan(), '1.0.0');
    const ini = readFileSync(join(root, 'Custom Scenery', 'scenery_packs.ini'), 'latin1');

    expect(result.line).toBe('SCENERY_PACK Custom Scenery/Santiago/');
    expect(ini.split(/\r?\n/)).toContain('SCENERY_PACK Custom Scenery/Santiago/');
  });
});

describe('a pack this build did not write', () => {
  // The promise that matters most: whatever ships next has to be able to remove what 1.0 left
  // behind. A user who updates and then cannot uninstall their own scenery has to go and find the
  // folder by hand, in a directory full of other people's work.
  it('written by 1.0, is still ours and still removable', () => {
    const root = installation();
    pack(root, 'Santiago', MANIFEST_1_0);

    expect(readPackManifest(join(root, 'Custom Scenery', 'Santiago'))?.packName).toBe('Santiago');
    expect(uninstallPack(root, 'Santiago').folderRemoved).toBe(true);
    expect(existsSync(join(root, 'Custom Scenery', 'Santiago'))).toBe(false);
  });

  // The same promise in the other direction. Refusing a pack from a newer build would leave a
  // folder nobody can uninstall except with a file manager.
  it('written by a version that does not exist yet, is still ours', () => {
    const root = installation();
    pack(
      root,
      'FromTheFuture',
      JSON.stringify({
        manifest: 99,
        xop: '4.0.0',
        packName: 'FromTheFuture',
        writtenAt: '2031-01-01T00:00:00.000Z',
        files: [],
        somethingInvented: { deeply: ['nested'] },
      }),
    );

    expect(readPackManifest(join(root, 'Custom Scenery', 'FromTheFuture'))?.manifest).toBe(99);
    expect(uninstallPack(root, 'FromTheFuture').folderRemoved).toBe(true);
  });

  it('written before 1.0, with no version field at all, is still ours', () => {
    const root = installation();
    pack(
      root,
      'Early',
      JSON.stringify({ xop: '0.0.0', packName: 'Early', writtenAt: '', files: [] }),
    );

    expect(readPackManifest(join(root, 'Custom Scenery', 'Early'))?.manifest).toBe(1);
    expect(uninstallPack(root, 'Early').folderRemoved).toBe(true);
  });

  it('can be overwritten by an export under the same name', () => {
    const root = installation();
    pack(root, 'Santiago', MANIFEST_1_0);
    expect(() => installPack(root, plan(), '1.1.0')).not.toThrow();
  });
});

describe('a folder that is not ours', () => {
  // This application deletes folders it believes are its own, so what counts as "its own" is the
  // most dangerous judgement it makes.
  it('is refused when the manifest is missing', () => {
    const root = installation();
    pack(root, 'Aerosoft - LFMN', null);

    expect(readPackManifest(join(root, 'Custom Scenery', 'Aerosoft - LFMN'))).toBeNull();
    expect(() => uninstallPack(root, 'Aerosoft - LFMN')).toThrow(/was not made by/);
    expect(existsSync(join(root, 'Custom Scenery', 'Aerosoft - LFMN'))).toBe(true);
  });

  // An earlier version of the reader returned whatever JSON.parse produced, so every one of these
  // marked the folder as ours — and ours means deletable.
  it.each([
    ['an empty object', '{}'],
    ['a number', '0'],
    ['a string', '"hello"'],
    ['an array', '[{"packName":"Santiago"}]'],
    ['null', 'null'],
    ['a packName that is empty', '{"packName":""}'],
    ['a packName that is not a string', '{"packName":123}'],
    ['not JSON at all', 'this is not json'],
  ])('is refused when the manifest is %s', (_name, text) => {
    const root = installation();
    pack(root, 'Somebody Else', text);

    expect(readPackManifest(join(root, 'Custom Scenery', 'Somebody Else'))).toBeNull();
    expect(() => uninstallPack(root, 'Somebody Else')).toThrow(/was not made by/);
    expect(existsSync(join(root, 'Custom Scenery', 'Somebody Else'))).toBe(true);
  });
});
