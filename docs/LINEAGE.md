# Lineage — what XOP takes from PCT, and what it refuses

XOP is a rewrite of the *ideas* behind
[PCT](https://github.com/jlgabriel/afs4-poi-creator), not a fork of its code.

This file exists so that six months from now nobody — human or agent — "fixes" something here by
reintroducing an Aerofly concept that was dropped on purpose. **If you are about to add something
from the right-hand column below, you are about to make a mistake.**

## Taken: the discipline

This is the real inheritance. None of it is code.

| Practice | Why it earned its place in PCT |
|---|---|
| **Probe before design** | Every hard fact about Aerofly cost a flight. Designing on an unverified assumption cost more. |
| **Positive control** | An experiment that reads by *absence* of a signal proves nothing. Put something in it that must produce a signal. |
| **Non-cardinal test angles** | A rotation probe at 0°/90° with a symmetric object is blind to the sign of the rotation. It shipped a real bug before this rule existed. |
| **The simulator's log is the cheapest instrument** | Aerofly's `tm.log` said what loaded and what was rejected without flying. X-Plane's `Log.txt` is the same instrument. |
| **Pure core, no I/O** | PCT's export planner takes a project and returns a file plan. Everything is testable without a filesystem, a window, or a simulator. |
| **Docs written against the code** | Two false statements shipped in PCT's documentation because they were written from notes instead of from source. |
| **Verify the UI in the running renderer** | Every interaction bug in PCT was caught by driving the real DOM, never by unit tests. |
| **The installer touches only its own folder** | A user-named pack once silently overrode a base airport for a week. |
| **Small named milestones** | PCT's history reads `M0`, `M1`, `M1c`, `M1d`, `M1e-1`… one closed slice per commit. |

## Taken: a little code

Under D4 both projects are GPL-3.0, so this is a copy, with attribution in the file header.

- `src/core/geo/geo.ts` — haversine, initial bearing, destination point. **Copied**, ~80 lines. It
  knows about the Earth, not about Aerofly, which is what made it portable.
- `arrange.ts` — row axis, along/cross projection, line-up and even-spacing. ~135 lines. **Not taken
  yet**; it will be, when XOP grows the arrange tools.
- `src/renderer/catalog/previewPosition.ts` — where the hover preview lands beside the row it
  belongs to. **Ported**, ~30 lines. It is about a viewport and a box; the one change is that XOP
  anchors on the whole row rather than on the thumbnail, so the popup opens clear of the panel. The
  popup's *content* did not come across and could not: PCT enlarges a photograph a user supplied,
  because Aerofly's objects cannot be read, while XOP re-renders the object itself (D19).
- `src/core/airports/search.ts` — the typeahead's three tiers (code exact, code prefix, name
  substring) and the accent folding that lets "benitez" find *Benítez*. **Ported**, ~40 lines of
  logic. It is about how people type, not about a simulator. What did **not** come across is where
  the airports come from: PCT ships a list of 7 845 Aerofly airports as data; XOP reads the 38 944
  in the user's own installation instead (D7, D15), which is also why XOP needs a prepared index
  and PCT does not.

`footprint.ts` was on this list at the start of the project and **did not survive contact**. PCT's
version speaks Aerofly's axes (+Y north at direction 0, an origin-centred `scale_factor`, a
`rotateAzimuth` that turns azimuths negative). X-Plane's are +X east and +Z south, the rotation is
plainly clockwise, and there is no scale argument at all. Every line of it would have had to change,
and a copy edited that heavily is a worse starting point than a rewrite — the comments would still
be describing the other simulator. XOP's `src/core/geo/footprint.ts` is written from the OBJ8 axes
directly, and carries its own probe evidence.

So what actually crossed is **~120 lines** out of a 20,000-line application, and saying so plainly
is the point: what transfers between the two projects is judgement, not source.

## Taken: shapes worth copying, reimplemented

Not copied as files — rebuilt against the X-Plane domain.

- The **pure planner → plan → installer** pipeline. PCT's planner returns files and warnings and
  performs no I/O; XOP's `planExport()` will do the same and return a DSF text plus a folder layout.
- **Imperative map layers driven by a diff** against the store, rather than React re-rendering
  Leaflet.
- A **catalog cache** built once by a scan and read cheaply thereafter.
- A committed **renderer preview harness**, so the UI can be verified by DOM before it is committed.
- The **delayed, portalled, pointer-transparent popup** on a catalog row — PCT's `HoverPreview`,
  asked for in its forum thread #170. Same shape, different content (D19).
- **Zod schemas** at the project-file boundary, so a hand-edited or older file fails loudly.

## Refused: the Aerofly domain

None of this survives the crossing. If you see it in this repo, it is a bug.

| PCT concept | Why it dies here |
|---|---|
| `xref`, `PlacedXref` | X-Plane's equivalent is a **library virtual path**, resolved through `library.txt`. Different resolution rules, different failure modes. |
| `heightMode`, `autoheight`, `baked-asl` | A DSF `OBJECT` has **no elevation argument**. Objects sit on the mesh. The entire height subsystem is unnecessary. |
| `scale` | A DSF `OBJECT` has **no scale argument** either. Verified against a real overlay, not assumed. |
| `direction` (Aerofly's `90 − heading`) | X-Plane's fourth `OBJECT` argument is its own convention and gets its own probe. Inheriting the formula would be exactly the mistake this file exists to prevent. |
| `.toc`, `.tsl`, `.tmi`, `.tmb`, `.tap`, `.tsc` | Replaced by one text DSF compiled to one binary DSF. |
| `airport_light`, `plant`, `heliport`, runways, parking | Forbidden by D2. |
| The POI folder-name encoding | X-Plane pack folders are named by the user; the geographic encoding is in the **tile filename**, which is a different thing entirely. |
| The user-measured `footprints.json` | Unnecessary. OBJ8 is readable, so footprints are computed from geometry. |
| User-supplied catalog photos | Unnecessary for the same reason: thumbnails are rendered from the objects themselves — including the enlarged one the hover preview shows. |

## Refused: the structural mistakes

Things PCT did that this repo will not repeat.

- **Scratch files in the repository root.** PCT's root accumulated `suiza.json`, `italia.json`,
  `desierto_v4.json`, `catalog.json`, `scan-out/`. XOP has a git-ignored `scratch/` from commit one.
- **Documentation arriving four versions late.** PCT's guide and README caught up with the
  application at 2.0. Here, `reference/` and `DECISIONS.md` exist before `src/` does.
