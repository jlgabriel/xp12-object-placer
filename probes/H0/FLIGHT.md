# Probe H0 — first light

**Question this probe exists to answer:** does X-Plane 12 load an overlay we wrote ourselves, and
what exactly does its `OBJECT` rotation argument mean?

Everything else in this project depends on the answer. It is deliberately the first thing built.

## What is asserted, and what is not

Asserted (verified before the flight, see [`reference/dsf-overlay.md`](../../reference/dsf-overlay.md)):
the text DSF header, the `OBJECT` argument order, the tile and folder naming, and that DSFTool
compiles this file without complaint.

**Not** asserted, and therefore what the flight measures:

1. that X-Plane accepts a DSF written outside WED at all;
2. what the fourth `OBJECT` argument means;
3. whether objects sit on the terrain;
4. whether a library virtual path resolves from a pack that ships no assets;
5. what X-Plane does to `scenery_packs.ini` when it finds a pack that is not listed in it.

## The pack

Installed at `Custom Scenery/XPOP_H0_Probe/`. 560-byte DSF, no assets, no `objects/` folder.

`Custom Scenery/scenery_packs.ini` was backed up to `scenery_packs.ini.before_XOP_H0.bak`
immediately before installation. **The probe's line was deliberately not added** — question 5 is
answered by diffing the two files after the flight.

## Where

Roughly 200 m east of the runway 17L threshold at **SCEL** (Santiago). Coordinates taken from the
installation's own `apt.dat`, not from an external source. Four objects in an east–west row, 60 m
apart:

| # | object | rotation arg | purpose |
|---|---|---|---|
| 1 | fuel truck | `0` | reference |
| 2 | fuel truck | `45` | **the rotation reading** |
| 3 | control tower, 18.6 m tall | `0` | terrain contact on a tall object |
| 4 | hangar, 16.4 × 16.2 m | `90` | second rotation reading, large footprint |

The fuel truck is 5.2 m long and 2.5 m wide, so which way it faces is unambiguous at a glance. The
two trucks are 60 m apart and are the only two identical objects present; nothing in this sheet asks
anyone to tell identical objects apart by position.

## Flight

1. Launch X-Plane 12. Start at SCEL, runway 17L.
2. Look east. All four objects should be together, in a row.
3. Note which way truck #2 points relative to truck #1.
4. Quit.
5. `Log.txt` and the `scenery_packs.ini` diff are read afterwards.

## How to read the result

**Q1 — did it load?** Any object visible is a yes. If nothing is visible, `Log.txt` says whether the
pack was found and rejected, or never found at all. Those are different failures with different
fixes.

**Q2 — what is the rotation argument?** Truck #1 points somewhere; truck #2 is the same object at
`45`.

| truck #2 points | reading |
|---|---|
| **north-east** relative to #1 | the argument is a **compass heading, clockwise from north** |
| **north-west** relative to #1 | it is **counter-clockwise** — negate it |
| the same way as #1 | the argument is not rotation at all, and the whole placement model needs rework |

The hangar at `90` is the confirmation: it should be a quarter turn from the tower's orientation, in
the same sense.

**Q3 — terrain.** The tower is 18.6 m tall with its geometry starting 0.6 m below its origin. If it
floats or is buried, objects are not simply mesh-relative and elevation needs its own probe.

**Q4 — virtual paths.** The pack contains no `.obj` files. If the objects appear, a virtual path
resolves from a foreign pack, and XOP can ship packs containing nothing but a DSF. If they do not
appear but the pack loaded, resolution is the problem, not the DSF.

**Q5 — `scenery_packs.ini`.** After quitting, diff against the backup. Three possible readings:
X-Plane added the line and where; X-Plane rewrote the ordering; or X-Plane left the file alone,
meaning an installer must write the line itself and must decide where to put it.

## Result — flown 2026-08-22, X-Plane 12.4.3

**Q1 — did it load? YES.** `Log.txt`:

```
 33 Custom Scenery/XPOP_H0_Probe/
0:00:40.183 I/SCN: DSF load time: 6599 for file
  Custom Scenery/XPOP_H0_Probe/Earth nav data/-40-080/-34-071.dsf (0 tris, 0 skipped for 0.0 m^2)
```

No errors, no warnings about the pack. `0 tris` is expected: an object-only overlay contributes no
terrain triangles.

**Q4 — do library virtual paths resolve from a pack that ships nothing? YES.** The objects are
visible in the simulator and the pack is 3 KB with no `objects/` folder. **This is the finding the
whole application rests on:** an XOP scenery pack can be a single DSF and nothing else.

**Q3 — terrain contact: yes, provisionally.** The tower and the trucks sit on the ground with no
float and no sinking, judged from screenshots. Good enough to proceed; revisit on sloped ground.

**Q2 — rotation: NOT ANSWERED.** The two trucks were 60 m apart along the line of sight, so the far
one was too small to read an angle from. This is a flaw in *this sheet*, not in the simulator: 45°
between two small objects at different distances is not a legible reading. Superseded by probe
[H0b](../H0b/FLIGHT.md), which uses four trucks at 90° steps on a north–south line.

**Q5 — `scenery_packs.ini`: X-Plane rewrites it on every startup, and it removed four of the user's
entries.** Our pack was appended last:

```
+ SCENERY_PACK Custom Scenery/XPOP_H0_Probe/
- SCENERY_PACK D:\Simuladores\XPlane Map Enhancement Base\XPME_Overlays/
- SCENERY_PACK D:\Simuladores\XPlane Map Enhancement Base\XPME_Europe/
- SCENERY_PACK D:\Simuladores\XPlane Map Enhancement Base\XPME_North_America/
- SCENERY_PACK D:\Simuladores\XPlane Map Enhancement Base\XPME_South_America/
```

**Resolved afterwards, and it is benign.** Those four lines are not hand-written user entries: they
are injected by a photoscenery downloader when its service starts, and X-Plane drops them again when
it rewrites the file with that service not running. Nothing was lost — starting the service puts
them back. Our pack did not cause it.

**What remains proven, and matters more than the false alarm:**

- X-Plane rewrites `scenery_packs.ini` on every startup and **appends a newly discovered pack last,
  which is the lowest priority slot.**
- The file is not owned by one party. X-Plane, the user, and third-party tools all write to it.
- **Order is the substance of installing scenery in X-Plane.** Reading the real file revealed the
  tier structure and the `*GLOBAL_AIRPORTS*` divider — now documented in
  [`reference/dsf-overlay.md`](../../reference/dsf-overlay.md#-order-is-the-whole-point-). Our probe
  worked from the bottom tier by luck; a photoscenery pack above it would have changed that.

**Consequence for XOP:** the installer writes its own line, in the overlay tier, after backing the
file up, and reorders nothing else. Dropping a folder into `Custom Scenery` is half the job.

**Method note.** The alarm was raised on real evidence and retracted on better evidence, which is
the process working. The lesson worth keeping is narrower: *a diff proves what changed, never who
changed it.* Two consecutive launches cannot separate a correlation from a cause, and the domain
knowledge that settled it was one sentence from someone who had used the tool.
