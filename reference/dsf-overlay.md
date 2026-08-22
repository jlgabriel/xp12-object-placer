# Overlay DSF

> **Provenance.** Everything marked ✅ was read off a real overlay that X-Plane 12.4.3 loads
> (`Custom Scenery/X-Plane Landmarks - Paris`, written by WorldEditor 2.5.0b2), decompiled with
> `DSFTool --dsf2text`. Everything marked ❓ is from Laminar's published specification and has **not**
> been confirmed against a loading file. Do not promote ❓ to ✅ without a probe.

## Pack layout ✅

```
Custom Scenery/<pack name>/
  Earth nav data/
    +40+000/            <- 10° block, floor of the tile to a multiple of 10
      +48+002.dsf       <- 1° tile, floor of the coordinate
  objects/              <- only if the pack ships its own .obj files
```

Tile naming is the **integer floor** of the south-west corner, latitude first, longitude second,
latitude zero-padded to 2 digits and longitude to 3, both always signed:

| point | tile file | block folder |
|---|---|---|
| 48.8606 N, 2.3376 E | `+48+002.dsf` | `+40+000` |
| 33.3760 S, 70.7846 W | `-34-071.dsf` | `-40-080` |

Note the asymmetry that bites: latitude −33.376 floors to **−34**, and −34 floors to the block
**−40**. Truncation toward zero gives the wrong answer for both.

## Text DSF header ✅

`DSFTool --text2dsf <in.txt> <out.dsf>` compiles this; `--dsf2text` reverses it.

```
I
800
DSF2TEXT

PROPERTY sim/west -71            <- integers, the tile bounds
PROPERTY sim/east -70
PROPERTY sim/north -33
PROPERTY sim/south -34
PROPERTY sim/planet earth
PROPERTY sim/overlay 1           <- makes it an overlay rather than a base mesh
PROPERTY sim/creation_agent XOP  <- free-form; how a pack identifies its author
```

`sim/overlay 1` is what separates an overlay from a base mesh. It is **absent from Laminar's DSF
format specification page** and present in every overlay on disk — a good illustration of why the
specification is a starting point and the disk is the authority.

## Placing an object ✅

```
OBJECT_DEF lib/airport/control_towers/small/14m_Sweden.obj    <- library virtual path
OBJECT_DEF objects/Notre_Dame.obj                             <- or a pack-relative file

OBJECT <defIndex> <lon> <lat> <rotation>
```

Four arguments. **Longitude before latitude.** Definition indices are zero-based, in the order the
`OBJECT_DEF` lines appear.

Both kinds of `OBJECT_DEF` coexist in the same file. That is the whole basis of XOP: a pack that
references only library virtual paths **contains no assets at all** — the Paris overlay mixes both,
and the H0 probe uses only the first kind, weighing 560 bytes.

### What the OBJECT command does not have

- ❌ **No scale.** An object is placed at the size it was modelled.
- ❌ **No elevation.** The object sits on whatever mesh is underneath it.

Both were checked by looking at 784 real `OBJECT` lines. Any design that assumes otherwise is wrong.

## Quantization ✅ — measured, not assumed

DSF stores coordinates in scaled integer pools, so a compile is lossy. Round-tripping four objects
through `--text2dsf` then `--dsf2text`:

- **position: ≈ ±17 cm**
- **rotation: ≈ ±0.005°** (45.000000 came back as 44.995193)

Irrelevant on the ground. It matters for testing: **golden tests must compare the generated text, or
compare compiled output with a tolerance.** Byte-exact comparison of a compiled DSF is not a
meaningful assertion.

Objects sharing a latitude share a quantization step, so their error is identical — useful when
reading a diff.

## Exclusions ✅

```
PROPERTY sim/exclude_obj <west>/<south>/<east>/<north>
PROPERTY sim/exclude_fac …   sim/exclude_for …   sim/exclude_pol …
PROPERTY sim/exclude_net …   sim/exclude_lin …   sim/exclude_str …   sim/exclude_bch …
```

A lon/lat box that suppresses underlying scenery of that kind. Not needed for the first milestones;
it is how XOP would eventually let a user clear default autogen out from under a placement.

## `scenery_packs.ini` ⚠️ — the operational risk

`Custom Scenery/scenery_packs.ini` is a **global, ordered** list:

```
I
1000 Version
SCENERY

SCENERY_PACK Custom Scenery/<pack>/
```

Order decides which pack wins. Users curate it by hand. Unlike Aerofly — where a POI folder was pure
drop-in and uninstalling meant deleting a folder — an X-Plane installer does not write only inside
its own directory.

### ★★ Order is the whole point ✅

**Earlier lines win.** Installing scenery in X-Plane has always meant editing this file by hand to
put the new line in the right place — dropping a folder into `Custom Scenery` is only half the job.
This is the part of installation that XOP has to get right, and the part a naive installer gets
wrong.

The structure, read off a real curated installation (41 lines, 12 airports, 16 landmark packs, a
library and a photoscenery base):

```
I
1000 Version
SCENERY

SCENERY_PACK Custom Scenery/X-Plane Airports - LSEZ Zermatt Heliport/   ← custom airports
SCENERY_PACK Custom Scenery/Aerosoft - LFMN Nice Cote d Azur X/            (highest priority)
…
SCENERY_PACK *GLOBAL_AIRPORTS*                          ← ★ the divider. Not a folder: a marker.
                                                          Custom airports go ABOVE it so they
                                                          override the Global Airports database.
SCENERY_PACK Custom Scenery/X-Plane Landmarks - Paris/  ← overlays: objects, landmarks
…
SCENERY_PACK Custom Scenery/Global_Forests_v2/
SCENERY_PACK Custom Scenery/X-Codr Designs Library/     ← object libraries
SCENERY_PACK D:\…\XPME_South_America/                   ← photoscenery / mesh, last = lowest
```

Four tiers, top to bottom: **custom airports · `*GLOBAL_AIRPORTS*` · overlays · libraries · mesh and
photoscenery.**

**An XOP pack is an overlay** (D2 — it is never an airport), so it belongs in the third tier: below
`*GLOBAL_AIRPORTS*`, above any base-mesh or photoscenery pack. **Appending it at the end of the file
is wrong**, and that is exactly what X-Plane does on its own.

⚠️ Third-party tools write into this file too. Photoscenery downloaders inject their own
`SCENERY_PACK` lines when their service starts, and X-Plane drops those lines again when it rewrites
the file and the folders are not currently being served. So the file is not a stable document owned
by one party — **X-Plane, the user, and other tools all write to it.**

**Rules for the XOP installer:**

1. **Back up `scenery_packs.ini` before touching `Custom Scenery`**, and leave the backup where the
   user can find it.
2. **Write our own `SCENERY_PACK` line, in the overlay tier** — never rely on X-Plane's discovery,
   which appends last and therefore lowest.
3. **Never reorder anything else.** Insert one line and leave every other line exactly where it was.
4. Never write an absolute path.
5. **Say what was done.** Show the user the line and where it went.

### What probe H0 also measured (2026-08-22) ✅

- **X-Plane rewrites this file on every startup**, within seconds of launching.
- **It discovers a new pack in `Custom Scenery/` by itself and appends it last.** Our probe loaded
  from there, so an object overlay does still work in the bottom tier — but that is luck, not
  design, and it would not survive a photoscenery pack above it.

## `Log.txt` ✅

`<install>/Log.txt` is rewritten on every launch of any Laminar application and reports which
scenery packs loaded and which were rejected. It is this simulator's cheapest instrument — the
equivalent of Aerofly's `tm.log`. Read it before concluding anything from what was or was not
visible out the window.
