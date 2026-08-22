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

## D5 — Repository: `xp12-object-placer`, private until it works (2026-08-22)

**Why the name:** follows the author's existing `<sim>-<what>` pattern (`afs4-poi-creator`), and
"object placer" is X-Plane vocabulary that promises exactly what D2 allows — no more.

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
