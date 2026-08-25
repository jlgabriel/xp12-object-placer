/**
 * The palette, on this side of the bridge.
 *
 * All the renderer does is write `data-theme` onto <html>; every colour in the application is a
 * custom property in styles.css, and the two blocks at the top of that file are the whole of the
 * difference between the two themes. Nothing here knows what any of them are.
 */

import { useCallback, useState } from 'react';
import { otherTheme, type Theme } from '../shared/theme.js';

/** Dress the document. Called before the first render, and again on every switch. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

/**
 * The theme, and the one thing you can do to it.
 *
 * The switch is applied to the document first and persisted second, deliberately: the click has to
 * land now, and whether main managed to write settings.json is not something the eye should have
 * to wait for. A failed write costs the choice at the *next* launch, which is worth a line in the
 * log and not worth a dialog.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(window.xop.initialTheme);

  const toggle = useCallback(() => {
    const next = otherTheme(theme);
    setTheme(next);
    applyTheme(next);
    void window.xop.setTheme(next).catch((cause: unknown) => {
      console.warn('the theme could not be remembered', cause);
    });
  }, [theme]);

  return { theme, toggle };
}
