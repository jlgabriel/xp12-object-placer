# OBJ8 — the object format

> **Provenance.** ✅ = parsed from stock X-Plane 12.4.3 objects on disk. ❓ = from Laminar's OBJ8
> specification, not yet exercised by XOP.

X-Plane's object format is **plain text**, documented, and expressed in **metres**. This is the
single biggest difference from the Aerofly work: geometry is readable, so footprints, dimensions and
thumbnails can all be derived from the source rather than measured by hand or photographed by the
user.

## Header ✅

```
I           <- or A. Line-ending hint, ignored in practice
800
OBJ
```

## Axes and units ✅

`+X` east, `+Y` up, `+Z` south. Metres. Origin on the ground at the object's insertion point.

## ⚠️ Fields are TAB-delimited, not space-delimited

```
VT⇥-0.88598496⇥1.1085184⇥-0.51666558⇥-0.9392547⇥…
```

A parser testing `line.startsWith('VT ')` returns **zero vertices, silently, with no error**. This
cost two attempts and one wrong hypothesis (Mac line endings) on the first day. Match `/^VT\s/` and
split on `/\s+/`.

## Records that matter for a catalog ✅

```
POINT_COUNTS <tris> <lines> <lites> <indices>
VT <x> <y> <z> <nx> <ny> <nz> <s> <t>
IDX <n>  ·  IDX10 <n×10>
TRIS <offset> <count>
```

Textures — X-Plane 12 stock objects use all of these:

```
TEXTURE                 TEXTURE_LIT            TEXTURE_NORMAL
TEXTURE_MODULATOR       TEXTURE_DRAPED         TEXTURE_DRAPED_NORMAL
NORMAL_METALNESS        GLOBAL_specular
```

⚠️⚠️ **The `.png` an object names is usually a `.dds` on disk.** X-Plane substitutes the extension,
and on a stock installation the `.png` is very often not there at all. Counted across 12.4.3:
**3 193 of 3 446 albedo references resolve only after the swap** — 93%. Anything that trusts the
extension in the OBJ finds almost nothing.

What is actually behind those 3 446 references: **424 distinct DDS files** (atlases, shared many
times over), in **two formats only — DXT1 and DXT5**, and **every one of them has mipmaps**. No
BC7, no DX10 header. A thumbnail therefore never decodes a 2048² face: it reads the stored level
that covers 256 pixels, and `WEBGL_compressed_texture_s3tc` uploads those blocks to the GPU
without decompressing them at all.

⚠️ **Texture coordinates put v=0 at the BOTTOM**, while a DDS stores its first row at the top, and
`UNPACK_FLIP_Y_WEBGL` is ignored for compressed textures. The flip has to happen in the shader.
Without it every object samples the mirror image of its own atlas — which does not error, and does
not look like a bug: an orange barrier simply comes out grey, because it is reading the white one.

Texture paths are relative to the `.obj`, and routinely climb out of its directory:
`../../Dynamic_Vehicles/small.png`.

## ⚠️ Multiple LODs per object ✅

```
ATTR_LOD 0 500       ← both start at 0, so both are drawn up close
ATTR_LOD 0 1500
```

vs

```
ATTR_LOD 0 1000      ← alternatives; only one is drawn at a time
ATTR_LOD 1000 6000
```

Both shapes are in stock objects, and they mean different things. "Take the first LOD" is wrong for
the first shape — it would lose the main body and keep only the detail pass.

**The rule that works for both: include every block whose `near` distance is 0.** That is exactly
what is drawn when you stand next to the object.

`ATTR_LOD_draped` also appears; it is a draw distance for draped geometry, not a geometry LOD.

## ⚠️★ Draped geometry must be excluded from the footprint ✅

Geometry between `ATTR_draped` and `ATTR_no_draped` is a ground decal — an apron, a taxiway marking,
a stain — and it can be **many times wider than the object it belongs to**. **914 of 3 706** measured
objects have some.

A bounding box over every `VT` folds the decal into the building, and the footprint drawn on the map
would be several times too large. The parser resolves the index table, walks the command stream, and
measures only the triangles that are both non-draped and drawn at close range.

Objects that are draped *and nothing else* — a pavement drain, a painted marking — are still
perfectly placeable. Their footprint is the draped extent, so measure that instead of discarding
them.

## Bounding boxes work — and they are validated at scale ✅

`src/core/obj8/parse.ts` measured **3 706 of the 3 837 placeable objects** in a real installation, at
about 250 objects per second. Of the 131 it could not: 99 are empty stubs and 32 point at files
their package does not ship.

The stubs are worth knowing about. `lib/legacy/radio_tower.obj` and its neighbours contain a valid
OBJ8 header and **nothing else** — no `POINT_COUNTS`, no `VT`, no `TRIS`. They exist so that old
scenery referencing those virtual paths still resolves. Reporting them as unmeasurable is right;
they are placeholders, not objects.

★★ **The names are free ground truth.** Many library paths encode the object's dimensions —
`hangars/arched/16x16/`, `shelters/white/11x15.obj`. Comparing the parsed geometry against the
number in the name, across every object that carries one:

> **163 of 163 agree within 15%.**

That is a validation nobody had to write fixtures for. It came out of the data, and it covers far
more ground than any hand-written test could.

| object | width (E–W) | height | depth (N–S) | vertices |
|---|---|---|---|---|
| `Common_Elements/Vehicles/fuel_truck_small.obj` | 2.5 m | 2.4 m | 5.2 m | 36 995 |
| `Euro_Airports/…/Tower_Europe_14m_Sweden.obj` | 8.8 m | **18.0 m** | 8.1 m | 8 218 |
| `Common_Elements/Hangars/hangar_A16x16_02.obj` | **16.4 m** | 6.0 m | **16.1 m** | 2 292 |

Both the tower and the hangar read smaller here than a naive bounding box over every `VT` gives
(18.6 m and 7.5 m tall, 16.2 m deep). That is the parser being right, not losing something: height
now excludes the foundations below ground, and the hangar's depth excludes its draped apron.

Two more things worth keeping:

- The hangar exported as `…/hangars/arched/16x16/rusted_1.obj` really is 16.4 × 16.2 m. **The
  virtual path does not lie about size**, which makes it a usable search key.
- The tower named `14m_Sweden` is 18.6 m tall. **The name does lie about height**, presumably
  measuring the cab rather than the mast. Display measured dimensions, never parsed-from-the-name
  ones.

## ⚠️★★ The model origin is NOT reliably in the middle of the object ✅

**Measured 2026-08-22** over a 742-object sample of the real catalog (every fifth measured object,
so the sample spans the whole alphabet rather than one library):

| where the origin sits, relative to its own ground box | share |
|---|---|
| at the box **centre**, within ±0.5 m on both axes | **54.6%** |
| on **one edge**, centred on the other axis | 15.6% |
| at a **corner** — on both edges | 2.4% |
| somewhere else entirely | 27.4% |

Or by how far off it is: **31% are more than 2 m off their own centre, and 13% are more than 10 m
off.** The worst in the sample is a hangar 60 m from the middle of its own bounding box.

Real, checkable examples: `XCDL/Objects/Structures/ILS.obj` is 32.5 m long with its origin 0.5 m
from one end; `XCDL/Objects/Vehicles/Semi_Truck.obj` is anchored at the cab, 7 m off centre; every
`lib/airport/aircraft/airliners/*` is anchored near the nose gear.

⇒ **A footprint drawn as `width × depth` around the coordinate is wrong for nearly half the library,
and wrong by a building's length for one object in eight.** The catalog carries the ground rectangle
(`minX/maxX/minZ/maxZ`) and not just a size, and the map draws the anchor dot separately so the
difference between *where you clicked* and *where the building lands* is visible rather than
surprising. See `GroundBox` in `src/core/model.ts`.

There is no convention to lean on here: 55% centred is not a rule, it is a coin toss.

## ⚠️ Base Y can be negative ✅

The hangar's geometry starts at −1.50 m — foundations modelled below ground. Framing a thumbnail on
the raw bounding box would waste space and sit the object oddly. Framing should use the above-ground
extent, with the below-ground part clipped.

## Not needed yet ❓

`ANIM_begin` / `ANIM_rotate` / `ANIM_trans` / keyframed variants, datarefs, conditional geometry,
manipulators, lights, particle effects. A catalog thumbnail wants the nearest LOD in its default
animation state, static geometry, diffuse texture. Nothing more.
