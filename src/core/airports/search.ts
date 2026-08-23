/**
 * Ranking airports for the "go to" box.
 *
 * Ported from PCT (afs4-poi-creator, `src/core/airports/airports.ts`), (c) Juan Luis Gabriel,
 * GPL-3.0-or-later. Both projects are GPL-3.0 (docs/DECISIONS.md D4). The tiers and the
 * accent-folding are the parts worth carrying across — they are about how people type, not about
 * any simulator. What did not come across is the shape of the data: PCT searches a bundled list of
 * 7 845 Aerofly airports, XOP searches whatever is in the user's own installation, which is 38 944
 * of them on the machine this was written on, and can carry a second code per airport.
 *
 * That size is why there is a prepared index here and only a plain array over there. Folding a name
 * is not free, and folding 38 944 of them on every keystroke would show — so it happens once, when
 * the airports arrive.
 *
 * Pure: no DOM, no I/O.
 */

import type { Airport } from './aptDat.js';

/**
 * Fold a string for accent- and case-insensitive matching: NFD-decompose (so an accented letter
 * becomes a base letter plus a combining mark), drop every combining mark, then lowercase.
 *
 * So "Arturo Benítez" is found by someone typing "benitez", and "Zürich" by "zurich". The name tier
 * is the one that saves a user who does not know the code, so folding is what makes it work at all.
 */
export function foldForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

/**
 * The airports with their searchable forms worked out in advance.
 *
 * Parallel arrays rather than an array of objects: the point is to touch as little as possible per
 * keystroke, and this way a scan reads contiguous arrays of short strings.
 */
export interface AirportIndex {
  readonly airports: readonly Airport[];
  /**
   * The code the row will show, lowercased — `airportCode`, folded.
   *
   * It is also the key the results are ordered by, and those two have to be the same string. When
   * they were not, a list sorted by row identifier came out in an order the reader could not
   * account for: `LFPR` is row `8422` in the shipped file, so a search for "L" put it above `L00`
   * for a reason nothing on the screen explained.
   *
   * Codes are ASCII, so lowercasing is the whole of the folding they need.
   */
  readonly codes: readonly string[];
  /**
   * The airport's other code, lowercased, when it has two. Empty when it has one.
   *
   * Matched **exactly and never by prefix**, deliberately. This is the row identifier X-Plane gave
   * a field that already has a real code — `8422` for LFPR, `XEN001Z` for ENHO — and it is not
   * shown anywhere. Prefix-matching it fills a list with rows whose visible code does not begin
   * with what was typed: searching "L" turned up `AYYM` and `KREG`, correctly and inexplicably.
   * Typing a code you happen to know in full still finds the field, which is the case this exists
   * for.
   */
  readonly altCodes: readonly string[];
  /** The name, folded. */
  readonly names: readonly string[];
  /**
   * Whether the shown code has the shape of an ICAO code, which is what ranks it.
   *
   * See `looksLikeIcao`.
   */
  readonly icaoShaped: readonly boolean[];
}

/**
 * Four letters and no digits — the shape of an ICAO code.
 *
 * This is a ranking signal, not an identity check, and it does not have to be perfect: `AEDU` is
 * four letters and is really a scenery pack's helipad, and it will rank as an airport. What it does
 * reliably is separate the codes ICAO issues from the ones a national authority does — `SC02`,
 * `L00`, `5TE`, `92T`, `314NZ` all carry digits, and ICAO codes never do.
 *
 * Expects an already-lowercased code, which is what the index stores.
 */
function looksLikeIcao(code: string): boolean {
  if (code.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const c = code.charCodeAt(i);
    if (c < 0x61 || c > 0x7a) return false;
  }
  return true;
}

export function buildAirportIndex(airports: readonly Airport[]): AirportIndex {
  const codes: string[] = [];
  const altCodes: string[] = [];
  const names: string[] = [];
  const icaoShaped: boolean[] = [];
  for (const airport of airports) {
    const code = airportCode(airport).toLowerCase();
    codes.push(code);
    // Only where the two differ, which is where the row identifier is a synthetic one nobody would
    // type. Where they are the same, the second copy would be searched for nothing.
    altCodes.push(airport.icao === undefined ? '' : airport.id.toLowerCase());
    names.push(foldForSearch(airport.name));
    icaoShaped.push(looksLikeIcao(code));
  }
  return { airports, codes, altCodes, names, icaoShaped };
}

/** What the box searches before the airports have arrived. */
export const EMPTY_AIRPORT_INDEX: AirportIndex = {
  airports: [],
  codes: [],
  altCodes: [],
  names: [],
  icaoShaped: [],
};

/**
 * The shortest query the name tier will answer.
 *
 * One letter appears in a third of the world's airport names and tells nobody anything, while the
 * code tiers answer a single letter usefully. Two is where a name search starts meaning something.
 */
const MIN_NAME_QUERY = 2;

export interface AirportSearchResult {
  /** The best matches, at most `limit` of them. */
  readonly shown: readonly Airport[];
  /**
   * How many matched altogether, before the limit.
   *
   * Returned rather than left implicit because a list that quietly stops at twenty looks like the
   * whole answer. "SC" matches 902 airports in a real installation, and a dropdown showing three of
   * them with nothing to say so reads as a tool that has lost most of the world.
   */
  readonly matches: number;
}

/**
 * Rank airports for a typeahead query. Case- and accent-insensitive; tiers, best first:
 *
 *   1. code exact      — "LFPG" finds LFPG; "8422" finds the field shown as LFPR
 *   2. code prefix     — "LFP" finds LFPG, LFPO, … by the code each row shows
 *   3. name substring  — "charles" finds LFPG, "san francisco" finds KSFO
 *
 * Within a tier, airports with an ICAO-shaped code come first and each half is alphabetical — see
 * `order`. A blank query returns nothing and the dropdown stays shut.
 */
export function searchAirports(
  index: AirportIndex,
  query: string,
  limit = 20,
): AirportSearchResult {
  const q = foldForSearch(query.trim());
  if (q === '') return { shown: [], matches: 0 };

  const { airports, codes, altCodes, names, icaoShaped } = index;
  const exact: number[] = [];
  const prefix: number[] = [];
  const named: number[] = [];
  const searchNames = q.length >= MIN_NAME_QUERY;

  // The four arrays are filled together in `buildAirportIndex` and are the same length by
  // construction, which is what the assertions below stand on.
  for (let i = 0; i < airports.length; i++) {
    const code = codes[i]!;
    const alt = altCodes[i]!;
    if (code === q || alt === q) exact.push(i);
    else if (code.startsWith(q)) prefix.push(i);
    else if (searchNames && names[i]!.includes(q)) named.push(i);
  }

  /**
   * ICAO-shaped codes first, then alphabetical.
   *
   * Both halves of that are the answer to a real complaint. Alphabetical alone put `SC02`, `SC03`
   * and eighteen more South Carolina helipads above `SCEL` for a search of "SC", because `0` sorts
   * before `e` — 902 airports match and the twenty shown were all local codes. Airports with an
   * ICAO code are the ones people look for by code at all, so they go first, and inside each half
   * the order stays alphabetical so nothing shuffles for a reason the reader cannot see.
   *
   * Three-way, including the tie: a comparator that never says "equal" is not a valid one, and the
   * sort is free to do something surprising with it.
   */
  const order = (keys: readonly string[]) => (a: number, b: number) => {
    if (icaoShaped[a] !== icaoShaped[b]) return icaoShaped[a] ? -1 : 1;
    return keys[a]! < keys[b]! ? -1 : keys[a]! > keys[b]! ? 1 : 0;
  };
  prefix.sort(order(codes));
  named.sort(order(names));

  return {
    shown: [...exact, ...prefix, ...named].slice(0, limit).map((i) => airports[i]!),
    matches: exact.length + prefix.length + named.length,
  };
}

/**
 * The code to show for an airport.
 *
 * The declared ICAO code wins over the row's own identifier when they differ, because that is the
 * one a pilot recognises: `ENHO` means something and `XEN001Z` means nothing.
 */
export function airportCode(airport: Airport): string {
  return airport.icao ?? airport.id;
}
