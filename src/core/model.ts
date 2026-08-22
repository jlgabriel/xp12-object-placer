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
 * `rotation` is the fourth argument of the DSF `OBJECT` command, in degrees, verbatim.
 *
 * Probe H0b established that it runs **clockwise**, the ordinary compass sense, so a rotation
 * handle on the map maps onto it 1:1 with no sign flip.
 *
 * It is still deliberately not called `heading`, and that is not pedantry. Rotation 0 does not mean
 * "facing north" — it means "as the artist modelled it". The stock fuel truck faces south at 0.
 * The object's real compass heading is `artistBaseHeading + rotation`, and `artistBaseHeading` is
 * not recorded anywhere in OBJ8. Nothing in this codebase may assume the two are the same number.
 * See probes/H0b/FLIGHT.md.
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
