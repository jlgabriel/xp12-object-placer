/**
 * Which of the two palettes the window is wearing.
 *
 * Two states, not three. A "follow the system" state would have to be a third thing in the button,
 * and the button is one click in a header that has no room for a menu — so the *first* run follows
 * the system (main asks Electron, see main/index.ts) and after that the choice is the user's and
 * stays put. Nobody has to discover that their own choice is being overruled at sunset.
 *
 * The value reaches the renderer as a command-line flag rather than an IPC call, and that is the
 * whole trick: `xop:setTheme` could only answer *after* the first paint, which is one frame of the
 * old palette every time a light-theme user opens the application. A flag is already there when the
 * preload runs, so `data-theme` is on <html> before React renders a single element.
 */

export type Theme = 'light' | 'dark';

/** The flag main puts on the renderer's command line. */
export const THEME_FLAG = '--xop-theme=';

/**
 * The theme carried by a renderer's argv, or dark when the flag is not there.
 *
 * Dark is the fallback for the same reason it is the default: it is what XOP looked like for its
 * first three versions, so an argv this cannot read leaves the application looking like itself
 * rather than looking broken.
 */
export function themeFromArgv(argv: readonly string[]): Theme {
  const flag = argv.find((argument) => argument.startsWith(THEME_FLAG));
  return flag?.slice(THEME_FLAG.length) === 'light' ? 'light' : 'dark';
}

/**
 * The colour a window is painted before its page has drawn anything.
 *
 * Electron paints this while the renderer is still starting, and on Windows it is also what a
 * resize drags behind the frame — so a light window opening on `#11151a` shows a dark rectangle
 * first. These are `--bg` from styles.css and have to be kept in step with it.
 */
export const WINDOW_BACKGROUND: Record<Theme, string> = { dark: '#11151a', light: '#eef1f4' };

/** The one the button switches to. */
export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
