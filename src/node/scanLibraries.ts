/**
 * Find and read the library files of an X-Plane installation.
 *
 * This is the I/O half. Everything it produces is fed to the pure builders in src/core/catalog.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseLibraryTxt, type ParsedLibrary } from '../core/catalog/library.js';
import type { LibrarySource } from '../core/catalog/catalog.js';

/** Where scenery packages live, relative to the installation root. */
const PACKAGE_ROOTS = ['Resources/default scenery', 'Custom Scenery'] as const;

export interface ScanProblem {
  readonly packagePath: string;
  readonly message: string;
}

export interface LibraryScan {
  readonly sources: readonly LibrarySource[];
  readonly problems: readonly ScanProblem[];
}

/** True if the path looks like an X-Plane installation root. */
export function looksLikeInstallation(root: string): boolean {
  try {
    return statSync(join(root, 'Resources', 'default scenery')).isDirectory();
  } catch {
    return false;
  }
}

/**
 * ⚠️ The filename's case varies: stock packages ship `library.txt`, several third-party ones ship
 * `Library.txt`. Matching case-sensitively silently loses whole libraries, which on Windows would
 * not even be reproducible for the person reporting it.
 */
function findLibraryFile(packagePath: string): string | null {
  let names: string[];
  try {
    names = readdirSync(packagePath);
  } catch {
    return null;
  }
  const match = names.find((n) => n.toLowerCase() === 'library.txt');
  return match ? join(packagePath, match) : null;
}

export function scanLibraries(installationRoot: string): LibraryScan {
  const sources: LibrarySource[] = [];
  const problems: ScanProblem[] = [];

  for (const root of PACKAGE_ROOTS) {
    const rootPath = join(installationRoot, root);
    let packageNames: string[];
    try {
      packageNames = readdirSync(rootPath);
    } catch {
      problems.push({ packagePath: rootPath, message: 'directory not found' });
      continue;
    }

    for (const packageName of packageNames) {
      const packagePath = join(rootPath, packageName);
      try {
        if (!statSync(packagePath).isDirectory()) continue;
      } catch {
        continue;
      }

      const libraryFile = findLibraryFile(packagePath);
      if (!libraryFile) continue; // a package without a library is normal, not a problem

      let parsed: ParsedLibrary;
      try {
        // latin1, not utf8: these files are ASCII in practice, and a stray high byte in a
        // third-party library must not turn into a replacement character inside a path.
        parsed = parseLibraryTxt(readFileSync(libraryFile, 'latin1'));
      } catch (error) {
        problems.push({
          packagePath,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      sources.push({ packageName, packagePath, parsed });
    }
  }

  return { sources, problems };
}
