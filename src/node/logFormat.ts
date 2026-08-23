/**
 * How one entry of the application log reads.
 *
 * Pure, and kept apart from the writer, because the part worth testing is the part that has to hold
 * up when the thing being logged is not an `Error` at all: a bare string, a rejection with no
 * reason, an object carrying a `code` and no `message`. That is precisely what turns up in a bug
 * report from somebody else's machine, and precisely what a logger tends to render as
 * `[object Object]` — which costs the report its only useful sentence.
 */

/** How far down a `cause` chain to walk. A cycle would otherwise recurse until the stack goes. */
const MAX_CAUSE_DEPTH = 4;

function stackFrames(error: Error): string {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  // Only the `at …` lines: the first line of a stack repeats the message, which is already above.
  const frames = stack.split('\n').filter((line) => /^\s+at\s/.test(line));
  return frames.length === 0 ? '' : `\n${frames.map((frame) => frame.trim()).join('\n')}`;
}

/**
 * One human-readable rendering of anything that was thrown.
 *
 * The `code` matters more than it looks: `EPERM`, `EACCES`, `ENOSPC` and `EBUSY` are the difference
 * between "your antivirus is holding the file", "the folder is read-only" and "the disk is full",
 * and every one of them arrives as a plain `Error` whose message alone reads like noise.
 */
export function describeError(error: unknown, depth = 0): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const name = error.name || 'Error';
    const head =
      code === undefined || code === null
        ? `${name}: ${error.message}`
        : `${name} [${String(code)}]: ${error.message}`;
    const cause =
      error.cause !== undefined && error.cause !== null && depth < MAX_CAUSE_DEPTH
        ? `\ncaused by ${describeError(error.cause, depth + 1)}`
        : '';
    return head + stackFrames(error) + cause;
  }
  if (typeof error === 'string') return error;
  try {
    return `non-error value: ${JSON.stringify(error)}`;
  } catch {
    // A circular object, or one with a throwing getter. Still worth a line.
    return `non-error value: ${String(error)}`;
  }
}

/**
 * One entry: an ISO timestamp, what happened, and — indented under it — the detail.
 *
 * The trailing newline belongs to the entry rather than to the caller, so an appender cannot forget
 * it and glue two entries together.
 */
export function formatLogEntry(at: Date, what: string, error?: unknown): string {
  const stamp = at.toISOString();
  if (error === undefined) return `${stamp}  ${what}\n`;
  const detail = describeError(error)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${stamp}  ${what}\n${detail}\n`;
}
