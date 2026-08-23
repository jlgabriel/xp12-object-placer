# XP Object Placer

Place scenery objects on a map, geographically, and get an installable X-Plane 12 overlay.

Pick a spot anywhere on Earth — an airport apron, a city block, a ridge in the middle of nowhere.
Browse the objects your X-Plane installation already has. Drop them on a satellite map, rotate them,
duplicate them, line them up. Export a Custom Scenery pack.

*Short form, in the code and in these docs: **XOP**.*

## What it is not

**XP Object Placer does not build airports.** No `apt.dat`, no runways, no taxiways, no parking, no
ICAO codes. [WED](https://developer.x-plane.com/tools/worldeditor/) already builds airports and it
is excellent at it. XOP does one thing WED makes laborious: putting objects on the ground, fast, by
looking at a map.

Everything XOP produces is an **overlay** — it sits on top of whatever scenery is already there,
default or custom.

## Status

Early, and nothing to install yet — but the chain is closed end to end, and the simulator has loaded
a pack written entirely by XOP.

The window opens on your X-Plane installation, reads its libraries, and gives you the objects it
actually has. Pick one, click the map, and it lands there: drawn as its real footprint, turned by
its rotation, with a dot on the point the coordinate refers to. Drag the box to move it, drag the
cyan grip to turn it against the satellite imagery.

Then **Install**: XOP writes the pack into `Custom Scenery` — one binary DSF per one-degree tile,
written by XOP itself, with no external tool involved — and adds its own line to
`scenery_packs.ini`, at the top of the overlay tier, after backing that file up. It never
overwrites a folder it did not make, and it can take a pack back out again: the folder *and* the
line.

**Flown, and confirmed in the simulator.** [`probes/H8`](probes/H8/FLIGHT.md) put a pack written
entirely by XOP next to a DSFTool-compiled control, in the same place, on the same flight: both
loaded, neither drew a warning, and the objects stood where they had been placed. That is what
settles [D10](docs/DECISIONS.md) — DSFTool is not a dependency and never will be.

Work is saved as a project: **New, Open, Save, Save As**, a `.xop` file you can copy, rename or
send to somebody else. The title bar carries a bullet while there is unsaved work, and closing the
window with work in it asks first. Every exported pack also contains a copy of the project, so an
installed pack can be reopened and edited — XOP writes DSF and does not read it, so without that
copy a pack would be a dead end.

Thumbnails are still missing.

The data layer also runs headless:

```bash
npm install
npm run scan -- "/path/to/X-Plane 12" --geometry --out scratch/catalog.json
```

That reads every `library.txt` in the installation, resolves the virtual paths, parses the OBJ8
files and measures them. On a real install: 23 libraries, 49 233 exports, 13 100 of them objects,
**3 837 an actual person would want to place**, measured at ~250 objects a second.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for what has been settled and
[`reference/`](reference/) for the file-format notes, which mark what was verified on disk versus
what is only specified.

## Zero assets

XP Object Placer never redistributes Laminar content. It reads the libraries and objects **already
installed on your machine**, and any thumbnails it generates are built locally, from your own
installation, into a local cache. Nothing from X-Plane ships inside XOP.

## Sister project

XOP is an independent rewrite of the ideas behind
**[PCT — Aerofly FS 4 POI Creator Tool](https://github.com/jlgabriel/afs4-poi-creator)**, by the
same author. It shares no code and no project format with PCT. What it inherits — and what it
deliberately dropped — is written down in [`docs/LINEAGE.md`](docs/LINEAGE.md).

## License

GPL-3.0. Same as PCT.
