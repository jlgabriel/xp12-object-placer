import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// XOP — Electron/React/Vite wiring. Three build targets that all share the pure src/core.
//
// The preload is emitted as CommonJS on purpose: Electron requires a CJS preload when the renderer
// runs with sandbox:true, and the preload only needs contextBridge + ipcRenderer, both of which the
// sandbox supports. Keeping the sandbox on is worth the one odd output format.
//
// The version is frozen into the bundle here rather than read with app.getVersion() at runtime.
// PCT learned that the hard way: launched by path — which is exactly how an e2e run launches it —
// app.getVersion() finds no package.json of its own and returns the ELECTRON binary's version, so
// the window title read "PCT 43.0.0". Correct in a packaged build and nonsense everywhere else is
// the worst kind of wrong, because the test that would catch it agrees with whatever it sees.
const APP_VERSION: string = JSON.parse(
  readFileSync(new URL('package.json', import.meta.url), 'utf8'),
).version;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom'] },
  },
});
