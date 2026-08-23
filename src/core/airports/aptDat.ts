/**
 * Reading airports out of `apt.dat` — enough of them to move the map, and nothing else.
 *
 * `apt.dat` is X-Plane's airport database: plain text, one row per element, an airport header row
 * followed by everything that belongs to it until the next header. It describes runways, taxiways,
 * pavement, signs, parking, frequencies and lighting, and XOP reads **none** of that. It reads the
 * identifier, the name, and where the field is — the three things a "take me there" box needs.
 * That narrowness is the point, and docs/DECISIONS.md D15 is where it is written down.
 *
 * ## Where the coordinate comes from, and why not from the obvious place
 *
 * An airport may publish its own reference point as `1302 datum_lat` / `datum_lon`. That looks like
 * the answer and is not: measured over the shipped Global Airports file (38 888 airports, 380 MB),
 * **270 of the 17 045 airports that publish a datum put it more than 5 km from their own runways**,
 * and the worst of them is on the other side of the planet. They are ordinary data-entry faults —
 * `5CL5` writes `datum_lon 117.85` for a field at -117.85, `MT54` flips the sign of both, `SNOB`
 * pastes its longitude into its latitude. Nothing in the file marks them as wrong.
 *
 * The geometry does not have that problem: every one of the 38 888 airports carries at least one
 * runway, helipad or startup location, and only a single airport's geometry spans more than 20 km —
 * Edwards AFB, which really does sprawl across a dry lake. So the rule here is the reverse of the
 * obvious one:
 *
 *   1. the centre of the box around the runways, helipads and startup locations, when there are any;
 *   2. the published datum, only when there are none.
 *
 * Nobody needs step 2 in the file X-Plane ships. It stays because a pack in `Custom Scenery` is
 * somebody else's file, and an airport in one could well be metadata and nothing more.
 *
 * ## Strings
 *
 * Every string kept here is detached from the chunk it was cut out of. In V8 a slice is a pointer
 * to its parent, so an unmodified 20-character airport name lifted out of a 1 MB read keeps that
 * megabyte alive — and there are 38 888 of them. That is not a hypothetical: it is the bug that
 * took XP Object Placer 1.0.2 down for two users. `(' ' + s).slice(1)` is the idiom that was
 * measured to actually release the parent; `normalize()`, the obvious-looking one, does not.
 *
 * Pure: text in, airports out. No file system, so it unit-tests under node.
 */

/** One airport, as far as this application is concerned: a name, a code, and a place. */
export interface Airport {
  /**
   * The identifier on the airport's own header row, verbatim.
   *
   * Usually an ICAO code. Often not: X-Plane uses local and FAA codes (`5TE`, `A30`) and synthetic
   * ones (`XEN001Z`) for fields that have no ICAO code of their own.
   */
  readonly id: string;
  /**
   * The ICAO code the airport declares, when it declares one that is not its `id`.
   *
   * 1 401 of the 38 888 shipped airports do this — `XEN001Z` is `ENHO`, `EB3` is `CYVL` — and
   * somebody typing `ENHO` should not be told there is no such airport when there plainly is.
   */
  readonly icao?: string;
  /** The airport's name, as the file spells it. Heliports come with a `[H]` already in the name. */
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

/** Header row codes: land airport, seaplane base, heliport. All three are places to put objects. */
const HEADER_CODES = new Set(['1', '16', '17']);

/**
 * Detach a string from the buffer it was cut out of.
 *
 * See the note at the top of this file. Concatenating and re-slicing forces V8 to flatten the
 * result into a string of its own; there is no less peculiar-looking idiom that was measured to
 * work.
 */
function detach(s: string): string {
  return (' ' + s).slice(1);
}

function coordinate(lat: string | undefined, lon: string | undefined): [number, number] | null {
  if (lat === undefined || lon === undefined) return null;
  const a = Number(lat);
  const o = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o)) return null;
  if (Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  return [a, o];
}

/**
 * A reader you feed one line at a time.
 *
 * Line at a time rather than whole file because the file it is aimed at is 380 MB, and the node
 * layer streams it in one-megabyte pieces. `parseAptDat` below is the same thing with the loop
 * already written, for tests and for the small files in `Custom Scenery`.
 */
export interface AptDatReader {
  /** Feed one line, without its terminator. */
  line(raw: string): void;
  /** No more lines: close the airport in progress and hand back everything read. */
  finish(): Airport[];
}

export function createAptDatReader(): AptDatReader {
  const airports: Airport[] = [];

  let id: string | null = null;
  let name = '';
  let icao: string | null = null;
  let datumLat: number | null = null;
  let datumLon: number | null = null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  function close(): void {
    if (id === null) return;
    const current = id;
    id = null;

    let lat: number;
    let lon: number;
    if (minLat !== Infinity) {
      lat = (minLat + maxLat) / 2;
      lon = (minLon + maxLon) / 2;
    } else if (
      datumLat !== null &&
      datumLon !== null &&
      Number.isFinite(datumLat) &&
      Number.isFinite(datumLon) &&
      Math.abs(datumLat) <= 90 &&
      Math.abs(datumLon) <= 180
    ) {
      lat = datumLat;
      lon = datumLon;
    } else {
      // No runway, no helipad, no startup location and no usable datum. There is nowhere to fly to,
      // so offering it in a "go to" list would be offering a dead end. Skipped, not guessed at.
      return;
    }

    airports.push({
      id: current,
      name,
      lat,
      lon,
      ...(icao !== null && icao !== current ? { icao } : {}),
    });
  }

  function see(lat: string | undefined, lon: string | undefined): void {
    const point = coordinate(lat, lon);
    if (point === null) return;
    if (point[0] < minLat) minLat = point[0];
    if (point[0] > maxLat) maxLat = point[0];
    if (point[1] < minLon) minLon = point[1];
    if (point[1] > maxLon) maxLon = point[1];
  }

  return {
    line(raw: string): void {
      // 12.4 million rows go through here for one real installation, and all but a handful are
      // pavement nodes. Reject on the first character before splitting anything: every row this
      // file cares about starts with a digit.
      const first = raw.charCodeAt(0);
      if (first < 0x31 || first > 0x39) return;

      const fields = raw.split(/\s+/);
      const code = fields[0] ?? '';

      if (HEADER_CODES.has(code)) {
        close();
        const ident = fields[4];
        // A header with no identifier is not an airport anyone can look up. Skipping it also skips
        // everything under it, because `id` stays null — which is what should happen to the rows
        // belonging to a header that was refused.
        if (ident === undefined || ident === '') return;
        id = detach(ident);
        name = detach(fields.slice(5).join(' '));
        icao = null;
        datumLat = null;
        datumLon = null;
        minLat = Infinity;
        maxLat = -Infinity;
        minLon = Infinity;
        maxLon = -Infinity;
        return;
      }

      if (id === null) return;

      if (code === '100') {
        // Land runway: one end at fields 9-10, the other at 18-19.
        see(fields[9], fields[10]);
        see(fields[18], fields[19]);
      } else if (code === '101') {
        // Water runway: ends at 4-5 and 7-8.
        see(fields[4], fields[5]);
        see(fields[7], fields[8]);
      } else if (code === '102') {
        // Helipad: its centre.
        see(fields[2], fields[3]);
      } else if (code === '1300') {
        // A startup location — a gate, a ramp spot, a tiedown. Not the field's geometry, but it is
        // on the field, and it may be all a heliport or a float base has.
        see(fields[1], fields[2]);
      } else if (code === '1302') {
        const key = fields[1];
        if (key === 'datum_lat') datumLat = Number(fields[2]);
        else if (key === 'datum_lon') datumLon = Number(fields[2]);
        else if (key === 'icao_code' && fields[2] !== undefined && fields[2] !== '') {
          icao = detach(fields[2]);
        }
      }
    },

    finish(): Airport[] {
      close();
      return airports;
    },
  };
}

/** The whole of a small `apt.dat` at once. For tests, and for a pack in `Custom Scenery`. */
export function parseAptDat(text: string): Airport[] {
  const reader = createAptDatReader();
  for (const line of text.split(/\r\n|\r|\n/)) reader.line(line);
  return reader.finish();
}
