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

## Result — round 1, flown 2026-08-25, X-Plane 12.4.3

**❌ NO. X-Plane 12 does not load a pack named by an absolute path in `scenery_packs.ini`. It
deletes the line.**

**The view**, from 17L looking east: the stock control tower ✓, the slab ✓, **no pillar**. Both
controls stand, so this is the third row of the reading table and not one of the void ones — the
overlay loaded, and the generated box is a perfectly good object. The slab draws plain grey,
untextured, exactly as an OBJ8 with no `TEXTURE` should.

**`Log.txt`** agrees, and names the one thing that failed:

```
E/SCN: Failed to find resource 'lib/xop/h9/outside_pillar.obj', referenced from
       scenery package 'Custom Scenery/XOP_H9_Overlay/'.
```

**The pack list settles the mechanism.** X-Plane prints what it found at startup — 39 entries, and
the outside pack is in none of them:

```
 33 Custom Scenery/X-Codr Designs Library/
 34 Custom Scenery/XOP_H9_Inside/       ← added by X-Plane itself
 35 Custom Scenery/XOP_H9_Overlay/      ← added by X-Plane itself
 36 Global Scenery/Hsimulators2/
```

**And the line is gone.** After startup the file is the backup plus X-Plane's own two lines, and
nothing else. That is the **gone** row of the second table, which this sheet called decisive before
anybody flew: a setup the simulator erases on every launch is not something to build a feature on.

### ★ The finding that was not the question

**X-Plane is not silent about a virtual path it cannot resolve.** It raises a modal naming the
guilty pack, and writes the reason four times over:

```
E/SCN: Unable to locate object: lib/xop/h9/outside_pillar.obj
E/SYS: MACIBM_alert: There was a problem loading the scenery package:
E/SYS: MACIBM_alert: Custom Scenery/XOP_H9_Overlay/
E/SYS: MACIBM_alert: The scenery may not look correct.
```

"X-Plane resolves a virtual path it cannot find by drawing nothing, silently" is written into
`src/shared/api.ts`, into `measureObjects`, and into H8's sheet. For **an unresolvable virtual
path** it is wrong, and it is the sentence those comments use to justify what they do.

⚠️ What this does **not** establish: the case XOP marks `unavailable` is a different one — the
library exports the path, the path resolves, and the *file behind it* was never shipped. That is a
second route through the loader and nothing here measured it. The comments stay as they are until
it has its own probe.

### What it says about the line that started this

The `SCENERY_PACK D:\…\XPME_South_America/` read off a real user's ini is now two possibilities,
not one. Either that line was equally dead and nobody ever noticed — entirely plausible for
photoscenery that is only served on demand — or the **backslash** spelling is honoured where the
forward-slash one is not. Round 2 is that question.

## Round 2 — the retry the reading table asks for, plus the fallback

Installed, unflown:

- **Two more spellings** appended to the ini, pointing at the same folder. The pack list shows which
  of them, if any, X-Plane accepts, whatever happens in the view:

  ```
  SCENERY_PACK C:\XOP-probe-external\XOP_H9_Outside\
  SCENERY_PACK C:\XOP-probe-external\XOP_H9_Outside/
  ```

  The second is the exact form observed in the wild — backslashes, trailing forward slash.

- **A junction**, `Custom Scenery\XOP_H9_Link` → `C:\XOP-probe-external\XOP_H9_Outside`. This is the
  mechanism the project already believes works and would recommend to a user, on the strength of
  third-party tools using it and nothing else. It has never been measured here either.

The backup taken before round 2 is `scenery_packs.ini.before-H9b` on the Desktop; the pristine
pre-probe one is still beside it as `.before-H9`.

**Same flight: SCEL, 17L, look east.** The two readings do not collide — the pillar appearing says
*some* route worked, and the pack list says which:

| pack list contains | reading |
|---|---|
| `XOP_H9_Link/` only | ✅ Junctions work, absolute paths do not, in any spelling. The catalog may widen only to what `Custom Scenery` reaches, links included — which XOP already reads today. |
| a `C:\…` entry as well | The absolute form works when spelled that way. Record the exact spelling: that is the one XOP would have to read, and the one the ini writer must never produce. |
| neither, and no pillar | Junctions do not work either, and the last supported answer for keeping libraries elsewhere is "do not". |
