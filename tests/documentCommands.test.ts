import { describe, expect, it } from 'vitest';
import { createDocumentCommands, type DocumentApi } from '../src/renderer/documentCommands.js';
import { createEditorStore, projectOf } from '../src/renderer/state/store.js';
import { newProject, type Project } from '../src/core/project/project.js';
import type { CatalogEntry, DocumentState, OpenedProject } from '../src/shared/api.js';

const HANGAR: CatalogEntry = {
  virtualPath: 'lib/airport/hangars/arched/16x16/rusted_1.obj',
  name: 'rusted_1',
  category: ['airport', 'hangars'],
  variantCount: 1,
  animated: false,
  grounded: false,
  size: { width: 16.4, height: 6, depth: 16.1 },
  ground: { minX: -8.2, maxX: 8.2, minZ: -16.1, maxZ: 0 },
};

const SOMEWHERE = { lon: -70.7846, lat: -33.376 };

const document = (name: string, path: string | null = `C:/x/${name}.xop`): DocumentState => ({
  name,
  path,
  dirty: false,
});

/** A store with one object placed in it, and therefore unsaved work. */
function withWork(): ReturnType<typeof createEditorStore> {
  const store = createEditorStore();
  store.getState().setCatalog([HANGAR]);
  store.getState().arm(HANGAR.virtualPath);
  store.getState().placeAt(SOMEWHERE);
  return store;
}

/** A bridge that records what it was asked and answers however the test says. */
function fakeApi(answers: Partial<Record<keyof DocumentApi, unknown>> = {}) {
  const calls: string[] = [];
  const api: DocumentApi = {
    newProject: async () => {
      calls.push('newProject');
      return document('Untitled', null);
    },
    openProject: async () => {
      calls.push('openProject');
      return (answers.openProject ?? null) as OpenedProject | null;
    },
    saveProject: async (project: Project) => {
      calls.push('saveProject');
      void project;
      return (answers.saveProject === undefined
        ? document('apron')
        : answers.saveProject) as DocumentState | null;
    },
    saveProjectAs: async () => {
      calls.push('saveProjectAs');
      return (answers.saveProjectAs === undefined
        ? document('apron')
        : answers.saveProjectAs) as DocumentState | null;
    },
  };
  return { api, calls };
}

const opened = (objects: Project['objects'] = []): OpenedProject => ({
  document: document('Valparaiso'),
  project: { ...newProject('2026-08-22T12:00:00.000Z'), objects },
});

const always = (): boolean => true;
const never = (): boolean => false;

describe('saving', () => {
  it('sends what is on the map and marks it saved', async () => {
    const store = withWork();
    const { api, calls } = fakeApi();
    const commands = createDocumentCommands({ store, api, confirm: always });

    expect(await commands.save()).toBe(true);
    expect(calls).toEqual(['saveProject']);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().documentName).toBe('apron');
  });

  // Cancelling the file dialog is not saving. Clearing the unsaved mark here would make the close
  // guard let the window go, and the work would be gone with it.
  it('leaves the work unsaved when the dialog is cancelled', async () => {
    const store = withWork();
    const { api } = fakeApi({ saveProject: null });
    const commands = createDocumentCommands({ store, api, confirm: always });

    expect(await commands.save()).toBe(false);
    expect(store.getState().dirty).toBe(true);
  });

  it('save-as takes the name it was actually saved under', async () => {
    const store = withWork();
    const { api } = fakeApi({ saveProjectAs: document('Valparaiso docks') });
    const commands = createDocumentCommands({ store, api, confirm: always });

    expect(await commands.saveAs()).toBe(true);
    expect(store.getState().documentName).toBe('Valparaiso docks');
  });

  it('sends the camera along, so reopening looks where you left off', async () => {
    const store = withWork();
    store.getState().setCamera({ lon: 1, lat: 2, zoom: 15 });
    let sent: Project | null = null;
    const api: DocumentApi = {
      ...fakeApi().api,
      saveProject: async (project) => {
        sent = project;
        return document('apron');
      },
    };
    // Captured before saving: markSaved renames the document afterwards, so comparing against the
    // store's later state would be comparing against a different answer.
    const expected = projectOf(store.getState());
    await createDocumentCommands({ store, api, confirm: always }).save();

    expect(sent!.camera).toEqual({ lon: 1, lat: 2, zoom: 15 });
    expect(sent).toEqual(expected);
  });
});

describe('not losing work', () => {
  it('asks before a new project throws away unsaved objects', async () => {
    const store = withWork();
    const { api, calls } = fakeApi();
    const asked: string[] = [];

    await createDocumentCommands({
      store,
      api,
      confirm: (message) => {
        asked.push(message);
        return false;
      },
    }).newProject();

    expect(asked).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(store.getState().objects).toHaveLength(1);
  });

  it('asks before opening over unsaved objects, and keeps them on no', async () => {
    const store = withWork();
    const { api, calls } = fakeApi({ openProject: opened() });

    await createDocumentCommands({ store, api, confirm: never }).open();

    expect(calls).toEqual([]);
    expect(store.getState().objects).toHaveLength(1);
  });

  // Confirming something that costs nothing is how people learn to click through the confirmation
  // that does cost something.
  it('does not ask when there is nothing to lose', async () => {
    const store = createEditorStore();
    const { api, calls } = fakeApi({ openProject: opened() });
    let asked = 0;

    const commands = createDocumentCommands({
      store,
      api,
      confirm: () => {
        asked += 1;
        return true;
      },
    });
    await commands.newProject();
    await commands.open();

    expect(asked).toBe(0);
    expect(calls).toEqual(['newProject', 'openProject']);
  });

  it('goes ahead on yes', async () => {
    const store = withWork();
    const { api } = fakeApi({
      openProject: opened([
        { id: 'obj-4', libraryPath: HANGAR.virtualPath, position: SOMEWHERE, rotation: 0 },
      ]),
    });

    await createDocumentCommands({ store, api, confirm: always }).open();

    expect(store.getState().objects.map((object) => object.id)).toEqual(['obj-4']);
    expect(store.getState().documentName).toBe('Valparaiso');
    expect(store.getState().dirty).toBe(false);
  });

  it('keeps the current project when the open dialog is cancelled', async () => {
    const store = withWork();
    const { api } = fakeApi({ openProject: null });

    await createDocumentCommands({ store, api, confirm: always }).open();

    expect(store.getState().objects).toHaveLength(1);
    expect(store.getState().dirty).toBe(true);
  });
});
