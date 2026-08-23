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

Copy the two pack folders into `Custom Scenery`:

```bash
cp -r "probes/H8/XOP_H8_Ours" "probes/H8/XOP_H8_Control" "D:/Laminar/XP12-Last-Release/X-Plane 12/Custom Scenery/"
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

## Result

*Not yet flown.*
