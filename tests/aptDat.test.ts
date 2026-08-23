import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createAptDatReader, parseAptDat } from '../src/core/airports/aptDat.js';

/**
 * The fixtures are shaped after real rows lifted out of the shipped Global Airports file, not
 * invented: the field positions this parser depends on are the whole of what it knows, and a
 * fixture written from the spec would agree with the spec rather than with X-Plane.
 */
const SCEL = [
  '1   1555 0 0 SCEL Arturo Benítez Intl',
  '1302 datum_lat -33.394441667',
  '1302 datum_lon -70.793802778',
  '100 55.00 35 935 0.25 1 3 0 17L -33.3760605 -70.7867314 1 0 7 2 1 1 35R -33.4098350 -70.7849086 551 0 6 7 0 1',
];

describe('reading an apt.dat', () => {
  it('reads the identifier and the name off the header row', () => {
    const [airport] = parseAptDat(SCEL.join('\n'));
    expect(airport?.id).toBe('SCEL');
    expect(airport?.name).toBe('Arturo Benítez Intl');
  });

  it('puts the airport in the middle of its runway', () => {
    const [airport] = parseAptDat(SCEL.join('\n'));
    // Halfway between the two ends of 17L/35R.
    expect(airport?.lat).toBeCloseTo((-33.3760605 + -33.409835) / 2, 6);
    expect(airport?.lon).toBeCloseTo((-70.7867314 + -70.7849086) / 2, 6);
  });

  /**
   * The measured reason the datum is the fallback and not the answer.
   *
   * 5CL5 is a real airport in the shipped file. Its helipad is in Irvine, California; its
   * `datum_lon` is missing the minus sign, which puts its declared position in the East China Sea,
   * 21 808 km away. 270 of the 17 045 airports that publish a datum are wrong by more than 5 km.
   */
  it('prefers the geometry over a datum that disagrees with it', () => {
    const [airport] = parseAptDat(
      [
        '1     56 0 0 5CL5 [H] Kcin Emergency',
        '1302 datum_lat 33.6859056',
        '1302 datum_lon 117.8543750',
        '102 H1 33.6859836 -117.8541904 260.9 15.20 15.20 15 0 0 0.25 0',
      ].join('\n'),
    );
    expect(airport?.lon).toBeCloseTo(-117.8541904, 6);
  });

  it('falls back to the datum when there is no geometry at all', () => {
    const [airport] = parseAptDat(
      ['1 100 0 0 XXXX Paper Airport', '1302 datum_lat 12.5', '1302 datum_lon -3.25'].join('\n'),
    );
    expect(airport).toEqual({ id: 'XXXX', name: 'Paper Airport', lat: 12.5, lon: -3.25 });
  });

  it('skips an airport that says where nothing is', () => {
    expect(parseAptDat(['1 100 0 0 XXXX Nowhere', '1302 city Nowhere'].join('\n'))).toEqual([]);
  });

  it('reads seaplane bases and heliports, not just land airports', () => {
    const airports = parseAptDat(
      [
        '16 0 0 0 XSPB Float Base',
        '101 30 0 1 10.0 20.0 2 10.1 20.1',
        '17 0 0 0 XHEL [H] Rooftop',
        '102 H1 40.5 -3.5 0.0 12.00 12.00 15 0 0 0.00 0',
      ].join('\n'),
    );
    expect(airports.map((a) => a.id)).toEqual(['XSPB', 'XHEL']);
    expect(airports[1]?.name).toBe('[H] Rooftop');
    expect(airports[1]?.lat).toBeCloseTo(40.5, 6);
  });

  it('uses a startup location when that is all the airport has', () => {
    const [airport] = parseAptDat(
      ['17 0 0 0 XPAD [H] Pad', '1300 51.5 -0.1 90.0 helos all'].join('\n'),
    );
    expect(airport?.lat).toBeCloseTo(51.5, 6);
    expect(airport?.lon).toBeCloseTo(-0.1, 6);
  });

  /**
   * Pavement nodes carry coordinates too, and there are millions of them. Letting them into the box
   * would drag an airport's centre out to the far corner of its apron — and, at an airport whose
   * taxiways were drawn as one shape with the terminal, considerably further.
   */
  it('ignores the coordinates of rows that are not runways, helipads or startups', () => {
    const [airport] = parseAptDat(
      [
        '1 100 0 0 XPAV Paved',
        '100 30 1 0 0.25 1 1 0 09 10.000 20.000 0 0 1 0 0 0 27 10.010 20.010 0 0 1 0 0 0',
        '110 1 0.25 0.0 apron',
        '111 80.000 -170.000',
        '112 -80.000 170.000',
      ].join('\n'),
    );
    expect(airport?.lat).toBeCloseTo(10.005, 6);
    expect(airport?.lon).toBeCloseTo(20.005, 6);
  });

  it('keeps a declared ICAO code that differs from the identifier, and drops one that does not', () => {
    const airports = parseAptDat(
      [
        '17 0 0 0 XEN001Z [H] Hopen Station',
        '1302 icao_code ENHO',
        '102 H1 76.5093 25.0136 0.0 12.00 12.00 15 0 0 0.00 0',
        '1 10 0 0 KSFO San Francisco Intl',
        '1302 icao_code KSFO',
        '102 H1 37.6188 -122.3754 0.0 12.00 12.00 15 0 0 0.00 0',
      ].join('\n'),
    );
    expect(airports[0]?.icao).toBe('ENHO');
    expect(airports[1]).not.toHaveProperty('icao');
  });

  it('refuses a coordinate that is not one, rather than flying to it', () => {
    const [airport] = parseAptDat(
      [
        '1 10 0 0 XBAD Bad Rows',
        '102 H1 999.0 -20.0 0.0 12.00 12.00 15 0 0 0.00 0',
        '102 H2 nonsense -20.0 0.0 12.00 12.00 15 0 0 0.00 0',
        '102 H3 41.0 -20.0 0.0 12.00 12.00 15 0 0 0.00 0',
      ].join('\n'),
    );
    expect(airport?.lat).toBeCloseTo(41.0, 6);
  });

  it('drops a header with no identifier, and everything under it', () => {
    const airports = parseAptDat(
      [
        '1 10 0 0',
        '102 H1 41.0 -20.0 0.0 12.00 12.00 15 0 0 0.00 0',
        '1 10 0 0 XGOOD Good',
        '102 H1 42.0 -21.0 0.0 12.00 12.00 15 0 0 0.00 0',
      ].join('\n'),
    );
    expect(airports).toHaveLength(1);
    expect(airports[0]?.id).toBe('XGOOD');
    expect(airports[0]?.lat).toBeCloseTo(42.0, 6);
  });

  it('reads a file that ends without a newline, and one written with CRLF', () => {
    expect(parseAptDat(SCEL.join('\r\n'))).toHaveLength(1);
    expect(parseAptDat(SCEL.join('\n') + '\n')).toHaveLength(1);
  });

  it('closes the airport in progress when the file simply stops', () => {
    const reader = createAptDatReader();
    reader.line('1 10 0 0 XEND Cut Short');
    reader.line('102 H1 5.0 6.0 0.0 12.00 12.00 15 0 0 0.00 0');
    expect(reader.finish()).toHaveLength(1);
  });
});

/**
 * The same bug that took 1.0.2 down, in the place it would strike next.
 *
 * `readAptDat` cuts lines out of one-megabyte chunks, and every field cut out of a line is a cut out
 * of that chunk. 38 888 airports each holding a megabyte alive would be worse than the object
 * catalog ever was — and the file it reads is 380 MB, so the alternative is not "slower", it is
 * "does not finish".
 */
describe('what a parsed airport keeps alive', () => {
  /** `--expose-gc` without a runner flag, so this test needs nothing of the other 300. */
  function forceGc(): () => void {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    v8.setFlagsFromString('--no-expose-gc');
    return () => {
      gc();
      gc();
    };
  }

  /**
   * One airport with a great deal of pavement under it, as its own ~250 KB string.
   *
   * The name is deliberately a single word. A name of several words is put back together with
   * `join`, which allocates, and would pass this test while holding nothing — but `join` on a
   * one-element array hands back that element *itself*, so a one-word name is the field that really
   * is a pointer into the file. The shipped data is full of them: Tetlin, Sobral, Weaver.
   */
  function bigAirport(seed: number): string {
    const rows = [
      `1 10 0 0 X${seed} AirportNumber${seed}`,
      '102 H1 41.0 -20.0 0.0 12.00 12.00 15 0 0 0.00 0',
    ];
    for (let i = 0; i < 6000; i++) rows.push(`111 ${41 + i / 1e6} ${-20 - i / 1e6}`);
    return rows.join('\n');
  }

  it('keeps the name and not the file it came from', () => {
    const collect = forceGc();
    const held: { id: string; name: string }[] = [];

    collect();
    const before = process.memoryUsage().heapUsed;
    for (let seed = 0; seed < 400; seed++) {
      // Cut the lines out of one parent string, which is exactly what streaming a chunk does. Feed
      // them through and let the parent go: what is left is whatever the airports are holding.
      const file = bigAirport(seed);
      const reader = createAptDatReader();
      let start = 0;
      for (;;) {
        const newline = file.indexOf('\n', start);
        if (newline === -1) break;
        reader.line(file.slice(start, newline));
        start = newline + 1;
      }
      for (const airport of reader.finish()) held.push({ id: airport.id, name: airport.name });
    }
    collect();
    const grown = process.memoryUsage().heapUsed - before;

    // Not passing by parsing nothing.
    expect(held).toHaveLength(400);
    expect(held[399]).toEqual({ id: 'X399', name: 'AirportNumber399' });

    // 400 files of about 250 KB is 100 MB held if the names are slices, and nothing at all if they
    // are not. Twenty leaves room to breathe without leaving room for the bug.
    expect(grown / 1024 / 1024).toBeLessThan(20);
  }, 30_000);
});
