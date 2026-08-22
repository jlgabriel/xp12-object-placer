# XOP — X-Plane 12 Object Placer

Place scenery objects on a map, geographically, and get an installable X-Plane 12 overlay.

Pick a spot anywhere on Earth — an airport apron, a city block, a ridge in the middle of nowhere.
Browse the objects your X-Plane installation already has. Drop them on a satellite map, rotate them,
duplicate them, line them up. Export a Custom Scenery pack.

## What it is not

**XOP does not build airports.** No `apt.dat`, no runways, no taxiways, no parking, no ICAO codes.
[WED](https://developer.x-plane.com/tools/worldeditor/) already builds airports and it is excellent
at it. XOP does one thing WED makes laborious: putting objects on the ground, fast, by looking at a
map.

Everything XOP produces is an **overlay** — it sits on top of whatever scenery is already there,
default or custom.

## Status

Early. Nothing to install yet. See [`docs/DECISIONS.md`](docs/DECISIONS.md) for what has been
settled and [`reference/`](reference/) for the file-format notes this is being built against.

## Zero assets

XOP never redistributes Laminar content. It reads the libraries and objects **already installed on
your machine**, and any thumbnails it generates are built locally, from your own installation, into
a local cache. Nothing from X-Plane ships inside XOP.

## Sister project

XOP is an independent rewrite of the ideas behind
**[PCT — Aerofly FS 4 POI Creator Tool](https://github.com/jlgabriel/afs4-poi-creator)**, by the
same author. It shares no code and no project format with PCT. What it inherits — and what it
deliberately dropped — is written down in [`docs/LINEAGE.md`](docs/LINEAGE.md).

## License

GPL-3.0. Same as PCT.
