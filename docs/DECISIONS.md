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

- ~~**A layout has to survive closing the window.**~~ **Done (2026-08-22)** — see D12. Nothing in
  the milestone queue had covered it, which is exactly why fixing the target version was worth
  doing when it was.
- ~~**Thumbnails (H4).**~~ **Done (2026-08-22)** — see D13.
- ~~**The pack manifest and the ini line become contract.**~~ **Done (2026-08-22)** — see D14.

`package.json` stays at `0.0.0` until the release commit.

---

## D12 — A project is one `.xop` file, and the pack carries a copy (2026-08-22)

Work is saved as a single JSON document with a `.xop` extension: New, Open, Save, Save As, an
unsaved-work mark in the title, and a guard on closing the window.

**Why a document and not a session.** Remembering the last thing you had open would have been less
work and would have answered the original complaint — close the app, lose the objects. But it gives
you exactly one piece of work at a time. Somebody decorating SCEL and Valparaíso has two, and
neither can be handed to anyone else. A file can be copied, renamed, put in Dropbox and sent.

**What it does not record: the installation.** Objects are named by library virtual path, the same
string in any installation that has the library. A project opened on a machine missing one keeps
the object and shows it as *not installed*, which the catalog and the map already know how to do.
Discarding somebody's work because their libraries changed would be the worst reading of "safe".

**The copy inside the pack.** Every exported pack contains `project.xop`. This application writes
DSF and does not read it, so without that copy an installed pack is a dead end — the objects are in
the simulator and there is no way back to editing them. It is emitted by `planExport` as a pack
file like any other, so it inherits the installer's atomicity and appears in the manifest; a
sidecar written afterwards would have had neither. `planExport` therefore takes the whole
`Project` rather than a list of objects, which also removes the way the scenery and the copy could
have disagreed about what was placed.

**Unsaved work is tracked by subscription**, not by each action setting a flag. The action that
forgets is the one that loses work silently, because the close guard would then release the window
without asking. Panning the map is not an edit.

**Main owns the paths**, as everywhere else: the renderer says new/open/save/save-as and never
where. The `path` in `DocumentState` travels outward only, to be displayed.

---

## D13 — Thumbnails: drawn here, on demand, from the user's own files (2026-08-22)

Every catalog row carries a picture of its object, rendered in the window with WebGL from the
geometry and texture already installed on the machine. Nothing is downloaded, nothing is shipped,
and the cache lives in userData — the same standing rule as everything else (D7).

**WebGL directly, no scene library.** One mesh, one light, a fixed camera. The hard part is framing,
and framing is arithmetic that belongs in `core` where it can be tested by projecting the corners of
a bounding box — no GPU, no eyeballing. A dependency would have bought about 170 lines and cost
600 KB in a project that has five dependencies.

**On demand, not up front.** Of 3 700 objects a person looks at a few dozen. A row asks for its
picture when it comes near the screen; the answer is kept in memory for the session and on disk
after that. Drawing all of them at scan time would add minutes for work mostly nobody wants.

**No worker.** This was going to be OffscreenCanvas in a worker until the drawing was measured at
one millisecond. The time is in reading the `.obj` and the atlas, which happens in main, off the
renderer's thread already. If a very heavy object ever makes this stutter, the renderer accepts any
canvas and the move is small.

**Ground decals draw their draped geometry.** 476 objects of 3 706 have no solid geometry at all —
markings, drains, stains. The parser excludes draped triangles from bounds on purpose, because a
footprint measured from them would be wrong, but for a thumbnail they are the entire object. They
are framed from nearly overhead, since the three-quarter view turns a taxiway line into a thread.

**16 MB is the ceiling on an object worth previewing.** Parsing runs at roughly 22 ms/MB in main,
where a long one freezes the window; one stock oil platform is 63 MB and takes 1.4 seconds. Three
objects out of 3 706 are over the line and lose their picture. If that becomes the wrong trade, the
work belongs in the utilityProcess the scanner already uses.

**A rescan throws the pictures away.** It is the only moment an object can change underneath one.

**Two rules that are not preferences**, both in `reference/obj8.md` with the counts behind them: the
`.png`→`.dds` substitution, without which 93% of the library renders grey; and the v flip in the
shader, without which every object samples the mirror image of its own atlas — silently, and
plausibly enough to look intentional.

---

## D14 — What an installed pack promises, from 1.0 onwards (2026-08-22)

An exported pack is written into somebody's simulator and stays there, outliving the build that
wrote it and probably their memory of making it. Two things about it are frozen:

**A folder is ours if and only if it contains `xop-pack.json` with a non-empty `packName`.** That
test never gets stricter. Requiring another field later would orphan every pack already installed —
the app would refuse to remove its own work and tell the user it belonged to somebody else.

**The line is `SCENERY_PACK Custom Scenery/<folder>/`**, relative, never absolute.

Reading is generous in both directions. Unknown fields are ignored, a `manifest` version from the
future still means the pack is ours, and a pre-1.0 pack with no version field at all is read as
version 1. Refusing to recognise a newer build's pack would leave a folder nobody can uninstall
without a file manager, which is the worst available reading of "I do not recognise this".

**Reading is strict about exactly one thing**, and it had to be fixed to say this at all. The old
reader returned whatever `JSON.parse` produced, so a file containing `{}` — or `0`, or `"hello"` —
marked a folder as ours. This application *deletes* folders that are ours. Ownership is the most
dangerous judgement it makes, and it now requires the one field that carries the claim.

`tests/packContract.test.ts` holds all of this to **literal fixtures**, not to whatever the code
currently produces. A test that builds its expectation by calling the code under test passes
happily through a change of format, which is the change it exists to catch.

---

## D15 — XOP reads `apt.dat`, to move the map and for nothing else (2026-08-23)

There is an **Airport** box beside the coordinate box. Type a code or a name, pick a match, and the
map flies there. The list is built by reading the `apt.dat` files of the user's own installation —
X-Plane's Global Airports plus any pack in `Custom Scenery` that carries one.

**Why:** requested by the author, whose words were *"solo quiero que sea un rápido buscador de
aeropuertos para poder agregar objetos en este, nada más"*. Most people decorating scenery are
decorating an airport, and before this the only way to get to one was to look its latitude up
somewhere else and paste it in. The tool was asking the user to do arithmetic to reach the place
they had already named.

### This does not reopen D2, and here is the line

D2 says XOP does not build airports, and it still does not. The distinction is not "does it know
the word ICAO" — it is **what it writes**. XOP writes overlays. It has never written an `apt.dat`
and never will; this reads one, and only:

- the header row of a land airport, seaplane base or heliport (`1`, `16`, `17`) — the identifier
  and the name;
- `1302 icao_code`, so a field whose row identifier is `XEN001Z` is findable as `ENHO`;
- a coordinate, from runway ends, helipad centres, startup locations, or `1302 datum_lat`/`_lon`.

**Runways, taxiways, pavement, signs, frequencies, parking, lighting and every other row are not
read, and adding one is not a small change.** Nothing about an airport enters the project model, the
`.xop` file or the exported pack. The map draws no airport layer, no runway outline, no marker — the
box is a camera move and leaves no trace. Picking an airport does not make the document dirty,
because looking is not editing.

The test of any future request against this: *would it write, or draw, or store anything about an
airport?* If yes, it is D2 and the answer is no.

### The user's own files, not a bundled list

The same reasoning as D7. A bundled airport list would be data shipped inside XOP, would go stale,
and would be **wrong for the person using it**: measured on the development installation, the packs
in `Custom Scenery` add 56 airports the global file does not have at all — 36 flying-boat sealanes,
18 Antarctic stations including the South Pole, and a helipad on the Burj Al Arab — and replace 42
more with the pack author's version. Reading the installation gets the airports the user actually
has, in the priority order `scenery_packs.ini` already defines, and ships nothing.

### The coordinate comes from the geometry, not from the datum

An airport can publish its own reference point, and that is the obvious thing to use. It is wrong
often enough to matter: **270 of the 17 045 airports that publish a datum put it more than 5 km
from their own runways**, with sign errors and pasted-over fields, and nothing marks them. The
runways are self-consistent, and all 38 888 airports have some geometry. So the box aims at the
middle of the field, and the datum is only a fallback for a pack that has nothing else.

### What it costs, measured

2.6 seconds to read 380 MB the first time, cached afterwards as 2.9 MB in `userData` and rebuilt
only when the files behind it change. It runs in the background while the rest of the application
carries on, and the box says it is still reading. Searching the resulting 38 944 airports takes
1–3 ms per keystroke.

---

## D16 — Install and uninstall with X-Plane closed (2026-08-23)

The dialog says **"Close X-Plane before installing"** before the button, and **"Start X-Plane to
see it"** after. Removing a pack carries the same condition.

**Why:** X-Plane reads `scenery_packs.ini` when it starts. A pack added while it is running is a
pack it will not see, so the install appears to have done nothing — which is the worst kind of
failure, because there is nothing to report. And the ecosystem has always worked this way: every
external scenery tool asks for the simulator to be shut, and users expect it. Decided by the author
on that basis (2026-08-23): *"siempre se ha manejado esto así en la comunidad"*.

**⚠️ This is not the file-locking claim, which was measured false and stays false.** An earlier
build said "close X-Plane — it holds on to files in `Custom Scenery`". Probe H8 showed it does not:
with the simulator running and the pack loaded, its `.dsf` could be opened for writing, renamed,
and the whole folder deleted. That message was wrong and its removal was right. `rethrowLocked` in
`installPack.ts` still refuses to blame X-Plane for a locked file, and that stays — a locked file
means another program, and the right diagnosis matters when something has actually gone wrong.

Two different questions, two different answers, and a reader who collapses them will "fix" one of
them back into a falsehood:

| | can it write? | will the simulator notice? |
| --- | --- | --- |
| X-Plane running | yes, measured (H8) | **no — the ini is read at startup** |
| X-Plane closed | yes | yes |

**What was not measured, and why it does not matter here.** Whether X-Plane ever rewrites
`scenery_packs.ini` mid-session or on some other exit path is still open. Two clean exits left the
file byte-identical, including one checked on 2026-08-23 with an XOP line present — but neither
exercised the case that would hurt, which is a line inserted *while the simulator is running*. The
control was designed and deliberately not run: the rule above costs nothing, covers that case
whatever the answer turns out to be, and matches what users already do. If anybody wants the
measurement later, the design is in the notes.

## D17 — The catalog is browsed by its own paths, and the list is not capped (2026-08-24)

The object panel has a **category tree** above the list, and the list shows **every match** with no
limit.

The tree is derived from the virtual paths and nothing else. `lib/airport/hangars/arched/16x16/`
already names what it holds, so XOP groups by the segments that are there, counts them, and stops.
On a stock X-Plane 12 that is 14 roots and 249 nodes over 3 837 objects, one to five levels deep.

**Why a tree at all:** the panel could only be searched, and a search only works for somebody who
already knows what the thing is called. Somebody who wants "a hangar, a smallish one" had no way in.
It is the same shape of gap as the airport box truncating at twenty (D15's sibling fix): a list you
cannot walk is half a tool.

**Why no classification of our own.** PCT had to invent a taxonomy — a curated table of 911 flat
names, prefix rules, a fallback bucket — because AFS4's names are flat. X-Plane's are not. Writing a
category table here would solve a problem this catalog does not have, and shipping a curated list of
Laminar's object names is packaged data of exactly the kind D7 rules out. The library authors sorted
their own work; the panel shows their sorting, in their words. `g10`, `XCDL`, `Common_Elements` are
what WED and the forums call these, so those are the words on screen, with underscores opened up and
nothing else changed.

**No branch is hidden**, and none is special-cased. `g10` holds the 1 123 × 517 m autogen city
blocks *and* `carport1_6x3`; a blacklist would take the garages with it. Size is the second axis and
it already has a control.

**Counts follow the filters in force.** A branch reading `hangars 380` that produces nothing under
`max size 10 m` is the same quiet lie as a list that truncates without saying so, so under that
filter it reads `hangars 0`. It stays where it is, dimmed — a tree that rearranges itself under the
cursor while somebody types is unusable.

### Why the cap went, and what it cost

There was a `slice(0, 400)` with a line underneath saying the list was truncated. It carried no
comment and no measurement, and saying out loud that you are truncating does not make the rest
reachable. It was measured before it was removed, on a real 3 837-object installation, in a
production build:

| | |
|---|---|
| build the whole list when it swells to full size | ~145 ms |
| a keystroke typed while the list is that big | ~50 ms |
| the same, before `content-visibility` on the rows | ~215 ms |

That is a real cost, and naming it is the point. It is paid on the way *out* of a search rather than
on the way in, and with the tree the full 3 837 is now the rare case. Two guesses that turned out
wrong, so nobody re-makes them: it is **not** the per-row `IntersectionObserver` (3 837 of them cost
5 ms), and it is **not** paint — `content-visibility: auto` took a third off the worst case and left
the keystroke untouched. What remains is React building the rows, and the honest fix for that is
windowing, if it is ever worth the code.

## D18 — Two themes, one switch, decided before the first paint (2026-08-24)

XOP has a **light theme and a dark one**, a button in the header that swaps them, and no third
state.

**Why no "system".** A follow-the-desktop setting is the obvious third option and it costs more
than it looks: it needs a menu instead of a button, and it means a window that changes colour under
somebody who never asked it to. So the *first* run follows the desktop — main asks Electron's
`nativeTheme` — and from the first click the choice belongs to the user and stays where they put
it. `settings.json` stores `null` until then, which is the difference between "nobody has said" and
"dark", and a single `'light' | 'dark'` field with a default could not tell those two apart.

**The palette is one block of CSS custom properties, and the renderer knows no colours.** Adding
the light theme was mostly promoting twenty-five literal hex values in `styles.css` into named
roles — `--raise` for the face of a control, `--sink` for something you type into, `--hairline` for
a border you are not meant to notice. The rule that keeps it that way: **no literal colour below
the two palette blocks**. One is left, on purpose — the rotation read-out beside the grip, which
sits on the satellite imagery rather than on the application, and answers to the photograph
underneath it in either theme. The map's own drawing is literal for the same reason.

**Light is not dark inverted.** The blue and the amber are *darker* than their dark-theme
counterparts, not paler: `#4da3ff` on white is a pastel nobody can read. The greys keep their
order — panel lightest, window behind it slightly darker — so the shape of the screen survives the
flip.

**It travels on the command line, not over IPC.** Main resolves the theme before the window exists,
paints `backgroundColor` with it, and passes it to the preload as `--xop-theme=`. Asked for over
IPC it could only arrive *after* the first paint, which is a frame of the wrong palette at every
launch — the exact flash this arrangement exists to avoid. Two values then have to agree about one
colour, `WINDOW_BACKGROUND` in `shared/theme.ts` and `--bg` in `styles.css`, and nothing at run time
would notice if they stopped: `tests/theme.test.ts` reads the stylesheet and compares them.

## D19 — The hover preview draws the object again, larger (2026-08-24)

Resting the mouse on a catalog row for 400 ms opens a **floating preview**: the object at 240 px,
and its whole virtual path in monospace.

**Why.** A row is 44 px tall. That is enough to tell a hangar from an aeroplane and nowhere near
enough to tell one hangar from the next, and there are 3 837 of them with names like `hangar_2b`.
Without this the only way to know what you are about to place was to place it and go and look.

**It is redrawn, not blown up.** The row's picture is 128 px and the disk cache holds that size and
only that size. Scaling those 128 pixels up to 240 gives you the same doubt, softer — so the
preview asks the thumbnail service for a fresh 480 px render off the geometry, into a second GL
context of its own. That render is kept in memory for a handful of objects and **never written to
the disk cache**, which is keyed by virtual path with no size in the key: putting it there would
hand every row in the list a picture four times the weight it needs.

It opens on the small picture the row already had — instantly, blurred — and swaps to the sharp one
when it arrives, so the frame is never empty while a file is read.

**The path is the second half of the feature.** The row can only show the last segment; the string
that actually goes into the DSF is the whole virtual path, and it used to live in a native `title`
tooltip. That tooltip is now gone: two tooltips for one row is one too many, and PCT already
learned that the native one is unreliable on macOS (its forum thread #166).

**Taken from PCT, and only the shape.** The idea and the placement arithmetic came across —
`previewPosition.ts` is a port, GPL-3.0 both sides, noted in `docs/LINEAGE.md`. The content did
not: PCT enlarges a photograph the user supplied, because Aerofly's objects cannot be read. XOP has
the geometry, so it draws it. One deliberate change: the popup anchors on the **whole row** rather
than on the little picture, so it opens clear of the panel and over the map instead of covering the
name and the measurements of the object it is enlarging.

---

## D20 — Libraries outside the installation are reached with a link, not with a setting (2026-08-25)

**XOP scans `Resources/default scenery` and `Custom Scenery`, and nothing else.** There is no
setting for extra library folders, and there will not be one.

A user who keeps third-party libraries elsewhere — another drive, a curated folder, whatever
xOrganizer set up — points a **junction or symlink** at them from inside `Custom Scenery`. XOP then
reads them without knowing they are not local, because `readdirSync` and `statSync` follow links.

**Why:** because that is where X-Plane looks, measured rather than assumed
([`probes/H9`](../probes/H9/FLIGHT.md), flown 2026-08-25 on 12.4.3).

The request that started this — a forum post asking for external folders in the search path —
looked like a small change: `scanLibraries` has two roots hardcoded and adding more is a loop over
a longer array. The reason it is not a small change is that **a catalog may only widen to where the
simulator itself reads**. X-Plane resolves a virtual path it cannot find by not drawing the object,
so an object XOP offered from a folder X-Plane never reads would survive placing, exporting,
installing and flying out to look at it. The user would find bare grass and a modal blaming a pack
they did not write.

So the probe asked where X-Plane actually reads, and the answer is narrow:

- **An absolute path in `scenery_packs.ini` does nothing.** Three spellings — forward slashes,
  backslashes, and the exact backslash-with-trailing-slash form observed in a real user's file —
  and all three were **deleted from the file** at the next startup. The pack never appeared in the
  scenery list. It is not a search path; it is a line the simulator removes.
- **A junction is a pack, completely.** X-Plane lists it under its link name like any real folder,
  on another drive, and the library inside it resolves for any overlay that references it.

**Consequences.**

- No `libraryFolders` setting, no folder picker for it, no extra roots in the scan, and no cache key
  that has to fold them in.
- The answer to the forum request is a link, and it is a better answer than the setting would have
  been: a folder linked into `Custom Scenery` works for **X-Plane and every other tool**, not only
  for XOP. A setting would have made XOP the one application that could see objects nobody else
  could draw.
- `scanAirports` already refuses ini entries that escape the installation, through `containedJoin`.
  That was written as containment against a file other tools write. It turns out to match what
  X-Plane itself does with those lines, which is the comfortable direction for a guess to land.
- The `reference/dsf-overlay.md` rule "never write an absolute path" keeps standing, and now has a
  measurement under it instead of caution.

**What is deliberately still open.** The probe also found that X-Plane is **not silent** about an
unresolvable virtual path — it raises a modal and logs `E/SCN` per reference. Several comments in
this codebase say otherwise. They are not being edited yet: the case XOP marks `unavailable` is a
*different* route through the loader — the path resolves and the file behind it was never shipped —
and H9 did not measure that one. It gets its own probe before anything is rewritten on the strength
of this one.

---

## D21 — Arrange works in the row's frame, not in the compass's (2026-08-26)

**XOP has no "align left", no "align top" and no "distribute horizontally", and it will not grow
them.** The two arrange buttons are **Line up** and **Space evenly**, and both work along the line
the selected objects already almost form.

The request that started this was the ordinary one — *"como en Photoshop o PowerPoint, unos botones
de alinear y distribuir"* — and the answer is the shape PCT already paid for.

**Why:** because **left is west**. The 2D-editor vocabulary assumes a canvas whose axes mean
something to the drawing on it, and a map's do not. "Align left" on seven parked aircraft snaps them
all to the westernmost meridian, which is not a thing anybody has ever wanted done to their apron.
And the row a person actually wants tidied is hardly ever axis-aligned: a line of hangars runs at
whatever angle the apron runs at — the row that prompted this in PCT sits at 134.5°.

So the operations are expressed in the row's own frame instead, ALONG the line and ACROSS it:

- **Line up** zeroes each object's offset *across* the line through the two that are farthest apart.
  That is "align", and it is better than align: the two ends do not move, so the row stays where the
  user put it and only the strays come to it.
- **Space evenly** equalises the gaps *along* that line, keeping each object's offset across it.
  That is "distribute".

The two are orthogonal, so running both gives a clean row and running one leaves the other property
alone. `src/core/geo/arrange.ts` is a copy of PCT's file (D4, `docs/LINEAGE.md`).

**The axis is the farthest-apart pair, not the first and last selected.** Selection order is
invisible state a user cannot see or verify; "the two ends stay put and everything else moves
between them" is a sentence they can predict before they click. It also makes the result independent
of the order things were picked in, which is why `selection` in the store is documented as carrying
no order at all.

**Consequences.**

- Selection became a list, and the map grew Ctrl-click and a group drag to fill it. Everything the
  toolbar does — rotate, duplicate, remove — acts on that list.
- There is **no "Match row" button**, which PCT has: it faces every selected object along the row's
  bearing. That button asserts that a compass bearing *is* the object's facing, which PCT calibrated
  in-sim for its own asset type. X-Plane's `OBJECT` rotation is not a heading — rotation 0 is however
  the artist modelled the thing, and the stock fuel truck faces south at 0 (`probes/H0b`, D3). XOP
  offers a rotation *field* instead, which writes the DSF's fourth argument and claims nothing.
- An arrange that moves nothing writes nothing: `core/geo/arrange.ts` returns untouched points at the
  same reference, and the store makes no `set` call when none of them changed. Otherwise lining up a
  row that is already straight would put the unsaved bullet in the title bar for doing nothing.
- A **locked** object still helps define the row and is never moved by it. Locking the two ends is
  how somebody pins the axis by hand — the flag has no UI yet, but the project format carries it and
  a toolbar button must not quietly override a file that sets it.
