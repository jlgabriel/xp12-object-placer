import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { preventFileDrop } from './preventFileDrop.js';
import './styles.css';

preventFileDrop();

const root = document.getElementById('root');
if (!root) throw new Error('no #root in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
