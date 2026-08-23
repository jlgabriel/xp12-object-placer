/**
 * Turn what somebody typed into a folder name that can exist.
 *
 * The user names their pack, and that name becomes a directory inside their X-Plane installation
 * and a line in `scenery_packs.ini`. Both of those have rules, and Windows has more of them than
 * anyone expects.
 *
 * Pure: no filesystem. Whether the name is already taken is a separate question, asked by whoever
 * is about to write.
 */

/**
 * Names Windows will not give a file or folder, whatever the extension.
 *
 * These are device names from DOS, and they are still reserved: `CON`, `NUL` and friends refuse to
 * be created, and `CON.dsf` refuses too. A pack called `AUX` would fail at the point of writing,
 * after the user had already done the work of placing everything.
 */
const RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * `< > : " / \ | ? *` and the control characters — illegal in a Windows path component.
 *
 * Spaces and hyphens are deliberately **not** in here. `X-Plane Landmarks - Paris` is a real pack
 * sitting in a real installation, and a rule that mangled it would be inventing a restriction the
 * filesystem does not have.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;

/** What a pack is called when the user has not said. */
export const DEFAULT_PACK_NAME = 'XOP Scenery';

/** How long a name may be. Well under any filesystem limit, and long enough to be descriptive. */
const MAX_LENGTH = 64;

export interface PackName {
  /** The folder name to use. Always usable: never empty, never reserved, never illegal. */
  readonly folder: string;
  /** Set when the name had to be changed, saying what happened, for showing to the user. */
  readonly changed?: string;
}

/**
 * Make a pack name safe, and say so when it had to change.
 *
 * Silently correcting the name would be worse than either refusing or accepting it: the user would
 * go looking for the folder they named and find a different one. Every branch that alters the name
 * reports what it did.
 */
export function packFolderName(raw: string): PackName {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { folder: DEFAULT_PACK_NAME, changed: `an empty name became "${DEFAULT_PACK_NAME}"` };
  }

  let name = trimmed.replace(ILLEGAL, '_');
  const hadIllegal = name !== trimmed;

  // Windows silently drops a trailing dot or space from a directory name, so a folder created as
  // "Santiago." is afterwards called "Santiago" — and anything that goes looking for the name it
  // asked for does not find it.
  const beforeTrailing = name;
  name = name.replace(/[. ]+$/, '');
  const hadTrailing = name !== beforeTrailing;

  if (name === '') {
    return {
      folder: DEFAULT_PACK_NAME,
      changed: `"${trimmed}" has nothing usable in it, so the pack is called "${DEFAULT_PACK_NAME}"`,
    };
  }

  let truncated = false;
  if (name.length > MAX_LENGTH) {
    name = name.slice(0, MAX_LENGTH).replace(/[. ]+$/, '');
    truncated = true;
  }

  // The reserved names are matched without their extension and without case, so `con`, `CON` and
  // `Con.stuff` are all the same refusal.
  const stem = name.split('.')[0]!.toUpperCase();
  if (RESERVED.has(stem)) {
    return {
      folder: `${name}_pack`,
      changed: `"${name}" is a name Windows reserves, so the folder is "${name}_pack"`,
    };
  }

  if (hadIllegal || hadTrailing || truncated) {
    const reasons = [
      hadIllegal ? 'characters a folder name cannot hold' : null,
      hadTrailing ? 'a trailing dot or space Windows would drop' : null,
      truncated ? `more than ${MAX_LENGTH} characters` : null,
    ].filter((reason): reason is string => reason !== null);
    return {
      folder: name,
      changed: `"${trimmed}" had ${reasons.join(', ')}, so the folder is "${name}"`,
    };
  }

  return { folder: name };
}
