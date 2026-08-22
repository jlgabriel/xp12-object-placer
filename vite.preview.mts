import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The renderer, on its own, in a browser.
 *
 * XOP's UI normally runs inside Electron behind a sandbox, where it cannot be inspected, clicked or
 * asserted against without driving a desktop window. This serves the same React tree with a stubbed
 * `window.xop`, so layout and interaction can be verified by reading the DOM before anything is
 * committed.
 *
 * PCT's history is the argument for it: every interaction bug it ever had was caught this way, and
 * none of them by unit tests.
 *
 *   npm run preview:ui   →  http://localhost:5200/dev/preview.html
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5200, strictPort: true },
});
