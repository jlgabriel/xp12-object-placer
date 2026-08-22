/**
 * Find the X-Plane 12 installations on this machine.
 *
 * Reads Laminar's own installation list, then checks each entry against the disk — the list keeps
 * naming installations long after they are gone, and it also names X-Plane 11, which XOP does not
 * support.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseInstallList } from '../core/install/parseInstallList.js';

export interface Installation {
  /** Absolute path, forward slashes, no trailing separator. */
  readonly path: string;
  /** Present only when the installation could be read. */
  readonly version?: string;
  readonly usable: boolean;
  /** Why it is not usable, for a UI that should explain rather than just omit. */
  readonly problem?: string;
}

/**
 * Where the installer keeps its list. X-Plane 11 has its own file, deliberately not read here.
 */
function installListPaths(): string[] {
  const home = homedir();
  switch (process.platform) {
    case 'win32': {
      const local = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
      return [join(local, 'x-plane_install_12.txt')];
    }
    case 'darwin':
      return [join(home, 'Library', 'Preferences', 'x-plane_install_12.txt')];
    default:
      return [join(home, '.x-plane', 'x-plane_install_12.txt')];
  }
}

/** The marker that separates an X-Plane installation from any other folder. */
export function isInstallation(path: string): boolean {
  try {
    return statSync(join(path, 'Resources', 'default scenery')).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The build string, from the first line of `Log.txt`:
 * `Log.txt for X-Plane 12.4.3-r2-15ff1e4d (build 124311 …)`
 *
 * Absent until the simulator has been run at least once, which is not a problem worth reporting —
 * a fresh installation is still perfectly usable.
 */
export function readVersion(path: string): string | undefined {
  try {
    const head = readFileSync(join(path, 'Log.txt'), 'latin1').slice(0, 200);
    return /X-Plane (\d+\.\d+\.\d+[^\s(]*)/.exec(head)?.[1];
  } catch {
    return undefined;
  }
}

export function describeInstallation(path: string): Installation {
  if (!existsSync(path)) {
    return { path, usable: false, problem: 'the folder is gone' };
  }
  if (!isInstallation(path)) {
    return { path, usable: false, problem: 'no Resources/default scenery inside' };
  }
  const version = readVersion(path);
  return version === undefined ? { path, usable: true } : { path, usable: true, version };
}

/**
 * Every installation Laminar's list mentions, described.
 *
 * Unusable entries are returned rather than filtered out: a user whose installation moved is better
 * served by "that folder is gone" than by an empty list and no explanation.
 */
export function findInstallations(): Installation[] {
  for (const listPath of installListPaths()) {
    let text: string;
    try {
      text = readFileSync(listPath, 'latin1');
    } catch {
      continue;
    }
    return parseInstallList(text).map(describeInstallation);
  }
  return [];
}
