/**
 * The project file: what a person's work is, once it is off the screen and on the disk.
 *
 * A project is one JSON file with a `.xop` extension. Not a folder, not a database — a document,
 * because that is what people already know how to do with documents: copy them, rename them, put
 * them in Dropbox, send one to somebody else.
 *
 * Pure: no filesystem, no Electron, no clock of its own except where one is passed in. Reading a
 * file and choosing where to write it belong to main, which owns every path in this application.
 *
 * ⚠️ A project deliberately does **not** record which X-Plane installation it was made against.
 * Objects are named by library virtual path, which is the same string in every installation that
 * has the library. Opening a project on a machine that is missing one of them must not lose the
 * object — the catalog already has a "not installed" state and the map already dims it. Dropping
 * the user's work because their libraries changed would be the worst possible reading of "safe".
 */

import { z } from 'zod';
import type { PlacedObject } from '../model.js';

/**
 * Where the map is looking. Part of the document, not of the domain: reopening a project should
 * put you back over the apron you were decorating, not in the middle of the Atlantic.
 */
export interface Camera {
  readonly lon: number;
  readonly lat: number;
  readonly zoom: number;
}

/** Where the map opens before anyone has said where they want to work. */
export const DEFAULT_CAMERA: Camera = { lon: 0, lat: 20, zoom: 3 };

/**
 * Bumped only when an older reader could get a newer file **wrong**.
 *
 * Adding an optional field does not need a new version — an old reader ignoring a field it has
 * never heard of is fine. Changing what an existing field means does, because then the old reader
 * is confidently wrong, which is worse than refusing.
 */
export const PROJECT_SCHEMA_VERSION = 1;

/** One saved project. */
export interface Project {
  readonly schemaVersion: number;
  /** Marks the file as ours. A `.xop` that is somebody else's JSON is refused, not guessed at. */
  readonly app: 'xop';
  /** The human title. Free text; the pack folder name is a separate, stricter thing. */
  readonly name: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly camera: Camera;
  readonly objects: readonly PlacedObject[];
}

/**
 * What a placed object is allowed to look like when it arrives from somewhere untrusted.
 *
 * Two callers share this, deliberately: the export IPC channel and the project reader. They are
 * the same question — "did something outside this process hand us an object that makes sense?" —
 * and answering it twice is how the two answers drift apart.
 *
 * The limits are generous enough that no real project meets them and small enough that a runaway
 * renderer, or a hand-edited file, cannot ask for an unbounded allocation.
 */
export const PlacedObjectSchema = z.object({
  id: z.string().min(1).max(200),
  libraryPath: z.string().min(1).max(1024),
  position: z.object({
    lon: z.number().refine(Number.isFinite, 'longitude must be a real number'),
    lat: z.number().refine(Number.isFinite, 'latitude must be a real number'),
  }),
  rotation: z.number().refine(Number.isFinite, 'rotation must be a real number'),
  label: z.string().max(300).optional(),
  locked: z.boolean().optional(),
});

/**
 * Rebuild what came across as a domain object, rather than passing the parsed shape along.
 *
 * Not ceremony: an absent optional and an optional explicitly set to `undefined` are different
 * types here, and the interesting half of that is what it forces — nothing downstream sees
 * anything except the six fields it is allowed to see, whatever else was in the message or the
 * file.
 */
export function toPlacedObject(parsed: z.infer<typeof PlacedObjectSchema>): PlacedObject {
  return {
    id: parsed.id,
    libraryPath: parsed.libraryPath,
    position: { lon: parsed.position.lon, lat: parsed.position.lat },
    rotation: parsed.rotation,
    ...(parsed.label === undefined ? {} : { label: parsed.label }),
    ...(parsed.locked === undefined ? {} : { locked: parsed.locked }),
  };
}

const IsoDate = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a date');

const ProjectSchema = z.object({
  schemaVersion: z.number().int(),
  app: z.literal('xop'),
  name: z.string().max(300),
  createdAt: IsoDate,
  modifiedAt: IsoDate,
  camera: z.object({
    lon: z.number().refine(Number.isFinite, 'longitude must be a real number'),
    lat: z.number().refine(Number.isFinite, 'latitude must be a real number'),
    zoom: z.number().refine(Number.isFinite, 'zoom must be a real number'),
  }),
  // No minimum: an empty project is a real thing to save, and refusing it would mean the one time
  // you cannot write the file is right after you cleared the map to start over.
  objects: z.array(PlacedObjectSchema).max(100_000),
});

/**
 * A file this build cannot read, told apart from a file that is simply broken.
 *
 * These deserve different sentences. "This project was made by a newer version" is actionable —
 * update, or go back to the machine that wrote it. "This file is damaged" is not, and saying the
 * second when the first is true sends somebody looking for corruption that is not there.
 */
export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly found: number) {
    super(
      found > PROJECT_SCHEMA_VERSION
        ? `this project was saved by a newer version of XP Object Placer (format ${found}, this build reads ${PROJECT_SCHEMA_VERSION})`
        : `this project uses an old format (${found}) that this build no longer reads`,
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

/** A `.xop` whose contents do not hold together. Separate from Zod's own message. */
export class InvalidProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProjectError';
  }
}

/**
 * Validate something read off the disk and turn it into a Project.
 *
 * The version is checked **before** the shape, on purpose. A file from a future version will fail
 * shape validation too, and if that message wins, the user is told their file is malformed when
 * the truth is that their app is old. The order of validation is part of the error message.
 */
export function parseProject(value: unknown): Project {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidProjectError('this file does not contain a project');
  }

  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number' && version !== PROJECT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version);
  }

  const parsed = ProjectSchema.parse(value);
  if (parsed.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(parsed.schemaVersion);
  }

  // Ids address objects across the whole application — the selection, the map's diff, the
  // inspector. Two objects sharing one id is not a detail that shows up later as a puzzle; it is a
  // file that would make the editor behave impossibly, and it can only arrive by hand-editing.
  const seen = new Set<string>();
  for (const object of parsed.objects) {
    if (seen.has(object.id)) {
      throw new InvalidProjectError(`two objects share the id "${object.id}"`);
    }
    seen.add(object.id);
  }

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: 'xop',
    name: parsed.name,
    createdAt: parsed.createdAt,
    modifiedAt: parsed.modifiedAt,
    camera: { lon: parsed.camera.lon, lat: parsed.camera.lat, zoom: parsed.camera.zoom },
    objects: parsed.objects.map(toPlacedObject),
  };
}

/** What a project is called before anybody names it. */
export const UNTITLED = 'Untitled';

/** A new, empty project. The clock is a parameter so tests do not have to freeze time. */
export function newProject(now: string = new Date().toISOString()): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: 'xop',
    name: UNTITLED,
    createdAt: now,
    modifiedAt: now,
    camera: DEFAULT_CAMERA,
    objects: [],
  };
}

/** The project as it should be written now: same document, freshly stamped. */
export function touchProject(project: Project, now: string = new Date().toISOString()): Project {
  return { ...project, modifiedAt: now };
}

/**
 * Where the session id counter has to resume so a loaded project cannot collide with new work.
 *
 * Ids are `obj-N` from a session counter (see the store). Load a project full of `obj-1..obj-40`
 * into a fresh store and the very next object placed is `obj-1` again — a duplicate that makes the
 * selection ambiguous and the map's diff wrong. Anything not shaped like `obj-N` is left alone:
 * it is already unique, because parseProject refused the file otherwise.
 */
export function nextIdSeed(objects: readonly PlacedObject[]): number {
  let highest = 0;
  for (const object of objects) {
    const match = /^obj-(\d+)$/.exec(object.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}
