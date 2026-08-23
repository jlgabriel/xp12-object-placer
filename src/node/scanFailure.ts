/**
 * Turn a scan worker that died into a sentence somebody can act on.
 *
 * A utility process that dies takes its reason with it: the parent is handed an exit code and
 * nothing else. v1.0.1 reported exactly that — "the catalog scan stopped unexpectedly (exit code
 * 5)" — to two people whose installations were larger than any we had tested on. The cause was the
 * heap running out, and it had been said in English, on a stderr stream nobody was holding open.
 *
 * Nothing here guesses: every reason it returns is a line the worker itself printed. That
 * distinction is the whole point — "out of memory" as our inference would send somebody off to buy
 * RAM they may not need, while the same words quoted from V8 are evidence.
 *
 * Two things a forced crash on a real build taught this file, both of which a plausible-looking
 * implementation would have got wrong:
 *
 *  - **Electron does not print V8's `FATAL ERROR:` line.** It intercepts the OOM and logs its own,
 *    in Chromium's format, wrapped in a `[pid:date/time:ERROR:file:line]` prefix. Matching only on
 *    what Node prints would have found nothing in the one case we already know happens.
 *  - **The exit code is worth very little.** The same crash reported 5 on OldFartMike's Mac and 0
 *    on Windows. Zero, printed first, reads like the scan succeeded — so the code goes at the end,
 *    kept because a bug report may want it, not because it explains anything.
 */

import type { ScanProgress } from '../shared/api.js';

/** Long enough for the whole of an OOM line, short enough to read in an error bar. */
const MAX_REASON = 240;

/** `[27612:0823/162755.894:ERROR:electron\shell\common\node_bindings.cc:189] ` — Chromium's. */
const CHROMIUM_PREFIX = /^\[\d+:\d{4}\/[\d.]+:[A-Z]+:[^\]]*\]\s*/;

/** V8 and Electron's two ways of announcing that they are about to give up, and why. */
const FATAL = /^(FATAL ERROR:|OOM error in V8:)/;

/**
 * Lines that are true but useless to a reader: V8's GC table, its section banners, and the native
 * stack frames. Quoting a hex address at somebody is worse than saying nothing, because it looks
 * like the answer.
 */
const NOISE = /^(<---|-----|\[\d+:[0-9a-fx]+\]|\d+:\s*0x[0-9a-f]+|at\b)/i;

function cap(line: string): string {
  return line.length > MAX_REASON ? `${line.slice(0, MAX_REASON - 1)}…` : line;
}

/**
 * The one line worth quoting out of a dying process's stderr, or null if it said nothing useful.
 *
 * Order matters. An announced fatal beats everything else in the buffer; a thrown `Error:` is the
 * next best; and if all that came out was a native stack trace, the exit code alone is more honest
 * than a hex address dressed up as a cause.
 */
export function crashReason(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim().replace(CHROMIUM_PREFIX, ''))
    .filter((line) => line !== '');

  const fatal = lines.find((line) => FATAL.test(line));
  if (fatal) return cap(fatal);

  const thrown = lines.find((line) => /^[A-Za-z]*Error\b/.test(line));
  if (thrown) return cap(thrown);

  const last = lines.findLast((line) => !NOISE.test(line));
  return last ? cap(last) : null;
}

/** 34899 → "34,899". Written out rather than left to toLocaleString, which varies by machine. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * How far the scan had got, in the words of the phase it was in.
 *
 * Worth saying even when the reason is already clear: it is the difference between "the scan is
 * broken" and "the scan handles 31 500 of your objects", and it is the number that tells us whether
 * the next report is the same failure or a new one.
 */
function howFar(progress: ScanProgress | null): string {
  if (!progress || progress.phase !== 'measuring' || progress.total === 0) return '';
  return ` after measuring ${grouped(progress.done)} of ${grouped(progress.total)} objects`;
}

/**
 * The whole message, assembled from what is known and nothing else.
 *
 * `null` for the code is what Electron reports when it has none, and "unknown" is the honest word
 * for it.
 */
export function describeScanCrash(
  code: number | null,
  stderr: string,
  progress: ScanProgress | null,
): string {
  const reason = crashReason(stderr);
  return (
    'the catalog scan stopped unexpectedly' +
    howFar(progress) +
    (reason ? ` — ${reason}` : '') +
    ` (exit code ${code ?? 'unknown'})`
  );
}
