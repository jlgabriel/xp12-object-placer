import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { preventFileDrop } from './preventFileDrop.js';
import { applyTheme } from './theme.js';
import './styles.css';

preventFileDrop();
// Before the first render, not in an effect: main already resolved the palette and put it on this
// renderer's command line so that this line can run now rather than one paint later.
applyTheme(window.xop.initialTheme);

const root = document.getElementById('root');
if (!root) throw new Error('no #root in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
