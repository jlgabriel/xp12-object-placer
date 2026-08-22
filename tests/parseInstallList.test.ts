import { describe, expect, it } from 'vitest';
import { parseInstallList } from '../src/core/install/parseInstallList.js';

describe('parseInstallList', () => {
  it('reads one installation per line, normalizing separators and the trailing slash', () => {
    expect(parseInstallList('D:\\Laminar/XP12-Last-Release/X-Plane 12/\n')).toEqual([
      'D:/Laminar/XP12-Last-Release/X-Plane 12',
    ]);
  });

  it('splits two entries written onto one line with no separator', () => {
    // Verbatim from a real x-plane_install_12.txt. Laminar's writer dropped the newline, exactly as
    // its library writer drops tabs. Trusting the line count here would hide an installation and
    // corrupt the one before it.
    const line =
      'C:\\Program Files (x86)/Steam/steamapps/common/X-Plane 12/D:\\Laminar/XP12-Beta/X-Plane 12/';
    expect(parseInstallList(line)).toEqual([
      'C:/Program Files (x86)/Steam/steamapps/common/X-Plane 12',
      'D:/Laminar/XP12-Beta/X-Plane 12',
    ]);
  });

  it('reads the whole of a real file', () => {
    const real = [
      'D:\\Laminar/XP12-Last-Release/X-Plane 12/',
      'D:\\SteamLibrary/steamapps/common/X-Plane 12/',
      'C:\\Program Files (x86)/Steam/steamapps/common/X-Plane 12/D:\\Laminar/XP12-Beta/X-Plane 12/',
      'D:\\Laminar/XP12-Beta/X-Plane 12/',
      '',
    ].join('\n');
    expect(parseInstallList(real)).toEqual([
      'D:/Laminar/XP12-Last-Release/X-Plane 12',
      'D:/SteamLibrary/steamapps/common/X-Plane 12',
      'C:/Program Files (x86)/Steam/steamapps/common/X-Plane 12',
      'D:/Laminar/XP12-Beta/X-Plane 12',
    ]);
  });

  it('leaves a POSIX path alone', () => {
    expect(parseInstallList('/Users/someone/X-Plane 12/\n/opt/X-Plane 12')).toEqual([
      '/Users/someone/X-Plane 12',
      '/opt/X-Plane 12',
    ]);
  });

  it('drops blank lines and repeats', () => {
    expect(parseInstallList('D:/a/\n\n  \nD:/a\nD:/b/')).toEqual(['D:/a', 'D:/b']);
  });

  it('returns nothing for an empty file rather than a phantom entry', () => {
    expect(parseInstallList('')).toEqual([]);
    expect(parseInstallList('\n\n')).toEqual([]);
  });

  it('drops UNC entries', () => {
    // Not tidiness. The caller stats every path this returns, synchronously, on the main thread,
    // before the window is shown. On Windows a stat of //host/share opens an SMB connection: a
    // dead host hangs the application at boot, and a live attacker host is handed the user's NTLM
    // hash. This file is written by an installer, not by the user.
    expect(parseInstallList('\\\\attacker\\share\\X-Plane 12\\')).toEqual([]);
    expect(parseInstallList('//attacker/share/X-Plane 12')).toEqual([]);
  });

  it('keeps good entries on a line that also holds a UNC one', () => {
    expect(parseInstallList('D:\\Laminar/X-Plane 12/\n\\\\host\\share\\X-Plane 12\\')).toEqual([
      'D:/Laminar/X-Plane 12',
    ]);
  });
});
