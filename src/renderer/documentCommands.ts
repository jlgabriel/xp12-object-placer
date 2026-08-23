/**
 * New, Open, Save, Save As — the four things a document can be asked to do.
 *
 * Kept out of the component and given its dependencies rather than reaching for them, because the
 * rule worth testing lives here and has nothing to do with React: **an unsaved project is never
 * replaced without asking.** New and Open both throw away everything on the map, and the only
 * thing standing between a person and that is the confirmation in these four functions.
 *
 * Nothing here knows a path. Every one of these calls across to main, which owns the paths and
 * draws the dialogs.
 */

import type { DocumentState, OpenedProject } from '../shared/api.js';
import type { Project } from '../core/project/project.js';
import { projectOf, type EditorStore } from './state/store.js';

/** Just the part of the bridge these need, so a test can supply four functions instead of a bridge. */
export interface DocumentApi {
  newProject(): Promise<DocumentState>;
  openProject(): Promise<OpenedProject | null>;
  saveProject(project: Project): Promise<DocumentState | null>;
  saveProjectAs(project: Project): Promise<DocumentState | null>;
}

export interface DocumentCommands {
  /** Empty the map and start again. */
  newProject(): Promise<void>;
  /** Open a project, replacing what is on the map. */
  open(): Promise<void>;
  /** Save. Returns whether the work actually reached the disk. */
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
}

const DISCARD_FOR_NEW = 'Start a new project and lose the objects you have placed?';
const DISCARD_FOR_OPEN = 'Open another project and lose the objects you have placed?';

export function createDocumentCommands(deps: {
  store: EditorStore;
  api: DocumentApi;
  /** `window.confirm` in the app; a function in a test. */
  confirm: (message: string) => boolean;
}): DocumentCommands {
  const { store, api, confirm } = deps;

  /** Ask only when there is something to lose. Confirming a no-op teaches people to click through. */
  const mayDiscard = (message: string): boolean => !store.getState().dirty || confirm(message);

  const save = async (): Promise<boolean> => {
    const saved = await api.saveProject(projectOf(store.getState()));
    if (!saved) return false;
    store.getState().markSaved(saved.name);
    return true;
  };

  return {
    async newProject() {
      if (!mayDiscard(DISCARD_FOR_NEW)) return;
      await api.newProject();
      store.getState().resetProject();
    },

    async open() {
      if (!mayDiscard(DISCARD_FOR_OPEN)) return;
      const opened = await api.openProject();
      // Null is a cancelled dialog. A file that is not a project throws instead, and the caller
      // shows it — losing the open project over a mis-click would be the wrong reading of both.
      if (!opened) return;
      store.getState().loadProject(opened.project, opened.document.name);
    },

    save,

    async saveAs() {
      const saved = await api.saveProjectAs(projectOf(store.getState()));
      if (!saved) return false;
      store.getState().markSaved(saved.name);
      return true;
    },
  };
}
