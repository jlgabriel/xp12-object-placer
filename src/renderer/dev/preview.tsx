import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App.js';
import { installStubApi, type StubState } from './stubApi.js';
import { preventFileDrop } from '../preventFileDrop.js';
import '../styles.css';

// The stub has to exist before App's first effect runs, so this happens at module scope.
const state = (new URLSearchParams(location.search).get('state') ?? 'catalog') as StubState;
installStubApi(state);
preventFileDrop();

const root = document.getElementById('root');
if (!root) throw new Error('no #root in preview.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
