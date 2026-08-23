/**
 * Editing `scenery_packs.ini` — the file that decides what X-Plane actually shows you.
 *
 * Copying a folder into `Custom Scenery` is half of installing scenery. The other half is this
 * file: it lists the packs in priority order, **highest first**, and where a line sits decides
 * whether the user's own work wins over a landmark pack covering the same ground. X-Plane does
 * eventually notice a new folder, but it appends it **last**, below photoscenery and mesh, which is
 * the wrong tier (probe H0).
 *
 * ## XOP is a guest in this file
 *
 * It has no single owner. X-Plane rewrites it at every startup, the user edits it by hand, and
 * third-party tools inject lines of their own — during probe H0 four lines vanished between two
 * launches and it was a photoscenery downloader's service, not us. That episode is why everything
 * here is written the way it is:
 *
 *   - **Insert exactly one line. Reorder, rewrite and normalise nothing else.** Not the whitespace,
 *     not the line endings, not the order, not a path that looks wrong. The rest of the file
 *     belongs to somebody else.
 *   - **Preserve the shape of the file**: its line endings, its byte-order mark, and whether it
 *     ended with a newline. A tool that flips a file to LF looks like it rewrote everything, and
 *     the next person to read a diff cannot tell what actually changed.
 *   - **Be idempotent.** Exporting twice must not put the pack in twice.
 *
 * Pure: text in, text out. Backing the file up and writing it is the caller's job.
 */

/** The marker line that divides X-Plane's own airports from everything layered on top of them. */
const GLOBAL_AIRPORTS = '*GLOBAL_AIRPORTS*';

const ENABLED = 'SCENERY_PACK';
const DISABLED = 'SCENERY_PACK_DISABLED';

export type Placement =
  /** Inserted at the top of the overlay tier, which is what D8 asks for. */
  | 'below-global-airports'
  /**
   * Appended at the end, because the marker was not there to aim at.
   *
   * Without `*GLOBAL_AIRPORTS*` there is no way to tell where the airport tier ends, and guessing
   * would mean silently placing a pack above somebody's custom airport. Appending is what X-Plane
   * itself does, so it is at least the behaviour the user already has.
   */
  | 'appended'
  /** The line was already there. Nothing was written. */
  | 'already-present'
  /**
   * The user has this pack in the file but switched **off**. Nothing was written.
   *
   * Turning it back on would be overriding a decision somebody made deliberately, in a file they
   * own, and it would look like the export had failed to change anything.
   */
  | 'disabled-by-user';

export interface IniEdit {
  readonly text: string;
  readonly changed: boolean;
  /** The exact line, for showing the user what was written and where. */
  readonly line: string;
  readonly placement: Placement;
}

/** The line a pack gets. Always relative — an absolute path in this file is never correct. */
export function sceneryPackLine(packFolder: string): string {
  return `${ENABLED} Custom Scenery/${packFolder}/`;
}

interface Shape {
  readonly bom: string;
  readonly eol: string;
  readonly endsWithNewline: boolean;
  readonly lines: string[];
}

function readShape(text: string): Shape {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = text.slice(bom.length);
  // Whichever ending the file already uses, keep using. A mixed file keeps its majority.
  const crlf = (body.match(/\r\n/g) ?? []).length;
  const lf = (body.match(/(?<!\r)\n/g) ?? []).length;
  const eol = crlf >= lf && crlf > 0 ? '\r\n' : '\n';
  const endsWithNewline = /\r?\n$/.test(body);
  const lines = body.split(/\r\n|\n/);
  if (endsWithNewline) lines.pop(); // split leaves a trailing empty element
  return { bom, eol, endsWithNewline, lines };
}

function render(shape: Shape, lines: readonly string[]): string {
  return shape.bom + lines.join(shape.eol) + (shape.endsWithNewline ? shape.eol : '');
}

/**
 * Does this line refer to that pack?
 *
 * Compared without case and without a trailing slash, because the file is written by several
 * different hands: X-Plane writes `Custom Scenery/Foo/`, a person might type `Custom Scenery/foo`,
 * and on Windows those are the same folder. Being strict here would mean adding a second line for
 * a pack that is already listed.
 */
function refersTo(line: string, packFolder: string): { match: boolean; disabled: boolean } {
  const trimmed = line.trim();
  const disabled = trimmed.startsWith(`${DISABLED} `);
  const enabled = trimmed.startsWith(`${ENABLED} `);
  if (!disabled && !enabled) return { match: false, disabled: false };

  const path = trimmed
    .slice((disabled ? DISABLED : ENABLED).length)
    .trim()
    .replace(/[/\\]+$/, '')
    .replace(/\\/g, '/');
  const want = `Custom Scenery/${packFolder}`.replace(/[/\\]+$/, '');
  return { match: path.toLowerCase() === want.toLowerCase(), disabled };
}

/** One entry of the scenery order, in the order X-Plane reads it: highest priority first. */
export type SceneryEntry =
  /** X-Plane's own airports. Not a folder in `Custom Scenery` — the marker stands for them. */
  | { readonly kind: 'global-airports'; readonly enabled: boolean }
  /** A pack, by the path the file gives, relative to the X-Plane folder. */
  | { readonly kind: 'pack'; readonly path: string; readonly enabled: boolean };

/**
 * Everything the file lists, in order, switched on or off.
 *
 * Order is the whole reason to read this file rather than just listing `Custom Scenery`: when two
 * packs define the same airport, the one listed first is the one X-Plane uses. The disabled entries
 * come back too, and they matter as much as the enabled ones — a caller that also looks in the
 * directory needs to know which folders the user has deliberately switched off, or it will helpfully
 * put them back.
 *
 * The paths come back as the file spells them, minus a trailing slash. They are not resolved,
 * checked or trusted here — this file is text somebody else writes, and turning one of its lines
 * into a real path is the caller's job, with `containedJoin`.
 */
export function sceneryEntries(text: string): SceneryEntry[] {
  const entries: SceneryEntry[] = [];
  for (const raw of readShape(text).lines) {
    const trimmed = raw.trim();
    const enabled = trimmed.startsWith(`${ENABLED} `);
    const disabled = trimmed.startsWith(`${DISABLED} `);
    if (!enabled && !disabled) continue;

    const value = trimmed.slice((enabled ? ENABLED : DISABLED).length).trim();
    if (value === GLOBAL_AIRPORTS) {
      entries.push({ kind: 'global-airports', enabled });
      continue;
    }
    const path = value.replace(/\\/g, '/').replace(/\/+$/, '');
    if (path !== '') entries.push({ kind: 'pack', path, enabled });
  }
  return entries;
}

/**
 * Put a pack into the file, at the top of the overlay tier.
 *
 * Returns the file unchanged, and says why, when the pack is already listed — whether enabled or
 * deliberately switched off.
 */
export function insertSceneryPack(text: string, packFolder: string): IniEdit {
  const shape = readShape(text);
  const line = sceneryPackLine(packFolder);

  for (const existing of shape.lines) {
    const { match, disabled } = refersTo(existing, packFolder);
    if (!match) continue;
    return {
      text,
      changed: false,
      line: existing.trim(),
      placement: disabled ? 'disabled-by-user' : 'already-present',
    };
  }

  const marker = shape.lines.findIndex(
    (candidate) => candidate.trim() === `${ENABLED} ${GLOBAL_AIRPORTS}`,
  );

  const lines = [...shape.lines];
  if (marker === -1) {
    // Append after the last non-empty line, so the pack does not land after a run of blank lines at
    // the end of the file — which would look like it had been dropped in by accident.
    let at = lines.length;
    while (at > 0 && lines[at - 1]!.trim() === '') at--;
    lines.splice(at, 0, line);
    return { text: render(shape, lines), changed: true, line, placement: 'appended' };
  }

  lines.splice(marker + 1, 0, line);
  return { text: render(shape, lines), changed: true, line, placement: 'below-global-airports' };
}

export interface IniRemoval {
  readonly text: string;
  readonly changed: boolean;
  /** Every line taken out, so the user can be told exactly what was removed. */
  readonly removed: readonly string[];
}

/**
 * Take a pack out of the file.
 *
 * Removes the disabled form too: uninstalling means the folder is gone, and a line pointing at a
 * folder that is not there is litter whichever way it is switched.
 */
export function removeSceneryPack(text: string, packFolder: string): IniRemoval {
  const shape = readShape(text);
  const removed: string[] = [];
  const lines = shape.lines.filter((line) => {
    if (!refersTo(line, packFolder).match) return true;
    removed.push(line.trim());
    return false;
  });

  if (removed.length === 0) return { text, changed: false, removed: [] };
  return { text: render(shape, lines), changed: true, removed };
}
