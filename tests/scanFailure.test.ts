/**
 * What the app is able to say when the scan worker dies.
 *
 * This is the second half of the v1.0.1 lesson. That release gave main a log and stopped throwing
 * the scanner's own error message away — but a worker that dies of something it cannot catch never
 * gets to send a message at all, and for two users that is exactly what happened. All the app had
 * was a number, so all it said was a number.
 *
 * The rule these tests hold the code to: quote the worker, never interpret it. "Out of memory" as
 * our inference is a diagnosis, and a wrong one sends somebody to fix a machine that is fine. The
 * same words quoted from the runtime are evidence.
 *
 * Both fixtures below are transcripts, not inventions — the Electron one from a crash forced on a
 * real build of this app, the V8 one from what Node prints when it aborts on its own.
 */

import { describe, expect, it } from 'vitest';
import { crashReason, describeScanCrash } from '../src/node/scanFailure.js';

/** What a packaged build actually printed. Electron logs the OOM itself, in Chromium's format. */
const ELECTRON_OUT_OF_MEMORY = String.raw`
<--- Last few GCs --->

[27612:0000478C00204000]     5110 ms: Mark-Compact (reduce) 3869.1 (3871.8) -> 3869.1 (3871.6) MB, pooled: 0.0 MB, 87.78 / 0.00 ms (average mu = 0.067, current mu = 0.000) last resort; GC in old space requested

[27612:0823/162755.894:ERROR:electron\shell\common\node_bindings.cc:189] OOM error in V8: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
`;

/** What V8 prints when it aborts by itself, native stack trace and all. */
const V8_OUT_OF_MEMORY = `
<--- JS stacktrace --->

FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

 1: 0x1049b8f5c node::Abort() [/Applications/XP Object Placer.app/Contents/MacOS/XP Object Placer]
 2: 0x1049b90e8 node::OOMErrorHandler(char const*, v8::OOMDetails const&)
`;

const MEASURING = { phase: 'measuring', done: 31_500, total: 34_899 } as const;

describe('crashReason', () => {
  /** The line we already know we will meet, out of a buffer that is mostly GC bookkeeping. */
  it("takes Electron's OOM line and drops the Chromium prefix around it", () => {
    expect(crashReason(ELECTRON_OUT_OF_MEMORY)).toBe(
      'OOM error in V8: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory',
    );
  });

  it("takes V8's fatal line out of a page of native stack trace", () => {
    expect(crashReason(V8_OUT_OF_MEMORY)).toBe(
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
    );
  });

  it('takes a thrown error over the frames underneath it', () => {
    const thrown = [
      'file:///app.asar/out/main/scanWorker.js:12',
      "    throw new Error('EACCES: permission denied, open ...');",
      'Error: EACCES: permission denied, open /Users/mike/X-Plane 12/Custom Scenery',
      '    at Object.readFileSync (node:fs:1234:5)',
    ].join('\n');
    expect(crashReason(thrown)).toBe(
      'Error: EACCES: permission denied, open /Users/mike/X-Plane 12/Custom Scenery',
    );
  });

  /**
   * A hex address dressed up as a cause is worse than no cause: it reads like the answer, and it
   * sends the reader nowhere. Better to fall through to the exit code alone.
   */
  it('says nothing rather than quote a stack frame or a GC table', () => {
    expect(crashReason(' 1: 0x1049b8f5c node::Abort()\n 2: 0x1049b90e8 node::OOMErrorHandler()\n'))
      .toBeNull();
    expect(crashReason('[27612:0000478C00204000]  5110 ms: Mark-Compact (reduce) 3869.1')).toBeNull();
    expect(crashReason('')).toBeNull();
    expect(crashReason('   \n\n  ')).toBeNull();
  });

  it('keeps a runaway line short enough to read in an error bar', () => {
    const reason = crashReason(`Error: ${'x'.repeat(5000)}`);
    expect(reason!.length).toBeLessThanOrEqual(240);
    expect(reason!.endsWith('…')).toBe(true);
  });
});

describe('describeScanCrash', () => {
  it('is the whole sentence: what stopped, how far it got, and why', () => {
    expect(describeScanCrash(5, V8_OUT_OF_MEMORY, MEASURING)).toBe(
      'the catalog scan stopped unexpectedly after measuring 31,500 of 34,899 objects — ' +
        'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory ' +
        '(exit code 5)',
    );
  });

  /**
   * The same crash reported 5 on a Mac and 0 on Windows. Zero at the front of the sentence would
   * read as "the scan finished", which is why the code is last and the reason is not.
   */
  it('does not let a meaningless exit code lead the sentence', () => {
    expect(describeScanCrash(0, ELECTRON_OUT_OF_MEMORY, { ...MEASURING, done: 750, total: 3837 }))
      .toBe(
        'the catalog scan stopped unexpectedly after measuring 750 of 3,837 objects — ' +
          'OOM error in V8: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory ' +
          '(exit code 0)',
      );
  });

  it('still says how far it got when the worker printed nothing', () => {
    expect(describeScanCrash(5, '', MEASURING)).toBe(
      'the catalog scan stopped unexpectedly after measuring 31,500 of 34,899 objects (exit code 5)',
    );
  });

  it('drops the count when there is nothing to count yet', () => {
    expect(describeScanCrash(1, '', null)).toBe(
      'the catalog scan stopped unexpectedly (exit code 1)',
    );
    expect(describeScanCrash(1, '', { phase: 'libraries', done: 0, total: 0 })).toBe(
      'the catalog scan stopped unexpectedly (exit code 1)',
    );
  });

  /** Electron reports no code when the process was signalled. */
  it('says unknown rather than nothing when there is no exit code', () => {
    expect(describeScanCrash(null, '', null)).toBe(
      'the catalog scan stopped unexpectedly (exit code unknown)',
    );
  });
});
