import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintAptDats, findAptDatFiles, scanAirports } from '../src/node/scanAirports.js';

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A directory shaped like an X-Plane installation, far away from any real one. */
function installation(): string {
  const root = mkdtempSync(join(tmpdir(), 'xop-airports-'));
  created.push(root);
  mkdirSync(join(root, 'Custom Scenery'), { recursive: true });
  return root;
}

/** Write an `apt.dat` into a scenery package, creating the package as it goes. */
function aptDat(root: string, packageDir: string, rows: readonly string[]): void {
  const dir = join(root, ...packageDir.split('/'), 'Earth nav data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'apt.dat'), ['I', '1200 test', '', ...rows, ''].join('\n'), 'utf8');
}

/** One heliport, complete enough to be read: a header and a place. */
function airport(id: string, name: string, lat: number, lon: number, icao?: string): string[] {
  return [
    `17 0 0 0 ${id} ${name}`,
    ...(icao === undefined ? [] : [`1302 icao_code ${icao}`]),
    `102 H1 ${lat} ${lon} 0.0 12.00 12.00 15 0 0 0.00 0`,
  ];
}

function ini(root: string, lines: readonly string[]): void {
  writeFileSync(
    join(root, 'Custom Scenery', 'scenery_packs.ini'),
    ['I', '1000 Version', 'SCENERY', '', ...lines, ''].join('\n'),
    'utf8',
  );
}

const GLOBAL = 'Global Scenery/Global Airports';

describe('finding the apt.dat files of an installation', () => {
  it('reads the global file and the packs, in the order the ini puts them', async () => {
    const root = installation();
    aptDat(root, GLOBAL, airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));
    aptDat(root, 'Custom Scenery/KBLU Redone', airport('KBLU', 'Blue Canyon by hand', 39.28, -120.72));
    ini(root, ['SCENERY_PACK Custom Scenery/KBLU Redone/', 'SCENERY_PACK *GLOBAL_AIRPORTS*']);

    const { airports } = await scanAirports(root);
    expect(airports).toHaveLength(1);
    // The pack is listed above the global airports, so the pack's description is the one X-Plane
    // uses, and it is the one this list carries.
    expect(airports[0]?.name).toBe('Blue Canyon by hand');
  });

  it('lets the global file win when the ini puts it first', async () => {
    const root = installation();
    aptDat(root, GLOBAL, airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));
    aptDat(root, 'Custom Scenery/KBLU Redone', airport('KBLU', 'Blue Canyon by hand', 39.28, -120.72));
    ini(root, ['SCENERY_PACK *GLOBAL_AIRPORTS*', 'SCENERY_PACK Custom Scenery/KBLU Redone/']);

    const { airports } = await scanAirports(root);
    expect(airports.map((a) => a.name)).toEqual(['Blue Canyon Nyack']);
  });

  it('brings in the airports a pack adds that the global file has never heard of', async () => {
    const root = installation();
    aptDat(root, GLOBAL, airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));
    aptDat(root, 'Custom Scenery/B314 Sealanes', airport('314NZ', 'Auckland Sealane', -36.84, 174.75));
    ini(root, ['SCENERY_PACK Custom Scenery/B314 Sealanes/', 'SCENERY_PACK *GLOBAL_AIRPORTS*']);

    const { airports } = await scanAirports(root);
    expect(airports.map((a) => a.id).sort()).toEqual(['314NZ', 'KBLU']);
  });

  it('leaves out a pack the user switched off', async () => {
    const root = installation();
    aptDat(root, 'Custom Scenery/Off', airport('XOFF', 'Switched Off', 1, 1));
    aptDat(root, GLOBAL, airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));
    ini(root, ['SCENERY_PACK_DISABLED Custom Scenery/Off/', 'SCENERY_PACK *GLOBAL_AIRPORTS*']);

    const { airports } = await scanAirports(root);
    expect(airports.map((a) => a.id)).toEqual(['KBLU']);
  });

  /**
   * X-Plane writes this file when it starts, so a pack dropped in since then is not in it yet — and
   * the pack the user just installed is exactly the one they are most likely to go looking for.
   */
  it('finds a pack the ini does not mention, below the ones it does', async () => {
    const root = installation();
    aptDat(root, 'Custom Scenery/Listed', airport('XLIS', 'Listed', 1, 1));
    aptDat(root, 'Custom Scenery/Unlisted', airport('XUNL', 'Unlisted', 2, 2));
    ini(root, ['SCENERY_PACK Custom Scenery/Listed/']);

    const found = findAptDatFiles(root);
    expect(found[0]).toContain('Listed');
    expect(found[1]).toContain('Unlisted');
  });

  it('reads an installation with no ini at all', async () => {
    const root = installation();
    aptDat(root, 'Custom Scenery/Pack', airport('XPCK', 'Pack', 1, 1));
    aptDat(root, GLOBAL, airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));

    const { airports } = await scanAirports(root);
    expect(airports.map((a) => a.id).sort()).toEqual(['KBLU', 'XPCK']);
  });

  /** Where X-Plane 11 kept them. Cheap to look, and free when the folder is not there. */
  it('finds global airports in the place X-Plane 11 kept them', async () => {
    const root = installation();
    aptDat(root, 'Custom Scenery/Global Airports', airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));

    const { airports } = await scanAirports(root);
    expect(airports.map((a) => a.id)).toEqual(['KBLU']);
  });

  /**
   * The ini is hand-edited text that also gets written by third-party tools. A line pointing out of
   * the installation is refused, the same way library paths are — one bad line costs that entry.
   */
  it('refuses an ini line that points outside the installation', async () => {
    const root = installation();
    aptDat(root, GLOBAL, airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));
    ini(root, ['SCENERY_PACK ../../elsewhere/', 'SCENERY_PACK *GLOBAL_AIRPORTS*']);

    const found = findAptDatFiles(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('Global Airports');
  });

  /**
   * A file never suppresses itself. In the shipped Global Airports file one row's identifier is
   * another row's declared ICAO code — `PAKX` is an airport, and `PALJ` declares `PAKX` as well —
   * and 20 real airports disappeared while the two were treated as one.
   */
  it('keeps both when one file uses a code as an identifier and as another airport ICAO', async () => {
    const root = installation();
    aptDat(root, GLOBAL, [
      ...airport('PAKX', 'Kalskag', 61.5, -160.3),
      ...airport('PALJ', 'Wilder Runway', 61.6, -160.4, 'PAKX'),
    ]);

    const { airports } = await scanAirports(root);
    expect(airports.map((a) => a.id)).toEqual(['PAKX', 'PALJ']);
  });

  it('treats two names for one airport as one airport', async () => {
    const root = installation();
    aptDat(root, 'Custom Scenery/Hopen', airport('XEN001Z', 'Hopen Station', 76.5, 25.0, 'ENHO'));
    aptDat(root, GLOBAL, airport('ENHO', 'Hopen', 76.5, 25.0));
    ini(root, ['SCENERY_PACK Custom Scenery/Hopen/', 'SCENERY_PACK *GLOBAL_AIRPORTS*']);

    const { airports } = await scanAirports(root);
    expect(airports).toHaveLength(1);
    expect(airports[0]?.icao).toBe('ENHO');
  });

  it('says which files it read, and what state they were in', async () => {
    const root = installation();
    aptDat(root, GLOBAL, airport('KBLU', 'Blue Canyon Nyack', 39.27, -120.71));
    ini(root, ['SCENERY_PACK *GLOBAL_AIRPORTS*']);

    const { sources } = await scanAirports(root);
    const fingerprint = fingerprintAptDats(root);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.airports).toBe(1);
    // Same files, same state — which is the whole basis on which the cache decides it is current.
    expect(fingerprint.map((f) => f.path)).toEqual(sources.map((s) => s.path));
    expect(fingerprint[0]?.size).toBe(sources[0]?.size);
  });

  it('reads a file written with CRLF, and one with a byte-order mark', async () => {
    const root = installation();
    const dir = join(root, 'Custom Scenery', 'Windows Pack', 'Earth nav data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'apt.dat'),
      '﻿I\r\n1200 test\r\n' + airport('XCRL', 'Crlf', 3, 4).join('\r\n') + '\r\n',
      'utf8',
    );

    const { airports } = await scanAirports(root);
    expect(airports.map((a) => a.id)).toEqual(['XCRL']);
  });
});
