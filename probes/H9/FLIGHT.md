# Probe H9 — a library that lives somewhere else

**Question this probe exists to answer:** does X-Plane 12 load a scenery pack that is **not inside
the installation**, named by an **absolute path** in `scenery_packs.ini` — and does that pack's
`library.txt` then resolve for an overlay that references it?

If yes, XOP can offer the objects in those packs honestly: everything it puts in the catalog is
something the simulator can actually draw. If no, the only supported way to keep libraries elsewhere
is a junction or a symlink into `Custom Scenery` — which XOP already reads without knowing it, and
the feature is a documentation change rather than a code change.

## Why this is being asked at all

People keep third-party libraries on another drive. The forum request that started this is exactly
that, and `scanLibraries` looks in two places only: `Resources/default scenery` and `Custom Scenery`.

Widening that is a small change. Widening it **correctly** is not, because X-Plane resolves a
virtual path it cannot find by drawing **nothing at all**, silently. A catalog that offers objects
the simulator will not draw is worse than one that offers fewer — the user places them, exports,
flies out and finds bare grass, with no error anywhere to explain it.

So the catalog may only widen to where X-Plane itself looks. This probe measures where that is.

## What is already known, and what is only suspected

Known, and paid for by earlier probes:

- X-Plane finds a pack dropped into `Custom Scenery` with no line in the ini — H0.
- It rewrites `scenery_packs.ini` at **startup only**, appending its own lines and changing nothing
  else, and does not touch the file on exit — H8.
- It loads a binary DSF that XOP wrote — H8. That is why there is no DSFTool in this sheet.
- A junction or symlink under `Custom Scenery` is followed by `readdirSync`/`statSync`, so packs
  linked in from elsewhere are already in XOP's catalog today — `reference/library-txt.md`.

Suspected, and the reason for the flight: a real curated installation was observed with the line

```
SCENERY_PACK D:\…\XPME_South_America/
```

in it — an absolute path, pointing off the installation drive, in a file a person had been editing
by hand for years (`reference/dsf-overlay.md`). **That the line is there is not evidence that
X-Plane honours it.** It was read off disk; nothing was measured about what the simulator did with
it. This sheet exists because that difference is the whole feature.

## The three packs

All three are generated:

```bash
npx tsx probes/H9/make.ts
```

| pack | where it goes | what is in it |
|---|---|---|
| `XOP_H9_Outside` | **outside the installation** | `library.txt` exporting `lib/xop/h9/outside_pillar.obj` → a 4 × 30 × 4 m pillar |
| `XOP_H9_Inside` | `Custom Scenery` | `library.txt` exporting `lib/xop/h9/inside_slab.obj` → a 20 × 8 × 20 m slab |
| `XOP_H9_Overlay` | `Custom Scenery` | 488 bytes of XOP's own DSF: the pillar, a stock control tower, the slab, in an east–west row 46 m apart |

★ **Two controls, because this probe reads by absence.** "No pillar" on its own means any of three
completely different things, and they have three completely different fixes:

- **The stock control tower** is the overlay's heartbeat. Without it in the view, nothing about the
  other two positions means anything — the pack was never loaded and the flight is void.
- **The slab** is the same generated geometry as the pillar, exported by a library in the ordinary
  place. It separates "X-Plane will not read a library from out there" from "the box I generated is
  not a valid object" — the second would produce exactly the same empty ground as the first.

The two boxes are deliberately different shapes. Nobody is being asked to tell two identical white
boxes apart by which end of a row they are at.

**The objects are generated, not copied.** XOP redistributes no Laminar content, and a probe that
shipped a stock `.obj` inside a pack would be doing precisely that. `make.ts` writes each box, then
reads it back with `src/core/obj8/parse.ts` and refuses to ship one that does not measure what it
meant to — so a box that never appears is at least a box that parses.

## Install

Copy the two ordinary packs in. **PowerShell** — `cp` there is `Copy-Item`, and it takes only one
positional argument, so the POSIX form fails with an unhelpful message:

```powershell
Copy-Item -Recurse -Path "probes\H9\XOP_H9_Inside","probes\H9\XOP_H9_Overlay" -Destination "D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery"
```

Then put the pack under test somewhere X-Plane has no reason to look. **A different drive from the
installation**, which is the case the request actually describes:

```powershell
New-Item -ItemType Directory -Force -Path "C:\XOP-probe-external"
```

```powershell
Copy-Item -Recurse -Path "probes\H9\XOP_H9_Outside" -Destination "C:\XOP-probe-external"
```

## The one line, added by hand

Back the file up first, somewhere findable — this is the file the whole project is careful about:

```powershell
Copy-Item "D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery\scenery_packs.ini" "$env:USERPROFILE\Desktop\scenery_packs.ini.before-H9"
```

Then append exactly one line:

```powershell
Add-Content -Path "D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery\scenery_packs.ini" -Value "SCENERY_PACK C:/XOP-probe-external/XOP_H9_Outside/"
```

**Appended, not inserted.** The bottom of the file is the lowest priority, which is where a library
belongs anyway, and appending is the smallest possible edit to a file somebody else owns. Priority
is not what is being measured — the virtual path is unique to this probe, so nothing can win it.

**Forward slashes, with a trailing one**, matching how every other line in the file is spelled. The
line observed in the wild used backslashes; if the pillar turns out to be missing, that spelling is
the first thing to retry, because "X-Plane ignores absolute paths" and "X-Plane wants them written
the other way" are different answers with different consequences.

## Flight

1. Launch X-Plane 12. Start at **SCEL**, runway 17L.
2. Look east, at the row about 200 m out. Take a screenshot.
3. Quit.

The row runs east–west, so from the threshold it recedes away from you rather than lying across
your view. Nearest is the **pillar** — thin, and at 30 m the tallest of the three. Then the **stock
control tower**. Farthest is the **slab**, wide and low. The three silhouettes were chosen to stay
apart at that angle; nothing here depends on judging a distance.

## How to read the result

**Primary — the view.** Three things in an east–west row, or fewer:

| tower | slab | pillar | reading |
|:---:|:---:|:---:|---|
| ✗ | ✗ | ✗ | Not a result. The overlay never loaded — check `Custom Scenery`, and that X-Plane was restarted. |
| ✓ | ✗ | ✗ | The generated box is not a valid object. Nothing is known about the ini yet; fix the box and fly again. |
| ✓ | ✓ | ✗ | Retry with `C:\XOP-probe-external\XOP_H9_Outside\`. Still missing ⇒ ❌ **X-Plane does not read a pack from an absolute path.** |
| ✓ | ✓ | ✓ | ✅ **Yes.** A pack outside the installation loads, and its library resolves. |
| ✓ | ✗ | ✓ | Odd — the outside pack worked and the inside one did not. Almost certainly `XOP_H9_Inside` landed in the wrong folder. |

**Second reading, free with the same launch — did the line survive?** X-Plane rewrites this file
when it starts (H8). Compare it against the backup:

```powershell
Compare-Object (Get-Content "$env:USERPROFILE\Desktop\scenery_packs.ini.before-H9") (Get-Content "D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery\scenery_packs.ini")
```

| what happened to the line | reading |
|---|---|
| still there, byte for byte | A user's own absolute lines are safe across restarts. |
| still there, **rewritten** — slashes flipped, case changed, moved | Record the exact form. That form is the one XOP should read, and the one to match on. |
| **gone** | Decisive against the whole approach, whatever the view showed: a setup the simulator deletes on every launch is not something to build a feature on. |

**Third — `Log.txt`.** Search it for `XOP_H9` and for `XOP-probe-external`. The overlay's DSF will
be named there, as H8's was. Whether X-Plane also names a *library* pack it loaded is **not known** —
a library contributes no DSF, so there may be nothing at all. If there is a line, copy it into the
result below: it would be a cheaper signal than a flight for every question after this one.

## Uninstall

```powershell
Remove-Item -Recurse -Force "D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery\XOP_H9_Inside","D:\Laminar\XP12-Last-Release\X-Plane 12\Custom Scenery\XOP_H9_Overlay"
```

```powershell
Remove-Item -Recurse -Force "C:\XOP-probe-external"
```

And take the hand-added line back out of `scenery_packs.ini`. X-Plane drops the lines for the two
deleted folders by itself; that one points at a folder it never managed, so it will not. Restoring
the backup over the file is the wrong way to do it — X-Plane has legitimately rewritten the file
since it was taken.

## Result — not yet flown

_To be filled in after the flight: the screenshot, the three ✓/✗, what happened to the line, and
anything `Log.txt` had to say. If the answer is ❌, it goes here in the same words — a probe that
came out against the feature is worth exactly as much as one that came out for it, and this file is
what D20 will point at either way._
