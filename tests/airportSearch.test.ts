import { describe, expect, it } from 'vitest';
import type { Airport } from '../src/core/airports/aptDat.js';
import {
  airportCode,
  buildAirportIndex,
  EMPTY_AIRPORT_INDEX,
  foldForSearch,
  searchAirports,
} from '../src/core/airports/search.js';

const AIRPORTS: readonly Airport[] = [
  { id: 'SCEL', name: 'Arturo Benítez Intl', lat: -33.394442, lon: -70.793803 },
  { id: 'SCTB', name: 'Eulogio Sánchez', lat: -33.456944, lon: -70.547222 },
  { id: 'SCSE', name: 'La Florida', lat: -29.916389, lon: -71.199444 },
  { id: 'LFPG', name: 'Paris - Charles De Gaulle', lat: 49.009747, lon: 2.547819 },
  { id: 'LFPO', name: 'Paris - Orly', lat: 48.72565, lon: 2.35944 },
  { id: 'LSZH', name: 'Zürich', lat: 47.45, lon: 8.55 },
  { id: 'XEN001Z', icao: 'ENHO', name: '[H] Hopen Station', lat: 76.5093, lon: 25.0136 },
];

const INDEX = buildAirportIndex(AIRPORTS);
const found = (query: string, limit?: number): string[] =>
  searchAirports(INDEX, query, limit).shown.map((airport) => airport.id);

describe('searching airports', () => {
  it('answers nothing at all until something is typed', () => {
    expect(found('')).toEqual([]);
    expect(found('   ')).toEqual([]);
    expect(searchAirports(EMPTY_AIRPORT_INDEX, 'SCEL')).toEqual({ shown: [], matches: 0 });
  });

  it('puts an exact code first, however many others share its prefix', () => {
    expect(found('LFP')[0]).toBe('LFPG');
    expect(found('LFPO')[0]).toBe('LFPO');
  });

  it('does not care about case', () => {
    expect(found('scel')).toContain('SCEL');
    expect(found('ScEl')[0]).toBe('SCEL');
  });

  it('finds an airport by a name typed without its accents', () => {
    expect(found('benitez')).toEqual(['SCEL']);
    expect(found('sanchez')).toEqual(['SCTB']);
    expect(found('zurich')).toEqual(['LSZH']);
    // And with them, for whoever has the keyboard for it.
    expect(found('Zürich')).toEqual(['LSZH']);
  });

  it('finds a field by the ICAO code it declares, not only by its row identifier', () => {
    expect(found('ENHO')).toEqual(['XEN001Z']);
    // By prefix too, because ENHO is the code the row shows.
    expect(found('ENH')).toEqual(['XEN001Z']);
  });

  /**
   * The row identifier is matched whole and never by prefix. It is not shown anywhere, so a prefix
   * hit on it produces a row whose visible code does not begin with what was typed — against the
   * real file, searching "L" answered with `AYYM` and `KREG`.
   */
  it('answers the hidden identifier only when it is typed in full', () => {
    expect(found('XEN001Z')).toEqual(['XEN001Z']);
    expect(found('XEN')).toEqual([]);
  });

  it('ranks codes above names', () => {
    // "Paris" is in two names; LFPG's and LFPO's codes do not begin with it, so this is the name
    // tier answering on its own.
    expect(found('paris')).toEqual(['LFPG', 'LFPO']);
  });

  it('orders each tier alphabetically, so the list does not reshuffle for invisible reasons', () => {
    expect(found('SC')).toEqual(['SCEL', 'SCSE', 'SCTB']);
  });

  /**
   * Alphabetical by the code the reader can see, not by the one underneath it.
   *
   * `LFPR` is row `8422` in the shipped file — an airport found by its ICAO code and ordered by its
   * row identifier landed above `L00` in a list of codes beginning with L, and nothing on screen
   * accounted for it.
   */
  it('orders by the code it shows, not by the identifier it matched underneath', () => {
    const index = buildAirportIndex([
      { id: '8422', icao: 'LFPR', name: 'Orange Plan de Dieu', lat: 44.18, lon: 4.92 },
      { id: 'L00', name: 'Rosamond Skypark', lat: 34.87, lon: -118.21 },
    ]);
    expect(searchAirports(index, 'L').shown.map(airportCode)).toEqual(['L00', 'LFPR']);
    // And it is still findable by the identifier the file gives it.
    expect(searchAirports(index, '8422').shown.map(airportCode)).toEqual(['LFPR']);
  });

  /**
   * One letter is in a third of the world's airport names and says nothing about which one you
   * meant. It does say something as a code, so the code tiers still answer it.
   */
  it('leaves names alone for a single letter', () => {
    expect(found('a')).toEqual([]);
    expect(found('L')).toEqual(['LFPG', 'LFPO', 'LSZH']);
  });

  /**
   * The limit is what the list shows, not what it found. A dropdown that stops at twenty without
   * saying so reads as the whole answer, and against a real installation "SC" matches 902.
   */
  it('stops at the limit, and says how many there really were', () => {
    const result = searchAirports(INDEX, 'S', 2);
    expect(result.shown).toHaveLength(2);
    expect(result.matches).toBe(found('S').length);
    expect(result.matches).toBeGreaterThan(2);
  });

  it('shows the declared ICAO code in preference to a synthetic identifier', () => {
    expect(airportCode(AIRPORTS[6]!)).toBe('ENHO');
    expect(airportCode(AIRPORTS[0]!)).toBe('SCEL');
  });

  it('folds a string the same way for the query and for the data', () => {
    expect(foldForSearch('Zürich')).toBe(foldForSearch('zurich'));
    expect(foldForSearch('Arturo Benítez Intl')).toBe('arturo benitez intl');
  });
});
