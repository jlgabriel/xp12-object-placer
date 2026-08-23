/**
 * What a log entry has to survive.
 *
 * The log exists for the failure nobody can reproduce: a stranger's machine, one screenshot, and
 * whatever we wrote down at the moment it happened. That makes the interesting cases the ugly ones
 * — something thrown that is not an `Error`, a rejection with no reason, an `fs` error whose only
 * useful token is its `code`. Those are exactly the ones a logger renders as `[object Object]`, and
 * the entry that says nothing costs the same as no log at all.
 */

import { describe, expect, it } from 'vitest';
import { describeError, formatLogEntry } from '../src/node/logFormat.js';

const AT = new Date('2026-08-23T12:34:56.000Z');

describe('describeError', () => {
  it('keeps the errno code, which is usually the whole diagnosis', () => {
    const error = Object.assign(new Error("EACCES: permission denied, open 'catalog.json'"), {
      code: 'EACCES',
    });
    expect(describeError(error)).toContain('Error [EACCES]');
    expect(describeError(error)).toContain('permission denied');
  });

  it('renders a plain Error without inventing a code', () => {
    const line = describeError(new Error('the catalog scan stopped unexpectedly'));
    expect(line.startsWith('Error: the catalog scan stopped unexpectedly')).toBe(true);
    expect(line).not.toContain('[');
  });

  it('keeps the class name, because ScanError and InstallError mean different things', () => {
    class ScanError extends Error {}
    const error = new ScanError('worker died');
    error.name = 'ScanError';
    expect(describeError(error)).toContain('ScanError: worker died');
  });

  it('survives a throw that is not an Error at all', () => {
    expect(describeError('just a string')).toBe('just a string');
    expect(describeError(undefined)).toContain('non-error value');
    expect(describeError({ code: 12, why: 'no message' })).toContain('"why":"no message"');
  });

  it('survives a circular non-error, rather than throwing while reporting a throw', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => describeError(circular)).not.toThrow();
  });

  it('follows a cause, and stops before a cycle can run the stack out', () => {
    const root = new Error('root');
    const wrapper = new Error('wrapper', { cause: root });
    expect(describeError(wrapper)).toContain('caused by Error: root');

    // A chain that never ends must not take the process with it.
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(() => describeError(b)).not.toThrow();
  });

  it('drops the repeated message line out of the stack but keeps the frames', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at somewhere (file.js:1:1)\n    at elsewhere (file.js:2:2)';
    const described = describeError(error);
    expect(described.split('\n')[0]).toBe('Error: boom');
    expect(described).toContain('at somewhere (file.js:1:1)');
    expect(described.match(/boom/g)).toHaveLength(1);
  });
});

describe('formatLogEntry', () => {
  it('stamps the time and ends the line itself', () => {
    expect(formatLogEntry(AT, 'started')).toBe('2026-08-23T12:34:56.000Z  started\n');
  });

  it('indents every line of the detail, so two entries never read as one', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at somewhere (file.js:1:1)';
    const entry = formatLogEntry(AT, 'xop:rescanCatalog failed', error);
    const lines = entry.split('\n');
    expect(lines[0]).toBe('2026-08-23T12:34:56.000Z  xop:rescanCatalog failed');
    expect(lines[1]).toBe('  Error: boom');
    expect(lines[2]).toBe('  at somewhere (file.js:1:1)');
    expect(entry.endsWith('\n')).toBe(true);
  });
});
