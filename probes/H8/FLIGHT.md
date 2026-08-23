# Probe H8 — our own bytes

**Question this probe exists to answer:** does X-Plane 12 load a binary DSF that **XOP wrote
itself**, with DSFTool nowhere in the chain?

If yes, XOP is self-contained: it can produce an installable scenery pack on a machine that has
nothing but X-Plane. If no, every user would have to go and find a separate Laminar tool before the
application could finish its one job.

## Why this is being asked at all

`DSF2TEXT` is DSFTool's interchange format, not one the simulator reads — `X-Plane.exe` contains
`XPLNEDSF` and `sim/overlay` and contains neither `DSF2TEXT` nor `OBJECT_DEF`
([`reference/dsf-overlay.md`](../../reference/dsf-overlay.md)). So somebody has to write binary. This
probe asks whether that somebody can be us.

## What is asserted, and what is not

Asserted, each one already paid for:

- X-Plane finds a pack dropped into `Custom Scenery` **without a line in `scenery_packs.ini`** —
  H0. That is why this sheet does not touch that file: the riskiest step is simply not needed.
- A library virtual path resolves from a pack that ships no assets — H0.
- The three objects used here are in this installation, with these exact names — checked against the
  catalog scan, not from memory. The case of a virtual path is real and a wrong one fails silently.
- Our bytes are readable: DSFTool decompiles `XOP_H8_Ours` back into the three towers at the three
  rotations. That is an independent implementation of the format agreeing with ours.

**Not** asserted, and therefore what the flight measures: whether **X-Plane's own loader** accepts a
file assembled by `src/core/dsf/writeDsfBinary.ts`.

Deliberately not assumed either: that two overlay packs covering the same tile both load. That is
ordinary — landmark packs and airport packs do it constantly — but it has not been verified here, so
the reading below does not depend on it. `Log.txt` names each DSF it loads, so both files can be
accounted for whether or not anything is visible.

## The two packs

Both cover tile `-34-071`, at the spot H0 used: roughly 200 m east of the 17L threshold at **SCEL**.

| pack | written by | what is in it |
|---|---|---|
| `XOP_H8_Ours` | **XOP**, 442 bytes | three control towers, 18 m tall, in an east–west row ~46 m apart, at rotations 0 / 90 / 180 |
| `XOP_H8_Control` | **DSFTool**, the same route H0 and H0b took | one hangar, 16 m square, ~78 m north of the towers |

★ **The control is the point of the sheet.** Without it this probe reads by *absence*: "no towers"
would mean either "X-Plane rejected our bytes" or "the pack was never found", and those have
completely different fixes. The hangar is a signal that must appear whatever our encoder does.

The hangar is a different object from the towers on purpose — nobody is being asked to tell two
identical objects apart by where they are.

Rebuild both with:

```bash
XOP_DSFTOOL="D:/Simuladores/Ortho4XP1.3/Utils/DSFTool.exe" npx tsx probes/H8/make.ts
```

## Install

Copy the two pack folders into `Custom Scenery`. **PowerShell**, which is what this project is
worked in — `cp` there is `Copy-Item`, `-r` is `-Recurse`, and it takes only one positional
argument, so the POSIX form fails with an unhelpful message about a positional parameter:

```powershell
Copy-Item -Recurse -Path "probes\H8\XOP_H8_Ours","probes\H8\XOP_H8_Control" -Destination "D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery"
```

Nothing is written to `scenery_packs.ini` by us. X-Plane will add its own lines for both packs at the
bottom of that file when it starts, as it did in H0; that is X-Plane's doing and it is expected.

## Flight

1. Launch X-Plane 12. Start at **SCEL**, runway 17L.
2. Look east. Quit.

That is the whole flight. The reading is in `Log.txt`, so nothing depends on judging a screenshot.

## How to read the result

**Primary — `<install>/Log.txt`.** Look for the two DSF load lines:

| Log.txt shows | reading |
|---|---|
| **both** packs' `-34-071.dsf` loaded | ✅ X-Plane reads what XOP writes. The encoder is done and DSFTool is never needed again. |
| **control only**, ours absent or with an error beside it | ❌ Our bytes are rejected. Whatever the log says next to it is the actual specification, and worth more than the rest of this sheet. |
| **neither** | Not an encoder result at all — the packs were not found. Check they are in `Custom Scenery` and that X-Plane was restarted. |

**Confirmation — the view.** Three tall towers in a row, and a hangar behind them to the north. The
towers turning 0 / 90 / 180 also re-confirms through our own encoder what H0b read through
DSFTool's: rotation is clockwise, and the tower at 180 faces opposite the one at 0.

## Uninstall

Delete both folders from `Custom Scenery`. X-Plane drops their lines from `scenery_packs.ini` by
itself the next time it starts.

```powershell
Remove-Item -Recurse -Force "D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery\XOP_H8_Ours","D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery\XOP_H8_Control"
```

## Result — flown 2026-08-22, X-Plane 12.4.3

**✅ YES. X-Plane loads what XOP writes.** `Log.txt`, with no error or warning anywhere near either
file:

```
0:00:09.683 I/SCN: DSF load time: 7857 for file Custom Scenery/XOP_H8_Control/Earth nav data/-40-080/-34-071.dsf (0 tris, 0 skipped)
0:00:09.683 I/SCN: DSF load time: 4032 for file Custom Scenery/XOP_H8_Ours/Earth nav data/-40-080/-34-071.dsf (0 tris, 0 skipped)
```

`0 tris` is expected — an object-only overlay contributes no terrain triangles. The control loaded
too, so this is a comparison and not a lone reading.

Confirmed in the view as well: three control towers in an east–west row, and the control pack's
hangar to the north of them. Screenshot taken from 17L looking east.

**Consequence: DSFTool is not a dependency, and never will be** (D10). XOP produces an installable
scenery pack on a machine that has nothing but X-Plane on it.

### Two more facts, measured because the simulator happened to be open

Neither needed a flight of its own, and both were guesses in the code until now.

**X-Plane does not hold `Custom Scenery` files open.** With 12.4.3 running and the pack loaded, all
four of these were *allowed*: opening the loaded `.dsf` for writing, renaming it, renaming the pack
folder, and deleting the pack folder outright. `scenery_packs.ini` is not locked either. The
installer used to tell the user "close X-Plane, it holds on to these files" — a false statement,
now corrected to name no cause it cannot support.

**X-Plane appended its own two lines at startup and changed nothing else**, confirming H0's finding
from a clean before/after rather than from the middle of an unrelated scare:

```
+ SCENERY_PACK Custom Scenery/XOP_H8_Control/
+ SCENERY_PACK Custom Scenery/XOP_H8_Ours/
```

⏳ Still open: whether X-Plane also rewrites that file **on exit**. If it does, a line written while
the simulator is running could be lost — which would be a real reason to install with X-Plane
closed, unlike the locking that turned out not to happen.
