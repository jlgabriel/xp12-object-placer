# `library.txt` — the object catalog

> **Provenance.** ✅ = counted or read in X-Plane 12.4.3 on disk. ❓ = from Laminar's library
> specification, not yet exercised by XOP.

A library file maps **virtual paths** to files inside its own scenery package. Any DSF anywhere can
then reference the virtual path, and X-Plane resolves it — **without the referencing pack copying
anything**. This is the mechanism that lets XOP produce a scenery pack containing no assets.

## Header ✅

```
A
1200
LIBRARY
```

## Where they are ✅

26 library files in a normal installation:

- `Resources/default scenery/*/library.txt` — 9 files, the stock content
- `Custom Scenery/*/[Ll]ibrary.txt` — third-party libraries the user installed

⚠️ The filename case varies in the wild: stock uses `library.txt`, several third-party packs ship
`Library.txt`. The scanner must be case-insensitive when *finding* the file.

## What one real installation contains ✅

Scanned with `npm run scan`, X-Plane 12.4.3 with a handful of third-party packs:

| | |
|---|---|
| libraries read | **23** |
| exports of every asset type | **49 233** |
| of those, `.obj` | **13 100** (26.6%) |
| distinct `.obj` virtual paths | **6 293** |
| with more than one variant | 1 841 (29.3%) |
| **actually offered to a user** | **3 837** (61%) |

The other three quarters of the exports are `.ter` (9 818), `.for` (9 680), `.pol` (8 904), `.fac`
(4 344), `.lin`, `.agp`, `.ags` — terrain, forests, polygons and facades, none of which XOP places.

For scale: PCT's Aerofly catalog held 911 objects. Getting from 13 100 exports down to 3 837 things
a person might actually want is the real work, and most of it is done by the libraries themselves —
see the visibility markers below.

## What the catalog actually looks like ✅

The 3 837 placeable objects, by top-level branch, with the longer side of their footprint:

| branch | objects | median | p90 | max |
|---|---|---|---|---|
| `airport` | 1 795 | 12 m | 40 m | 655 m |
| `g10` (autogen buildings) | 774 | 26 m | 60 m | **1 123 m** |
| `XCDL` (third party) | 386 | 17 m | 46 m | 55 m |
| `industrial_area` | 197 | 6 m | 12 m | 12 m |
| `vehicles` | 185 | 10 m | 16 m | 18 m |
| `street` | 115 | 2 m | 6 m | 7 m |
| `constructions` | 92 | 6 m | 19 m | 52 m |
| `ships` | 62 | 5 m | 15 m | 189 m |
| the rest | 231 | | | |

`airport` alone splits usefully: `Common_Elements` 465, `hangars` 380, `aircraft` 259, `markings`
150, `lights` 143, `Ramp_Equipment` 140, `control_towers` 23, `radars` 21.

**The tree is good enough to ship as-is.** It came from the paths; nobody curated it for us.

⚠️ **But the sizes are the second axis, and they matter as much.** The largest "object" in the
catalog is 1 123 × 517 m — `lib/g10/US/urban_high/0448A0448R512.obj`, an entire city block meant for
autogen, with a coded name no person would search for. Meanwhile the same `g10` branch holds
`carport1_6x3` and `gar1_6x12`, which are exactly the kind of thing somebody decorating a field
wants.

So **do not exclude branches**. A 1 km object is self-evidently wrong the moment its footprint is
drawn on the map, and the measurements are already there. Give the catalog a size filter and show
the footprint; that is better curation than any blocklist, and it does not hide the garages.

## Directive inventory ✅ — counted, not assumed

Every directive present in those 23 files, by frequency. Anything not on this list has never been
seen and is therefore not implemented:

| directive | count | shape |
|---|---|---|
| `EXPORT` | 19 223 | `<virtual> <physical>` |
| `EXPORT_EXCLUDE_SEASON` | 9 980 | `<seasons> <virtual> <physical>` |
| `EXPORT_EXCLUDE` | 5 252 | `<virtual> <physical>` |
| `EXPORT_RATIO` | 2 458 | `<ratio> <virtual> <physical>` |
| `EXPORT_SEASON` | 1 852 | `<seasons> <virtual> <physical>` |
| `EXPORT_EXTEND` | 1 129 | `<virtual> <physical>` |
| `EXPORT_BACKUP` | 1 047 | `<virtual> <physical>` |
| `PUBLIC` | 130 | optional date argument |
| `PRIVATE` / `DEPRECATED` / `SEMI_DEPRECATED` | 94 | bare |
| `REGION` / `REGION_DEFINE` / `REGION_BITMAP` / `REGION_RECT` / `REGION_ALL` / `REGION_DREF` | 125 | |
| `EXPORT_EXTEND_SEASON` | 38 | |
| `EXPORT_RATIO_SEASON` | 2 | `<ratio> <seasons> <virtual> <physical>` |
| `EXPORT_EXCLUDE_BACKUP` | 1 | |

Example, verbatim (the separators are tabs, and there can be any number of them):

```
EXPORT lib/airport/hangars/arched/16x16/rusted_1.obj		Common_Elements/Hangars/hangar_A16x16_02.obj
```

Several exports targeting the **same virtual path** are variants; X-Plane picks among them at
random. The catalog shows them as one entry with a variant count, not as duplicates.

## ★★ Visibility markers — the libraries curate themselves ✅

`PUBLIC`, `PRIVATE`, `DEPRECATED` and `SEMI_DEPRECATED` appear on their own line and apply to
**every export that follows**, until the next marker. They are not annotations on the next line.

This is worth more than it looks. `900 us objects` carries a bare `DEPRECATED` on **line 5** and
never returns to public, so its authors have marked that entire X-Plane 9 era library as superseded.
Across the installation:

| | objects |
|---|---|
| public | 3 490 |
| deprecated | 1 235 |
| private | 1 221 |
| semi-deprecated | 347 |

**39% of the catalog is hidden by the people who wrote it**, at no cost to us. That is the single
biggest piece of curation available, and it arrived free with the format. Offer `public` and
`semi-deprecated`; the rest is library plumbing and legacy.

❓ Not verified: what visibility applies *before* the first marker. Most libraries never declare one.
XOP assumes public, on the grounds that everything predating the markers was usable by anyone.

## The taxonomy is free ✅

```
lib/airport/hangars/arched/16x16/rusted_1.obj
    │       │       │      │     └── variant
    │       │       │      └──────── size
    │       │       └─────────────── style
    │       └─────────────────────── kind
    └─────────────────────────────── domain
```

The category tree is *in the path*. PCT needed a hand-written category table for its 911 objects;
here the first two or three path segments give a usable tree for 10 323 with no curation.

## ⚠️ Two traps, both real

**Case is duplicated.** These both exist in the stock airport library:

```
lib/airport/Common_Elements/vehicles/Large_Fuel_Truck.obj
lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj
```

and both resolve to the same file. Key the catalog on the **exact virtual path string as scanned**.
Never reconstruct a path from memory, and never normalize case — a path that does not resolve fails
silently, with no error and no object.

**The virtual name lies about the physical name.** `Large_Fuel_Truck.obj` resolves to
`Common_Elements/Vehicles/fuel_truck_small.obj`. Display names must come from the virtual path;
the physical filename is an implementation detail of the library that owns it.

**A physical path can contain spaces.** Real: `EXPORT_BACKUP lib/atc/voices/default.voc voices/default
controller/default_Aditi.voc`. Tokenizing the line and re-joining the tail would be lossy, so the
parser takes everything after the virtual path verbatim.

**The library filename's case varies.** Stock packages ship `library.txt`; several third-party ones
ship `Library.txt`. Match case-insensitively when *finding* it — on Windows a case-sensitive match
would silently lose whole libraries in a way the person reporting it could never reproduce.

**A pack can be a junction or a symlink.** ✅ `xOrganizer` and similar tools link packs in from
elsewhere. Node's `readdirSync`/`statSync` follow them; `find` does not, which is how one library
went missing from a first count.

**And X-Plane follows them too** — probe H9, on 12.4.3: a junction under `Custom Scenery` pointing
at a pack on another drive is listed in the startup scenery order under its link name, and the
library inside it resolves for an overlay that references it. This is the **only** way a library
outside the installation is read. An absolute path in `scenery_packs.ini` is not: the simulator
deletes the line (D20).

**Stock libraries contain broken lines.** Five `EXPORT`s in X-Plane 12.4.3 are missing the separator
entirely, so the two paths run together:

```
EXPORT /lib/global8/us/feat_Building_50_40_600r50.obj buildings/B2_d5_32x19.obj   ← fine
EXPORT /lib/global8/us/feat_Building_50_40_600r60.objbuildings/B2_e2_52x25.obj    ← broken
```

Report them, do not guess at them, and do not let five bad lines abort a scan of fifty thousand
good ones.

**A library can export files the package does not ship.** 32 objects in one third-party library
point at files that are not there. The catalog has to survive that, and say so.
