import { describe, expect, it } from 'vitest';
import {
  insertSceneryPack,
  removeSceneryPack,
  sceneryEntries,
  sceneryPackLine,
} from '../src/core/install/sceneryPacksIni.js';

/**
 * Shaped after the real file in the author's installation: the `I` / version / `SCENERY` header,
 * custom airports on top, the `*GLOBAL_AIRPORTS*` marker, then overlays, then libraries, then
 * photoscenery last — including a third-party tool's absolute path, which is exactly the kind of
 * line XOP must leave alone.
 */
const INI = [
  'I',
  '1000 Version',
  'SCENERY',
  '',
  'SCENERY_PACK Custom Scenery/Aerosoft - LFMN Nice Cote d Azur X/',
  'SCENERY_PACK Custom Scenery/X-Plane Airports - EGPR Barra/',
  'SCENERY_PACK *GLOBAL_AIRPORTS*',
  'SCENERY_PACK Custom Scenery/X-Plane Landmarks - Paris/',
  'SCENERY_PACK Custom Scenery/X-Codr Designs Library/',
  'SCENERY_PACK D:\\Simuladores\\XPlane Map Enhancement Base\\XPME_South_America/',
  '',
].join('\n');

const lines = (text: string): string[] => text.split(/\r\n|\n/);

describe('sceneryPackLine', () => {
  it('is always relative, because an absolute path in this file is never right', () => {
    expect(sceneryPackLine('Santiago')).toBe('SCENERY_PACK Custom Scenery/Santiago/');
  });
});

describe('insertSceneryPack', () => {
  it('puts the pack at the top of the overlay tier, right below the marker', () => {
    // D8: above other overlays, because these objects are something the user placed one by one and
    // their own work should win; below custom airports, because an XOP pack is never an airport.
    const result = insertSceneryPack(INI, 'Santiago');
    expect(result.changed).toBe(true);
    expect(result.placement).toBe('below-global-airports');

    const after = lines(result.text);
    const marker = after.indexOf('SCENERY_PACK *GLOBAL_AIRPORTS*');
    expect(after[marker + 1]).toBe('SCENERY_PACK Custom Scenery/Santiago/');
  });

  it('changes exactly one line and reorders nothing', () => {
    // The rest of this file belongs to somebody else — the user, X-Plane, and other tools all
    // write to it. Being a good guest is the whole design.
    const before = lines(INI);
    const after = lines(insertSceneryPack(INI, 'Santiago').text);
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((line) => line !== 'SCENERY_PACK Custom Scenery/Santiago/')).toEqual(before);
  });

  it('adds nothing the second time', () => {
    const once = insertSceneryPack(INI, 'Santiago');
    const twice = insertSceneryPack(once.text, 'Santiago');
    expect(twice.changed).toBe(false);
    expect(twice.placement).toBe('already-present');
    expect(twice.text).toBe(once.text);
  });

  it('recognises the pack however the line was written', () => {
    // X-Plane writes a trailing slash, a person might not, and Windows does not care about case.
    // Being strict here would mean listing the same folder twice.
    for (const existing of [
      'SCENERY_PACK Custom Scenery/santiago/',
      'SCENERY_PACK Custom Scenery/Santiago',
      'SCENERY_PACK Custom Scenery\\Santiago\\',
      '  SCENERY_PACK Custom Scenery/Santiago/  ',
    ]) {
      const withIt = INI.replace('SCENERY_PACK *GLOBAL_AIRPORTS*', `SCENERY_PACK *GLOBAL_AIRPORTS*\n${existing}`);
      expect(insertSceneryPack(withIt, 'Santiago').changed).toBe(false);
    }
  });

  it('leaves a pack the user switched off switched off', () => {
    // Turning it back on would override a decision somebody made deliberately, in their own file.
    const disabled = INI.replace(
      'SCENERY_PACK *GLOBAL_AIRPORTS*',
      'SCENERY_PACK *GLOBAL_AIRPORTS*\nSCENERY_PACK_DISABLED Custom Scenery/Santiago/',
    );
    const result = insertSceneryPack(disabled, 'Santiago');
    expect(result.changed).toBe(false);
    expect(result.placement).toBe('disabled-by-user');
    expect(result.text).toBe(disabled);
  });

  it('appends when there is no marker to aim at, and says that is what it did', () => {
    // Without *GLOBAL_AIRPORTS* there is no way to tell where the airport tier ends, and guessing
    // would mean silently outranking somebody's custom airport.
    const noMarker = INI.split('\n')
      .filter((line) => !line.includes('*GLOBAL_AIRPORTS*'))
      .join('\n');
    const result = insertSceneryPack(noMarker, 'Santiago');
    expect(result.placement).toBe('appended');
    const after = lines(result.text).filter((line) => line.trim() !== '');
    expect(after.at(-1)).toBe('SCENERY_PACK Custom Scenery/Santiago/');
  });

  it('keeps CRLF a CRLF file, and LF an LF file', () => {
    // A tool that quietly flips the line endings looks like it rewrote everything, and the next
    // person reading a diff cannot tell what actually changed.
    const crlf = INI.replace(/\n/g, '\r\n');
    const result = insertSceneryPack(crlf, 'Santiago');
    expect(result.text).toContain('\r\n');
    expect(result.text.replace(/\r\n/g, '\n')).toBe(insertSceneryPack(INI, 'Santiago').text);
  });

  it('keeps a byte-order mark, and keeps the final newline as it found it', () => {
    expect(insertSceneryPack(`\uFEFF${INI}`, 'Santiago').text.startsWith('\uFEFF')).toBe(true);

    const noTrailingNewline = INI.trimEnd();
    expect(insertSceneryPack(noTrailingNewline, 'Santiago').text.endsWith('\n')).toBe(false);
    expect(insertSceneryPack(INI, 'Santiago').text.endsWith('\n')).toBe(true);
  });
});

describe('removeSceneryPack', () => {
  it('takes the line out and leaves everything else where it was', () => {
    const installed = insertSceneryPack(INI, 'Santiago').text;
    const result = removeSceneryPack(installed, 'Santiago');
    expect(result.changed).toBe(true);
    expect(result.removed).toEqual(['SCENERY_PACK Custom Scenery/Santiago/']);
    expect(result.text).toBe(INI);
  });

  it('takes out the disabled form too, because the folder is gone either way', () => {
    const disabled = INI.replace(
      'SCENERY_PACK *GLOBAL_AIRPORTS*',
      'SCENERY_PACK *GLOBAL_AIRPORTS*\nSCENERY_PACK_DISABLED Custom Scenery/Santiago/',
    );
    expect(removeSceneryPack(disabled, 'Santiago').text).toBe(INI);
  });

  it('does nothing when the pack was never there', () => {
    const result = removeSceneryPack(INI, 'Santiago');
    expect(result.changed).toBe(false);
    expect(result.text).toBe(INI);
  });

  it('never touches another pack whose name merely starts the same', () => {
    const similar = INI.replace(
      'SCENERY_PACK *GLOBAL_AIRPORTS*',
      'SCENERY_PACK *GLOBAL_AIRPORTS*\nSCENERY_PACK Custom Scenery/Santiago Extra/',
    );
    expect(removeSceneryPack(similar, 'Santiago').changed).toBe(false);
  });
});

/**
 * Reading the file, rather than editing it. The airport index depends on this: two packs can define
 * the same airport and the order in here is what decides which one X-Plane actually uses.
 */
describe('sceneryEntries', () => {
  it('lists the entries in file order, with the marker in its place', () => {
    const entries = sceneryEntries(INI);
    expect(entries.map((entry) => (entry.kind === 'pack' ? entry.path : '*GLOBAL_AIRPORTS*'))).toEqual([
      'Custom Scenery/Aerosoft - LFMN Nice Cote d Azur X',
      'Custom Scenery/X-Plane Airports - EGPR Barra',
      '*GLOBAL_AIRPORTS*',
      'Custom Scenery/X-Plane Landmarks - Paris',
      'Custom Scenery/X-Codr Designs Library',
      'D:/Simuladores/XPlane Map Enhancement Base/XPME_South_America',
    ]);
    expect(entries.every((entry) => entry.enabled)).toBe(true);
  });

  it('reports a disabled pack rather than dropping it', () => {
    const entries = sceneryEntries(
      ['SCENERY_PACK_DISABLED Custom Scenery/Off/', 'SCENERY_PACK *GLOBAL_AIRPORTS*'].join('\n'),
    );
    expect(entries).toEqual([
      { kind: 'pack', path: 'Custom Scenery/Off', enabled: false },
      { kind: 'global-airports', enabled: true },
    ]);
  });

  it('ignores everything that is not a scenery line', () => {
    expect(sceneryEntries(['I', '1000 Version', 'SCENERY', '', '# a note'].join('\n'))).toEqual([]);
  });
});
