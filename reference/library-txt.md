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

## How many objects ✅

`EXPORT` lines resolving to `.obj`, counted per stock library:

| library | objects |
|---|---|
| `1000 autogen` | 3053 |
| `airport scenery` | 1892 |
| `900 europe objects` | 1388 |
| `sim objects` | 1351 |
| `1000 roads` | 907 |
| `900 us objects` | 705 |
| `900 world object placeholders` | 701 |
| `900 roads` | 217 |
| `1000 world terrain` | 109 |
| **total** | **10 323** |

For scale: PCT's Aerofly catalog held 911 objects. Filtering, categorizing and previewing ten
thousand is a harder problem than the placement itself, and it is where the application will
actually be won or lost.

## Directive syntax ✅

```
EXPORT <virtual path><TAB><TAB><path relative to this package>
```

Example, verbatim:

```
EXPORT lib/airport/hangars/arched/16x16/rusted_1.obj		Common_Elements/Hangars/hangar_A16x16_02.obj
```

The full family ❓ (only `EXPORT` and `EXPORT_SEASON` appear in the stock airport library):

| directive | meaning |
|---|---|
| `EXPORT` | map a path, blocking lower-priority packages |
| `EXPORT_EXTEND` | merge with lower-priority packages instead of replacing |
| `EXPORT_BACKUP` | lowest priority; used only if nothing else defines the path |
| `EXPORT_EXCLUDE` | block lower-priority definitions when region conditions are met |
| `EXPORT_RATIO` | weight one variant against others |
| `*_SEASON` | same, restricted to `spr`, `sum`, `fal`, `win` (X-Plane 12) |
| `REGION_DEFINE` / `REGION_RECT` / `REGION_BITMAP` / `REGION_DREF` / `REGION` | restrict exports geographically or by dataref |

Several `EXPORT` lines targeting the **same virtual path** are variants; X-Plane picks among them at
random. The catalog should show them as one entry with a variant count, not as duplicates.

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
