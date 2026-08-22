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
      else finish(() => reject(new Error(message.message)));
    });

    // A worker that dies without answering must not leave the promise pending forever, or the
    // in-flight guard would refuse every future scan for the rest of the session.
    child.on('exit', () => finish(() => reject(new Error('the catalog scan stopped unexpectedly'))));

    child.postMessage({ userData, installation } satisfies ScanRequest);
  });

  inFlight.set(installation, scan);
  void scan.catch(() => undefined).finally(() => inFlight.delete(installation));
  return scan;
}
