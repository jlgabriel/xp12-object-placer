# Probe H0b — what the rotation argument means

**One question:** the fourth argument of the DSF `OBJECT` command is a number of degrees. Turning
which way, from what?

H0 asked this and failed to answer it — two trucks 45° apart, 60 m apart along the line of sight,
and the far one too small to read. The failure was in the probe design, not the simulator. This one
is built so the answer cannot be missed.

## The design

Four identical fuel trucks, in a **north–south line, 40 m apart**, at rotations **0, 90, 180, 270**,
northernmost first. Roughly 120 m east of the runway 17L threshold at SCEL — the same field as H0,
next to a runway that runs almost exactly north–south (true bearing ≈ 177°), which gives an
unmistakable reference line in every screenshot.

```
north
  ↑     truck A   rotation 0
        truck B   rotation 90
        truck C   rotation 180
        truck D   rotation 270
south
```

Why this works where H0 did not:

- All four are the **same distance from the camera** if viewed from the side, so all four are
  legible in one frame.
- **90° steps**, not 45° — a quarter turn is unambiguous at a glance.
- Four samples, so the *sense* of the rotation is read from the pattern rather than from one pair.
  If B is a quarter turn clockwise from A, and C from B, the convention is clockwise. If they walk
  the other way, it is counter-clockwise.
- The truck is 5.2 × 2.5 m with a cab at one end: which way it faces is never in doubt.
- The runway supplies north–south. No compass reading required.

**Note what this probe does *not* assume:** that the model faces north at rotation 0. It might face
any direction — that is the second thing being measured, and it comes free. Truck A's facing *is*
the model's authored orientation. Every other object in the library needs the same treatment
eventually, but one worked example settles the convention.

## Install

Copy `XOP_H0b_Rotation/` into `Custom Scenery/`. It is 460 bytes and contains no assets.

⚠️ Back up `Custom Scenery/scenery_packs.ini` first. H0 established that X-Plane rewrites that file
on startup and can silently drop entries — see [H0's result](../H0/FLIGHT.md#result--flown-2026-08-22-x-plane-1243).

## Flight

Start at SCEL. The trucks are just east of the 17L threshold. One screenshot from the side, with all
four trucks and the runway in frame, answers the question.

## How to read it

| what the four trucks do, going north to south | reading |
|---|---|
| each one turned a quarter **clockwise** from the one before (seen from above) | the argument is **degrees clockwise from north** — an ordinary compass heading |
| each one turned a quarter **counter-clockwise** | the argument runs the other way; the app must negate it |
| all four facing the same way | the argument is not rotation, and the placement model is wrong |

Then, separately: whichever way **truck A** points is where the fuel-truck model faces at rotation
0. That number is what the catalog will have to learn per object, or normalize away.

## Result — flown 2026-08-22, X-Plane 12.4.3

Observed from the runway 17L threshold looking east, so north is on the left and the four trucks
read A, B, C, D from left to right.

| truck | rotation | what it showed | facing |
|---|---|---|---|
| A | 0 | broadside, cab on the right | **south** |
| B | 90 | head on, windscreen and cab toward the camera | **west** |
| C | 180 | broadside, cab on the left | **north** |
| D | 270 | head on, tank end toward the camera | **east** |

### 1. The rotation argument is degrees clockwise from north ✅

south → west → north → east is 180° → 270° → 0° → 90°. Heading rises with the argument, so the
rotation runs **clockwise**, the ordinary compass sense. All four samples agree; the reading does not
depend on any single one.

**For the application:** dragging a rotation handle clockwise on the map maps 1:1 onto a rising
`OBJECT` argument. No sign flip anywhere.

### 2. ⚠️ Rotation 0 is not north — it is however the artist left the model ✅

At rotation 0 the fuel truck faces **south**, so for *this* object `heading = rotation + 180`.

That is not X-Plane being strange. The rotation turns the object from its authored orientation, and
this truck was modelled facing +Z, which is south in OBJ8's axes. A different object may be authored
facing any direction at all.

**This is the finding with consequences.** XOP cannot assume "rotation 0 means the object points
north", and it cannot recover the true answer from the file either: which end of a mesh is "the
front" is semantics, not geometry, and OBJ8 does not record it.

What follows:

- The **map footprint must be the rotated bounding box**, which is correct for any object regardless
  of how it was authored. A "nose" arrow would be a guess, and would be wrong for this truck.
- Rotation is therefore something the user sets **by eye against the satellite image**, not by
  typing a compass heading and trusting it. The UI should make turning cheap and continuous.
- If a per-object base heading is ever wanted, it has to be measured or curated per object. It is not
  in the data. Do not invent it.

### Probe design note

H0 asked this same question and failed. H0b answered it in one screenshot. The difference was not
effort, it was geometry: four samples instead of two, 90° apart instead of 45°, on a line
**perpendicular** to the viewing direction so every sample was the same size, beside a runway that
supplied north for free. Redundancy in the probe meant the conclusion never rested on one pixel.
