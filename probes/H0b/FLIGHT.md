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

## Result

_(to be filled in after the flight — record what was seen, not what was expected)_
