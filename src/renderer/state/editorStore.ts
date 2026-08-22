/**
 * The application's one editor store, and the React hook onto it.
 *
 * Split from store.ts so the factory stays free of anything DOM-shaped and keeps unit-testing under
 * the node config. Everything here is renderer-only.
 */

import { useStore } from 'zustand';
import { createEditorStore, type EditorState } from './store.js';

/** The store the map layer subscribes to directly, outside React. */
export const editorStore = createEditorStore();

/** Subscribe a React component to a slice of the store. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
