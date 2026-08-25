import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { otherTheme, THEME_FLAG, themeFromArgv, WINDOW_BACKGROUND } from '../src/shared/theme.js';

/**
 * The flag is how the palette reaches the renderer before its first paint, so the parsing has to
 * survive the argv Electron actually hands a sandboxed preload: the executable, Chromium's own
 * switches, and ours somewhere in the middle.
 */
describe('themeFromArgv', () => {
  it('reads the flag wherever it sits in the line', () => {
    expect(themeFromArgv(['electron.exe', '--no-sandbox', `${THEME_FLAG}light`, '--lang=en'])).toBe(
      'light',
    );
    expect(themeFromArgv([`${THEME_FLAG}dark`])).toBe('dark');
  });

  it('falls back to dark when there is no flag', () => {
    // Not a preference — dark is what XOP looked like for three versions, so an argv this cannot
    // read leaves the window looking like itself rather than looking broken.
    expect(themeFromArgv([])).toBe('dark');
    expect(themeFromArgv(['electron.exe', '--no-sandbox'])).toBe('dark');
  });

  it('falls back to dark on a value it does not know', () => {
    expect(themeFromArgv([`${THEME_FLAG}sepia`])).toBe('dark');
    expect(themeFromArgv([`${THEME_FLAG}`])).toBe('dark');
  });

  it('is not fooled by a flag that merely starts the same way', () => {
    expect(themeFromArgv(['--xop-theme-light'])).toBe('dark');
  });
});

describe('otherTheme', () => {
  it('is the switch, and switching twice is where you started', () => {
    expect(otherTheme('dark')).toBe('light');
    expect(otherTheme('light')).toBe('dark');
    expect(otherTheme(otherTheme('light'))).toBe('light');
  });
});

describe('WINDOW_BACKGROUND', () => {
  it('answers for both themes', () => {
    // Main paints this behind the page before the renderer has drawn anything. A theme missing
    // from here would be an undefined handed to Electron and a black rectangle on screen.
    expect(WINDOW_BACKGROUND.light).toMatch(/^#[0-9a-f]{6}$/);
    expect(WINDOW_BACKGROUND.dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(WINDOW_BACKGROUND.light).not.toBe(WINDOW_BACKGROUND.dark);
  });
});

/**
 * Two files have to agree about one colour, and nothing at run time would notice if they stopped:
 * main paints WINDOW_BACKGROUND behind a page that has not drawn yet, the page then paints --bg
 * over it, and a mismatch shows up as a flash on launch and a coloured band while the window is
 * being resized. Cheap to check here, invisible everywhere else.
 */
describe('the window background matches the palette', () => {
  const css = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

  const bgOf = (selector: string): string => {
    const block = css.slice(css.indexOf(selector));
    const match = /--bg:\s*(#[0-9a-f]{3,8});/.exec(block.slice(0, block.indexOf('}')));
    if (!match?.[1]) throw new Error(`no --bg under ${selector}`);
    return match[1];
  };

  it('for the dark theme', () => {
    expect(bgOf(':root {')).toBe(WINDOW_BACKGROUND.dark);
  });

  it('for the light theme', () => {
    expect(bgOf(':root[data-theme="light"]')).toBe(WINDOW_BACKGROUND.light);
  });
});
