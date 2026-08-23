/**
 * Drive the scan worker from the main process.
 *
 * One scan at a time per installation: concurrent callers join the one already running instead of
 * starting another. With the work off-thread this guard is real — a renderer calling rescan in a
 * loop gets the same promise every time rather than queueing fifteen-second jobs. (Fable P1-3.)
 */

import { join } from 'node:path';
import { utilityProcess } from 'electron';
import type { CatalogSnapshot, ScanProgress } from '../shared/api.js';
import type { ScanMessage, ScanRequest } from './scanWorker.js';

const inFlight = new Map<string, Promise<CatalogSnapshot>>();

/**
 * A scan that did not finish, said in words meant for the person who asked for it.
 *
 * Marked with its own class so the IPC boundary can let the message through instead of replacing it
 * with the generic line. Every message this file produces is either written here or comes from the
 * scanner reading the user's own installation — the same category as an InstallError, and the same
 * reason to keep it: "the catalog scan stopped unexpectedly" and "EACCES … catalog" send somebody
 * to two completely different places, and "something went wrong" sends them nowhere.
 */
export class ScanError extends Error {}

export function runScan(
  userData: string,
  installation: string,
  onProgress: (progress: ScanProgress) => void,
): Promise<CatalogSnapshot> {
  const existing = inFlight.get(installation);
  if (existing) return existing;

  const scan = new Promise<CatalogSnapshot>((resolve, reject) => {
    const child = utilityProcess.fork(join(import.meta.dirname, 'scanWorker.js'));
    let settled = false;

    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      act();
      child.kill();
    };

    child.on('message', (message: ScanMessage) => {
      if (message.kind === 'progress') onProgress(message.progress);
      else if (message.kind === 'done') finish(() => resolve(message.snapshot));
      else finish(() => reject(new ScanError(message.message)));
    });

    // A worker that dies without answering must not leave the promise pending forever, or the
    // in-flight guard would refuse every future scan for the rest of the session.
    // The exit code is the whole of what we know here, so it goes in the sentence rather than being
    // summarised away. Guessing at a cause — "your antivirus", "out of memory" — would read as a
    // diagnosis, and a wrong one sends the reader to fix something that was never broken.
    child.on('exit', (code) =>
      finish(() =>
        reject(new ScanError(`the catalog scan stopped unexpectedly (exit code ${code})`)),
      ),
    );

    child.postMessage({ userData, installation } satisfies ScanRequest);
  });

  inFlight.set(installation, scan);
  void scan.catch(() => undefined).finally(() => inFlight.delete(installation));
  return scan;
}
