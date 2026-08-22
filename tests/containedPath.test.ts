import { describe, expect, it } from 'vitest';
import { containedJoin } from '../src/node/containedPath.js';

const PKG = 'C:/XP12/Custom Scenery/pkg';

describe('containedJoin', () => {
  it('joins an ordinary relative path', () => {
    expect(containedJoin(PKG, 'objects/hangar.obj')?.replace(/\\/g, '/')).toBe(
      'C:/XP12/Custom Scenery/pkg/objects/hangar.obj',
    );
  });

  it('allows .. that stays inside', () => {
    expect(containedJoin(PKG, 'objects/../textures/a.dds')?.replace(/\\/g, '/')).toBe(
      'C:/XP12/Custom Scenery/pkg/textures/a.dds',
    );
  });

  it('refuses .. that escapes', () => {
    // This is the real one. A scenery pack is a ZIP from the internet, and path.join does not
    // contain anything: join(PKG, '../../../../Windows/win.ini') is C:\Windows\win.ini.
    expect(containedJoin(PKG, '../../../../Windows/win.ini')).toBeNull();
    expect(containedJoin(PKG, '..')).toBeNull();
    expect(containedJoin(PKG, 'objects/../../../secret.txt')).toBeNull();
  });

  it('refuses a path containing NUL', () => {
    // A NUL truncates inside some syscalls, so what was checked and what gets opened differ.
    expect(containedJoin(PKG, 'objects/a.obj\0../../etc/passwd')).toBeNull();
  });

  it('never lets anything out, whatever it is handed', () => {
    // Asserted as the property rather than as a list of expected verdicts. Whether a given oddity
    // comes back contained or rejected is an implementation detail of path.win32 that could shift
    // between Node versions; what must never shift is that nothing resolves outside the package.
    const hostile = [
      '../../../../Windows/win.ini',
      '..',
      './../..',
      'objects/../../../secret.txt',
      '/Windows/win.ini',
      'D:/secret.txt',
      '\\\\attacker\\share',
      'objects/a.obj\0../../etc/passwd',
      'objects//..//..//x',
    ];

    for (const input of hostile) {
      const result = containedJoin(PKG, input);
      if (result === null) continue; // refused outright is fine
      const normalized = result.replace(/\\/g, '/');
      expect(normalized.startsWith(`${PKG}/`), `${input} escaped to ${normalized}`).toBe(true);
    }
  });

  it('allows the root itself', () => {
    expect(containedJoin(PKG, '.')).not.toBeNull();
  });
});
