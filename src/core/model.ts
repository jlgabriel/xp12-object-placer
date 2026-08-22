/**
 * The domain, in X-Plane's vocabulary.
 *
 * See docs/DECISIONS.md D3: nothing here is named after an Aerofly concept. If you are tempted to
 * add `scale`, `height` or `heightMode`, read reference/dsf-overlay.md first — a DSF `OBJECT` has
 * neither.
 */

/** A point on Earth. Longitude first everywhere in this codebase, matching the DSF `OBJECT` line. */
export interface LonLat {
  readonly lon: number;
  readonly lat: number;
}

/**
 * One object placed in the world.
 *
 * `rotation` is the fourth argument of the DSF `OBJECT` command, in degrees, verbatim. It is
 * deliberately *not* called `heading`: what it means in compass terms is what probe H0 measures.
 * Until H0 reports, no code may assume a mapping between the two.
 */
export interface PlacedObject {
  readonly id: string;
  /** Library virtual path, exactly as scanned. Never normalized — see reference/library-txt.md. */
  readonly libraryPath: string;
  readonly position: LonLat;
  readonly rotation: number;
  readonly label?: string;
  readonly locked?: boolean;
}
