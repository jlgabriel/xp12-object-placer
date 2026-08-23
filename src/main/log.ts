/**
 * The application log — a file, on disk, that a user can find and send.
 *
 * v1.0.0 shipped without one, and the cost showed up within a day: somebody's rescan failed, the
 * app told them "something went wrong — see the application log", and there was no application log.
 * `console.error` in a packaged Electron app on Windows goes to a stream nobody is holding. The
 * error that would have named the cause in one line was written to nowhere, read by nobody, and the
 * report we got back could only say that it did not work.
 *
 * So: every unexpected failure in main lands here, and the window can open the file.
 *
 * Nothing in this module is allowed to throw. A logger that fails while reporting a failure turns a
 * recoverable problem into a crash, and does it at the exact moment the user is already unhappy.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { formatLogEntry } from '../node/logFormat.js';

/** Frozen at build time by electron.vite.config — see the note there about app.getVersion(). */
declare const __APP_VERSION__: string;

/**
 * Roll over at half a megabyte.
 *
 * Small on purpose. This log exists to be attached to a forum post, and the only entries that
 * matter are the recent ones; a file that grows without limit is one nobody opens twice.
 */
const MAX_BYTES = 512 * 1024;

let cached: string | undefined;

/** Where the log lives. `%APPDATA%/XP Object Placer/logs` on Windows, `~/Library/Logs/…` on macOS. */
export function logFile(): string {
  if (cached === undefined) {
    let directory: string;
    try {
      directory = app.getPath('logs');
    } catch {
      // Older behaviour, and any platform where Electron has no opinion: keep it beside the rest of
      // our state rather than giving up on logging.
      directory = join(app.getPath('userData'), 'logs');
    }
    cached = join(directory, 'xop.log');
  }
  return cached;
}

function write(entry: string): void {
  try {
    const file = logFile();
    mkdirSync(dirname(file), { recursive: true });
    try {
      // renameSync replaces an existing target on every platform we ship to, so one previous log is
      // always kept and never more than one.
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`);
    } catch {
      // No file yet, or somebody else rolled it first. Either way, appending is still right.
    }
    appendFileSync(file, entry);
  } catch {
    // See the module note: reporting a failure must not be able to cause one.
  }
}

export function logInfo(what: string): void {
  console.log(`[main] ${what}`);
  write(formatLogEntry(new Date(), what));
}

export function logError(what: string, error: unknown): void {
  console.error(`[main] ${what}:`, error);
  write(formatLogEntry(new Date(), what, error));
}

/**
 * Open the session.
 *
 * The header is what makes a pasted log answerable: which build, which OS, which architecture. A
 * stack trace without them invites a round of "and what version are you on?" that the file could
 * have answered by itself.
 */
export function logSessionStart(): void {
  write('\n');
  logInfo(
    `XP Object Placer ${__APP_VERSION__} started — ${process.platform} ${process.arch}, ` +
      `Electron ${process.versions.electron}, Node ${process.versions.node}`,
  );
}
