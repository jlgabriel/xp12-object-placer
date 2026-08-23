/**
 * Opening and saving the project file. Main owns this, and main owns it alone.
 *
 * The invariant is the one the whole privileged layer is built on: **the renderer never names a
 * path.** It says *what* — new, open, save, save-as — and main decides *where*, either from the
 * path it is already holding or from a dialog the operating system drew. A path that came in from
 * the sandboxed renderer would turn a shared project file into a write-anywhere primitive, which
 * is the same hole `selectInstallation` exists to close.
 *
 * The picker is **injected** rather than imported, so this module has no Electron in it and unit
 * tests drive it directly with a function that returns a path. ipc.ts supplies the real one.
 *
 * Trust: opening is untrusted input and goes through `parseProject`. Saving writes state the
 * renderer owns — but it is still validated on the way in, at the IPC boundary, because "the
 * renderer owns it" describes the honest case and this layer is written for the other one.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { writeFileAtomic } from '../node/fsAtomic.js';
import { InvalidProjectError, parseProject, touchProject, UNTITLED } from '../core/project/project.js';
import type { Project } from '../core/project/project.js';

export const PROJECT_EXTENSION = 'xop';

/** Returns a chosen absolute path, or null when the user cancelled. */
export type PickPath = () => Promise<string | null> | string | null;

/**
 * The path of the project open in this process, and whether it has unsaved work in it.
 *
 * Module-level because main is a singleton. Both are exported through setters so tests get a reset
 * seam instead of having to reload the module.
 */
let currentPath: string | null = null;
let dirty = false;

export function getCurrentProjectPath(): string | null {
  return currentPath;
}

export function setCurrentProjectPath(path: string | null): void {
  currentPath = path;
}

export function isDirty(): boolean {
  return dirty;
}

export function setDirty(value: boolean): void {
  dirty = value;
}

/**
 * What to call the open document.
 *
 * The file name wins over the `name` inside the project, and there is only one place the two can
 * disagree — Save As, which updates the name to match. Nothing in the UI edits `name`
 * independently, so there is no third answer to drift towards.
 */
export function documentName(): string {
  return currentPath ? basename(currentPath).replace(/\.xop$/i, '') : UNTITLED;
}

/** Start again: no file, nothing unsaved. */
export function forgetProject(): void {
  currentPath = null;
  dirty = false;
}

/**
 * Make sure what the user typed ends up as a `.xop`.
 *
 * Windows appends the filter's extension itself; Linux and macOS do not always, and a project
 * saved as a bare `apron` is one the Open dialog then filters out of view. Somebody who typed
 * `apron.backup` on purpose gets `apron.backup.xop`, which is visible and still theirs.
 */
export function withExtension(path: string): string {
  return /\.xop$/i.test(path) ? path : `${path}.${PROJECT_EXTENSION}`;
}

function readProjectFile(file: string): Project {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new InvalidProjectError('that file could not be read');
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // The raw SyntaxError says something like "Unexpected token < in JSON at position 0", which
    // describes the parser's disappointment rather than the user's situation.
    throw new InvalidProjectError('that file is not a readable project — it is not valid JSON');
  }

  return parseProject(json);
}

/**
 * Open a project the user picks. Null when they cancel.
 *
 * Throws for a file that is not a project: that is a real answer and the caller turns it into a
 * sentence. The current path is only adopted **after** the file validates, so a failed open leaves
 * whatever was already open exactly where it was.
 */
export async function openProject(pick: PickPath): Promise<{ path: string; project: Project } | null> {
  const file = await pick();
  if (!file) return null;

  const project = readProjectFile(file);
  currentPath = file;
  dirty = false;
  return { path: file, project };
}

/** Save to the path already open, falling through to Save As when there is none. Null on cancel. */
export async function saveProject(
  project: Project,
  pick: PickPath,
  now?: string,
): Promise<string | null> {
  if (currentPath === null) return saveProjectAs(project, pick, now);
  writeFileAtomic(currentPath, JSON.stringify(touchProject(project, now), null, 2));
  dirty = false;
  return currentPath;
}

/** Always asks where. Null on cancel. */
export async function saveProjectAs(
  project: Project,
  pick: PickPath,
  now?: string,
): Promise<string | null> {
  const chosen = await pick();
  if (!chosen) return null;

  const file = withExtension(chosen);
  const named: Project = { ...project, name: basename(file).replace(/\.xop$/i, '') };
  writeFileAtomic(file, JSON.stringify(touchProject(named, now), null, 2));
  currentPath = file;
  dirty = false;
  return file;
}

