# Decisions

Settled decisions, with the reason. If you are an agent working on this repo: **read this file
before proposing anything.** A decision listed here is not open for re-litigation unless the author
reopens it.

Format: one entry per decision, newest last.

---

## D1 — XOP is a separate application from PCT, not a target inside it (2026-08-22)

PCT (Aerofly FS 4) will not grow an X-Plane exporter. Two applications, one per simulator.

**Why:** the author's words — *"prefiero uno para cada sim, es más limpio, no me gusta mezclar
cosas"*. Beyond taste, the assets are not equivalent: an Aerofly hangar is not an X-Plane hangar,
so a shared project file could never round-trip. A shared codebase would buy nothing and cost
`if (simulator === …)` in every layer.

**Consequences:** no shared package, no runtime dependency, no "simulator adapter" abstraction, no
compatibility with PCT project files. Ever.

---

## D2 — XOP does not build airports (2026-08-22)

No `apt.dat`. No runways, taxiways, parking, glider starts, helipads, ICAO codes, airport metadata.

**Why:** *"volvería a lo fundamental de la app que es colocar objetos en el escenario de manera
simple, geográficamente, en un aeropuerto o en cualquier lado"*. X-Plane draws a clean line between
the airport (`apt.dat`) and overlays that place objects; XOP lives entirely on the overlay side.

**Consequences:** the project model has no notion of an airport. The app never asks *"which airport
do you want to edit?"* — it asks *"where do you want to work?"* and the map answers. This is also
the guardrail that keeps XOP from slowly turning into a worse WED.

⚠️ **This is not a scope limitation to be relaxed once the basics work.** It is what the application
*is*: decorate the scenery by placing objects. Airport authoring is a different job, WED already
does it, and every step toward it makes this tool worse at the one thing it is for. Treat a request
to "just add runways" the way you would treat a request to delete the map.

---

## D3 — Vocabulary is X-Plane's, from the first commit (2026-08-22)

Nothing named `xref`, `heightMode`, `autoheight`, `direction`, `PlacedXref`, `.tsl`, `.tmi`, `poi`.
The domain words are `libraryPath`, `OBJ8`, `library.txt`, `DSF`, `overlay`, `Custom Scenery`.

**Why:** a type that keeps its old name keeps its old semantics. Aerofly concepts would leak in
through naming alone.

---

## D4 — License: GPL-3.0 (2026-08-22)

Same as PCT.

**Why:** it lets us lift code from PCT directly where that is the right move (the portable geometry
helpers are ~285 lines) with no license analysis. Consistency across the author's tools. Decided
*before* any code was copied, on purpose — MIT would have been possible only if chosen first, since
GPL code cannot be relicensed by copying it.

---

## D5 — Named **XP Object Placer**; repository `xp12-object-placer`, private until it works (2026-08-22)

The product is **XP Object Placer**. `XOP` is the short form and stays in the code — IPC channels,
the pack manifest, CSS classes, these docs — where it remains an accurate acronym. The repository
name is unchanged: it already follows the author's `<sim>-<what>` pattern (`afs4-poi-creator`).

**Why this name:** it *is* the search query. This project has no community to spread it by word of
mouth — that was stated as a fact about the X-Plane ecosystem before a line was written — so the
name has to be findable by someone who has never heard of it, and what that person types is
"x-plane object placer". A coined name has to be told to you by somebody first; a description is
found on its own. "Object placer" is also established vocabulary everywhere else — FSX had an
Object Placement Tool, Blender and Godot have theirs — while in X-Plane the slot is empty: WED is a
full airport editor, OverlayEditor is abandoned. And it promises exactly what D2 allows, no more.

**Why `XP` and not `X-Plane`:** X-Plane is Laminar's trademark. The ecosystem convention is
"for X-Plane" in the description, not the trademark inside a product name.

**Why "Scenery" is not in the name:** in X-Plane, *scenery* names the content, never the tool — the
folder is `Custom Scenery`, the forum category is Scenery Packages, and developers sign their
products that way. No tool in the ecosystem carries the word. It does have a place, though: the
default pack this app installs is called "XP Object Placer Scenery". That is content, which is
where the convention wants it.

**Considered and rejected:** `XPlace` — one letter from
[xPlaces](https://forums.x-plane.org/files/file/70777-xplaces), a scenery plugin that puts pins on
the world; the app would lose every search to it. `XPScatter` — taken, and "scatter" promises
procedural placement, which this is not. `XPProps` — in a flight simulator, props are propellers.
`Diorama`, `Maquette`, `Stipple` — coined names, and a coined name needs the word of mouth
this project does not have.

**Why private:** PCT opened publicly because it had a reviewer (ApfelFlieger on the Aerofly forum)
whose feedback drove several releases. The X-Plane community is not expected to play that role here,
so opening early would expose the probe-and-stumble phase for no review in return. It goes public
when it is worth installing.

---

## D6 — Probe before design (2026-08-22)

Inherited from PCT and kept deliberately: before designing a feature, verify it is **possible**.
Facts about the simulator come from the disk or from a flown probe, never from a specification read
casually and never from memory.

**Why:** already earned twice on day one. Laminar's own DSF format specification does not mention
`sim/overlay`, and the `OBJECT` command has no scale argument despite plausible-sounding advice to
the contrary. Both were settled by decompiling a real overlay that X-Plane loads.

**Consequence:** probes live in [`probes/`](../probes/) and stay in the history. Each one carries a
flight sheet stating what it asks and what each possible reading means. A flight sheet that asserts
more than it verified wastes a flight.

---

## D7 — Zero assets (2026-08-22)

XOP never ships, bundles, or redistributes Laminar content — not objects, not textures, not
generated thumbnails of them, not "just the metadata".

**Why:** carried over from PCT as a bright line. It is also easier to hold here than it was there:
because OBJ8 is readable, XOP can generate everything it needs on the user's machine from the user's
own installation, into a local cache.

---

## D8 — The installer writes the `scenery_packs.ini` line itself (2026-08-22)

XOP inserts its own `SCENERY_PACK` line, **immediately below the `*GLOBAL_AIRPORTS*` marker**, at
the top of the overlay tier. It backs the file up first, reorders nothing else, and shows the user
the exact line it wrote and where.

**Why it writes at all:** in X-Plane, copying a folder into `Custom Scenery` is half of installing
scenery — the load order in `scenery_packs.ini` decides what actually wins, and editing it has
always been a manual step. Leaving that to the user leaves the installation unfinished at precisely
the point where people get it wrong. X-Plane does eventually discover the pack by itself, but it
appends it **last**, which is the wrong tier: below photoscenery and mesh.

**Why the top of the overlay tier:** these objects are something the user placed deliberately, one
by one, on a map. Where they meet a landmark pack or a third-party overlay over the same tile, the
user's own work should win. Custom airports stay above, because an XOP pack is never an airport (D2).

**Constraints this puts on the installer, permanently:**

- Back up `scenery_packs.ini` before touching `Custom Scenery`, somewhere the user can find it.
- Insert exactly one line. **Never reorder, rewrite or normalize anything else.** The rest of that
  file is the user's, and other tools write to it too — photoscenery downloaders inject their own
  lines when their service starts, and X-Plane drops them again later. XOP is a guest in that file.
- Never write an absolute path.
- Uninstalling removes the folder **and** the line.

---

## D9 — The map draws a turned box and an anchor, never a heading arrow (2026-08-22)

A placed object is drawn as its real ground rectangle from OBJ8, turned by its rotation, with a dot
on the model origin. The rotate grip is a control in its own colour on a dashed arm, shown only
while the object is selected, and its readout says **"rotation"**.

There is no nose arrow, no facing tick, and no field anywhere that calls a rotation a heading.

**Why:** rotation 0 does not mean "facing north" — it means "as the artist modelled it". The stock
fuel truck faces **south** at rotation 0 (probe H0b). An object's real compass heading is
`artistBaseHeading + rotation`, and `artistBaseHeading` is not recorded anywhere in OBJ8; which end
of a mesh is "the front" is semantics, not geometry, and no amount of parsing will recover it.

So an arrow would be a drawing of something we do not know, wrong for a large part of the library,
and confidently wrong — which is worse than saying nothing. A box is a fact. The user turns the
object **by eye against the imagery**, which is how you would judge it anyway.

The grip hangs off the model's `-Z` side, which makes its compass bearing equal the rotation value
exactly. That is a readability decision, not a claim: drag the grip to a bearing and the number that
goes into the DSF is that bearing, with no offset and no sign flip.

**Consequences:**

- No `heading` field, no `heading` label, no "facing" arrow, ever.
- The anchor dot is drawn separately from the box **because the two are usually not in the same
  place**: measured over the real catalog, only 55% of objects have their origin at the centre of
  their own ground box, and 13% are more than ten metres off it (`reference/obj8.md`). The catalog
  therefore carries the ground rectangle, not a width and a depth, and the difference between where
  you clicked and where the building lands is visible instead of surprising.
- If a future version wants to show a heading, it has to get the base heading from somewhere real —
  a user saying so, per object — and store it as what it is: a guess the user made.

---

## D10 — XOP writes the binary DSF itself; DSFTool is not a dependency (2026-08-22)

`src/core/dsf/writeDsfBinary.ts` produces the file X-Plane loads. The application needs no external
tool, and never shells out to one.

**Why it has to write binary at all:** `DSF2TEXT` is DSFTool's interchange format, not one the
simulator reads. Asked of `X-Plane.exe` directly — with controls, so that an absence could be read
as an answer — `XPLNEDSF` and `sim/overlay` are present and `DSF2TEXT` and `OBJECT_DEF` are not
(`reference/dsf-overlay.md`). Writing the text is half the job.

**Why not just call DSFTool:** it does not ship with X-Plane. It is a separate download from
Laminar's developer site, and most people who fly X-Plane have never heard of it. Requiring it would
leave XOP unable to finish its one job on a machine that has the simulator installed — the same
half-done installation D8 exists to refuse. It would also mean the privileged layer executing a
third-party binary on a user-supplied path, which is a security surface this application does not
otherwise have.

**Why writing it ourselves is not reckless:** the shape was not taken from the specification. Probe
H0b's text was compiled by DSFTool into a 460-byte overlay that X-Plane 12.4.3 loaded and flew, and
that file was taken apart byte by byte — atoms, pool grid, plane encoding, command stream. The
encoder reproduces it, including the two empty 32-bit pools whose purpose is not established,
because twenty bytes is cheaper than finding out from a flight.

It is checked three ways: unit tests against byte sequences read out of that flown file; DSFTool
decompiling our own bytes back into the placement we meant, including a case with 300 definitions
where the 8-bit command cannot say which one; and probe H8, which puts a pack we wrote and a pack
DSFTool wrote side by side in the simulator with a positive control between them.

**Consequences:**

- A DSF is written once, in one place. `writeDsfText` stays, but as a debugging and golden-test
  convenience, not as a step in the export.
- The pool grid is eighths of a degree because that is what DSFTool uses, which keeps XOP's
  placement precision identical to WED's (~21 cm). Do not "simplify" it to one pool per tile: that
  is 1.7 m, and it would be invisible in a test and obvious in the simulator.
- Both writers validate through the same `assertPlaceable`, so they can never disagree about what
  they refuse.

---

## D11 — The first public release is 1.0.0 (2026-08-22)

There will be no public 0.x. The first version anyone can install is **1.0.0**.

**Why:** the 0.x phase already happened, in private and on the sister project. PCT learned its
lessons in public across a dozen releases; XOP has been built on those lessons since its first
commit — pure core before UI, the format confirmed in the simulator before the UI existed, the
privileged layer reviewed early, docs written against the code. D5 already keeps this repository
private until it is worth installing, so the version number should say the same thing the release
does: this is finished work, not an experiment asking for the patience of users who are not there.

**What that costs.** 1.0 is a promise rather than a number, and three things have to be true before
the tag that are not true today:

- **A layout has to survive closing the window.** Placed objects live only in the renderer store.
  Settings persist; the work does not. Place forty objects, close the app, and they are gone — and
  there is no way back in either, because XOP writes DSF and does not read it. Nothing in the
  milestone queue covers this, which is exactly why fixing the target version was worth doing now.
- **Thumbnails (H4).** Choosing among 3 837 objects by name is work, not browsing.
- **The pack manifest and the ini line become contract.** After 1.0, `xop-pack.json` and the shape
  of the line written into `scenery_packs.ini` cannot change without an upgrade path: a pack
  installed by 1.0 must still be removable by 1.1.

`package.json` stays at `0.0.0` until the release commit.
