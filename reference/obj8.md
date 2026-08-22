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

⚠️ **Textures are frequently `.dds`** (with a `_NML.png` alongside). A thumbnail renderer must
decode DDS — this is confirmed on disk, not a precaution.

Texture paths are relative to the `.obj`, and routinely climb out of its directory:
`../../Dynamic_Vehicles/small.png`.

## ⚠️ Multiple LODs per object ✅

```
ATTR_LOD 0 500
ATTR_LOD 0 1500
```

Stock objects carry two or more LOD ranges. Naively accumulating every `VT` counts the same
geometry more than once. For bounding boxes it barely matters; for a rendered thumbnail it does —
take the nearest range only.

`ATTR_LOD_draped` also appears, and draped geometry (between `ATTR_draped` and `ATTR_no_draped`) is
ground decal, not volume. It should probably be excluded from a bounding box.

## Bounding boxes work ✅

`scripts/objBbox.mjs` computes these from stock objects today:

| object | width (E–W) | height | depth (N–S) | vertices |
|---|---|---|---|---|
| `Common_Elements/Vehicles/fuel_truck_small.obj` | 2.5 m | 2.4 m | 5.2 m | 36 995 |
| `Euro_Airports/…/Tower_Europe_14m_Sweden.obj` | 8.8 m | **18.6 m** | 8.1 m | 8 218 |
| `Common_Elements/Hangars/hangar_A16x16_02.obj` | **16.4 m** | 7.5 m | **16.2 m** | 2 292 |

Two things worth keeping:

- The hangar exported as `…/hangars/arched/16x16/rusted_1.obj` really is 16.4 × 16.2 m. **The
  virtual path does not lie about size**, which makes it a usable search key.
- The tower named `14m_Sweden` is 18.6 m tall. **The name does lie about height**, presumably
  measuring the cab rather than the mast. Display measured dimensions, never parsed-from-the-name
  ones.

## ⚠️ Base Y can be negative ✅

The hangar's geometry starts at −1.50 m — foundations modelled below ground. Framing a thumbnail on
the raw bounding box would waste space and sit the object oddly. Framing should use the above-ground
extent, with the below-ground part clipped.

## Not needed yet ❓

`ANIM_begin` / `ANIM_rotate` / `ANIM_trans` / keyframed variants, datarefs, conditional geometry,
manipulators, lights, particle effects. A catalog thumbnail wants the nearest LOD in its default
animation state, static geometry, diffuse texture. Nothing more.
