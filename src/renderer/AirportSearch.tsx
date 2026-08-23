/**
 * The "go to airport" box.
 *
 * Type a code or a name, pick a match, and the map flies there. That is the whole of it: it draws
 * no marker, adds nothing to the document, and knows nothing about the airport beyond where it is.
 * XOP still does not build airports (D2); it now knows where they are so you do not have to look up
 * a latitude before you can decorate one (D15).
 *
 * The airports come from the user's own installation, so the list matches what they actually fly —
 * including the fields that only exist in a pack they installed.
 *
 * Keyboard: ↑/↓ move the highlight, Enter takes it, Escape closes the list and then clears the box.
 */

import { useMemo, useRef, useState } from 'react';
import { editorStore, useEditor } from './state/editorStore.js';
import { AIRPORT_ZOOM } from './state/store.js';
import { airportCode, searchAirports } from '../core/airports/search.js';
import type { Airport } from '../core/airports/aptDat.js';

export function AirportSearch(): React.JSX.Element {
  const airports = useEditor((state) => state.airports);
  const status = useEditor((state) => state.airportsStatus);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchAirports(airports, query), [airports, query]);
  const showList = open && results.length > 0;

  const pick = (airport: Airport): void => {
    editorStore.getState().goTo({ lon: airport.lon, lat: airport.lat }, AIRPORT_ZOOM);
    setQuery('');
    setOpen(false);
    setHighlight(0);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      const chosen = results[highlight];
      if (showList && chosen) {
        event.preventDefault();
        pick(chosen);
      }
    } else if (event.key === 'Escape') {
      // The first Escape shuts the dropdown; a second, with it already shut, empties the box. The
      // map also listens for keys, so both are stopped here rather than left to travel on.
      event.stopPropagation();
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else {
        setQuery('');
      }
    }
  };

  const placeholder =
    status === 'loading'
      ? 'reading airports…'
      : status === 'failed'
        ? 'no airports found'
        : 'ICAO or name…';

  return (
    <div className="airport">
      <label className="airport-label" htmlFor="xop-airport-search">
        Airport:
      </label>
      <div className="airport-box">
        <input
          id="xop-airport-search"
          ref={inputRef}
          className="airport-input"
          type="search"
          placeholder={placeholder}
          title={
            status === 'failed'
              ? 'no apt.dat could be read from this installation — use the coordinate box instead'
              : undefined
          }
          disabled={status !== 'ready'}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls="xop-airport-listbox"
          aria-activedescendant={showList ? `xop-airport-option-${highlight}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {showList && (
          <ul className="airport-list" id="xop-airport-listbox" role="listbox">
            {results.map((airport, i) => (
              <li
                key={`${airport.id}-${i}`}
                id={`xop-airport-option-${i}`}
                role="option"
                aria-selected={i === highlight}
                className={i === highlight ? 'airport-option on' : 'airport-option'}
                // mousedown, and prevented: it fires before the input's blur, so clicking a row is
                // not cancelled by the dropdown closing out from under the pointer first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(airport);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <span className="airport-code">{airportCode(airport)}</span>
                <span className="airport-name">{airport.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
