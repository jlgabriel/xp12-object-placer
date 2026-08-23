# `apt.dat` — where the airports are

> **Provenance.** ✅ = counted or read on disk, X-Plane 12.4.3, 2026-08-23. ❓ = from Laminar's
> `apt.dat` 1200 specification, not exercised by XOP.

XOP reads this file for **one** purpose: to answer "take me to SCEL" with a latitude and a
longitude. It never writes one, and it reads five kinds of row out of the thirty-odd the format
defines. The boundary and the reasoning are [D15](../docs/DECISIONS.md); this file is what was
measured.

## Where they are ✅

| Path | What it is |
| --- | --- |
| `Global Scenery/Global Airports/Earth nav data/apt.dat` | X-Plane 12's own airports. **380 458 932 bytes**, 12 351 496 rows, 38 888 airports. |
| `Custom Scenery/<pack>/Earth nav data/apt.dat` | A pack's own airports. 14 of them on the development installation, 915 KB in total. |
| `Custom Scenery/Global Airports/Earth nav data/apt.dat` | Where X-Plane 11 kept the global set. Looked for, and absent here. ❓ |

Priority is `Custom Scenery/scenery_packs.ini`: the first pack that defines an airport is the one
X-Plane uses, and `*GLOBAL_AIRPORTS*` is a line in that same order. On this machine the marker sits
at line 13, below twelve custom airports and above the landmark packs.

## The shape ✅

Plain text, UTF-8, one row per element. A header row starts an airport and everything until the
next header belongs to it.

```
1   1555 0 0 SCEL Arturo Benítez Intl
1302 datum_lat -33.394441667
1302 datum_lon -70.793802778
100 55.00 35 935 0.25 1 3 0 17L -33.3760605 -70.7867314 1 0 7 2 1 1 35R -33.4098350 -70.7849086 551 0 6 7 0 1
1300 -33.377122 -70.792313 87.9 misc jets|turboprops|props|helos|fighters MIL2
```

Fields are separated by runs of spaces, not by single ones — the header above has three spaces
after the `1`. Line endings vary by who wrote the file.

### The rows XOP reads ✅

| Row | Meaning | What is taken |
| --- | --- | --- |
| `1` | land airport | field 4 = identifier, fields 5… = name |
| `16` | seaplane base | same |
| `17` | heliport | same — the name arrives with `[H] ` already on it |
| `100` | land runway | fields 9–10 and 18–19, the two ends |
| `101` | water runway | fields 4–5 and 7–8 |
| `102` | helipad | fields 2–3, the centre |
| `1300` | startup location | fields 1–2 |
| `1302 icao_code` | declared ICAO code | the code |
| `1302 datum_lat` / `datum_lon` | the airport's own reference point | the coordinate, as a **fallback only** — see below |

Everything else — taxiways, pavement (`110`–`116`), signs, frequencies, lighting, the rest of the
`1302` metadata — is skipped, and skipping it is a decision, not an omission.

## What one real installation contains ✅

38 888 airports in the global file: **31 269 land airports, 682 seaplane bases, 6 937 heliports.**
No duplicate identifiers. Every one of them has a name.

The 14 packs in `Custom Scenery` add **56 airports the global file does not contain at all** — 36
flying-boat sealanes, 18 Antarctic stations including the South Pole, a helipad on the Burj Al Arab
— and supersede 42 more. **38 944 airports in total.**

## ⚠️ The datum is not the answer ✅

17 045 of the 38 888 airports publish `datum_lat` / `datum_lon`. Comparing each one against the
centre of the box around that airport's own runways, helipads and startup locations:

| | metres |
| --- | --- |
| median disagreement | 96 |
| 90th percentile | 582 |
| 99th percentile | 201 402 |
| worst | 21 808 759 |

**270 airports are out by more than 5 km**, and the tail is not noise, it is broken data:

- `5CL5` — `datum_lon 117.8543750` for a helipad at `-117.8541904`. Missing minus sign. 21 808 km.
- `MT54`, `MT60`, `MT65`, `MT52`, `MT74` — sign flipped on the latitude, the longitude, or both.
- `SNOB` — `datum_lat -40.3369`, `datum_lon -40.3369`. The longitude pasted into both.
- `WT04`, `WT01`, `WT24` — a Washington State datum on an Indonesian airfield.

Nothing in the file marks any of these as suspect. The geometry, by contrast, is coherent: of
38 888 airports, exactly **one** has geometry spanning more than 20 km, and that one is Edwards AFB
on Rogers Dry Lake, which really is 34 km across.

⇒ **XOP takes the centre of the geometry and uses the datum only when there is no geometry at all.**
On the shipped file that fallback never fires — all 38 888 have geometry — and it is kept for the
packs, which are somebody else's files.

## Reading it ✅

2 596 ms to index the whole installation, streamed in one-megabyte pieces: 380 MB of text, 12.4
million rows, 38 944 airports, **11 MB of heap retained**. The result is 2.87 MB of JSON, cached in
`userData` and rebuilt only when the size or modification time of one of the source files changes.

⚠️ **Every field kept has to be detached from the chunk it was cut out of.** V8 represents a slice
as a pointer to its parent, so an airport name lifted out of a one-megabyte read keeps that
megabyte alive — and there are tens of thousands of them. This is the same defect that had to be
withdrawn as 1.0.2; see `reference/obj8.md` and `src/core/airports/aptDat.ts`. A name of several
words happens to survive it, because rejoining the words allocates a fresh string; a **one-word
name does not**, and the file is full of them.

## Two things worth knowing about identifiers ✅

- **The header identifier is often not an ICAO code.** X-Plane uses local and FAA codes (`5TE`,
  `A30`, `L00`) and synthetic ones (`XEN001Z`, `8422`) where a field has no ICAO code of its own.
  1 401 airports declare an `icao_code` that differs from their header identifier.
- **One row's identifier can be another row's declared ICAO code, inside the same file.** `PAKX` is
  an airport; `PALJ` also declares `PAKX`. There are 20 such pairs, they are different places with
  different names, and X-Plane keeps both.

## Not read ❓

`earth_nav.dat` — VORs, NDBs, ILS. A different file for a different question, and XOP has no
question it answers.
