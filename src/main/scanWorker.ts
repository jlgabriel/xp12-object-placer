/**
 * The catalog scan, in a utility process.
 *
 * Reading 23 libraries and parsing 3 800 OBJ8 files takes about fifteen seconds of straight
 * synchronous work. Run on the main thread it blocks everything: the window cannot repaint, no
 * other IPC resolves, and — the part that made this worth moving rather than merely guarding — the
 * progress events could not be delivered at all, because nothing pumps the loop until the scan
 * returns. The progress bar was decorative. (Fable review P1-3.)
 *
 * Out here it is honest, the window stays alive, and a renderer that asks for ten scans cannot peg
 * the process that owns the user's window.
 */

import type { CatalogSnapshot, ScanProgress } from '../shared/api.js';
import { scanCatalog } from './catalogCache.js';

export interface ScanRequest {
  readonly userData: string;
  readonly installation: string;
}

export type ScanMessage =
  | { readonly kind: 'progress'; readonly progress: ScanProgress }
  | { readonly kind: 'done'; readonly snapshot: CatalogSnapshot }
  | { readonly kind: 'failed'; readonly message: string };

const port = process.parentPort;

port.on('message', (event) => {
  const request = event.data as ScanRequest;
  try {
    // Progress is throttled here rather than in the scanner: one message per 250 objects is plenty
    // for a bar, and flooding the parent would just move the cost rather than remove it.
    const snapshot = scanCatalog(request.userData, request.installation, (progress) => {
      port.postMessage({ kind: 'progress', progress } satisfies ScanMessage);
    });
    port.postMessage({ kind: 'done', snapshot } satisfies ScanMessage);
  } catch (error) {
    port.postMessage({
      kind: 'failed',
      message: error instanceof Error ? error.message : String(error),
    } satisfies ScanMessage);
  }
});
