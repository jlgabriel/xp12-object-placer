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
import { describeScanCrash } from '../node/scanFailure.js';
import { logInfo } from './log.js';
import type { ScanMessage, ScanRequest } from './scanWorker.js';

const inFlight = new Map<string, Promise<CatalogSnapshot>>();

/**
 * How much of the worker's stderr to keep, from the front.
 *
 * From the front, not the back: V8 prints its `FATAL ERROR:` line and then a native stack trace
 * that can run to pages. Keeping the tail would reliably discard the one line worth reading.
 */
const STDERR_KEPT = 16 * 1024;

/**
 * How long to let the stderr pipe finish after the worker has gone.
 *
 * Electron gives a utility process no `close` event, only `exit`, so the last of stderr can still
 * be in flight when we are told the process is dead — and the last of stderr is exactly the line
 * that explains why. Waiting a quarter second for it is worth it; waiting for a pipe that will
 * never end is not.
 */
const DRAIN_MS = 250;

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

function drained(stream: NodeJS.ReadableStream | null, ms: number): Promise<void> {
  if (!stream) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(done, ms);
    stream.once('end', done);
    stream.once('close', done);
  });
}

export function runScan(
  userData: string,
  installation: string,
  onProgress: (progress: ScanProgress) => void,
): Promise<CatalogSnapshot> {
  const existing = inFlight.get(installation);
  if (existing) return existing;

  const scan = new Promise<CatalogSnapshot>((resolve, reject) => {
    const child = utilityProcess.fork(join(import.meta.dirname, 'scanWorker.js'), [], {
      // Hold the worker's stderr rather than letting it inherit ours. When a utility process dies
      // of something it cannot catch — V8 running out of heap, above all — the reason is printed
      // here and nowhere else, and in a packaged app an inherited stream goes to a console nobody
      // is watching. That is how v1.0.1 came to report a bare "exit code 5" to two users whose
      // installations were nine times the size of any we had scanned.
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let settled = false;
    let stderr = '';
    let lastProgress: ScanProgress | null = null;

    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      act();
      child.kill();
    };

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < STDERR_KEPT) stderr += String(chunk);
    });

    child.on('message', (message: ScanMessage) => {
      if (message.kind === 'progress') {
        lastProgress = message.progress;
        onProgress(message.progress);
      } else if (message.kind === 'done') finish(() => resolve(message.snapshot));
      else finish(() => reject(new ScanError(message.message)));
    });

    // A worker that dies without answering must not leave the promise pending forever, or the
    // in-flight guard would refuse every future scan for the rest of the session.
    child.on('exit', (code) => {
      if (settled) return;
      void drained(child.stderr, DRAIN_MS).then(() => {
        // The evidence and the sentence are two different things and both are wanted: the user
        // reads one line in the error bar, and the log keeps everything the worker managed to say
        // for the report that arrives three days later.
        if (stderr.trim() !== '') logInfo(`the scan worker's last output:\n${stderr.trimEnd()}`);
        finish(() => reject(new ScanError(describeScanCrash(code, stderr, lastProgress))));
      });
    });

    child.postMessage({ userData, installation } satisfies ScanRequest);
  });

  inFlight.set(installation, scan);
  void scan.catch(() => undefined).finally(() => inFlight.delete(installation));
  return scan;
}
