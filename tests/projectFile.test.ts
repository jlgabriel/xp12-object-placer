import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  documentName,
  forgetProject,
  getCurrentProjectPath,
  isDirty,
  openProject,
  saveProject,
  saveProjectAs,
  setCurrentProjectPath,
  setDirty,
  withExtension,
} from '../src/main/projectFile.js';
import {
  newProject,
  parseProject,
  UnsupportedSchemaVersionError,
  UNTITLED,
  type Project,
} from '../src/core/project/project.js';
import type { PlacedObject } from '../src/core/model.js';

const NOW = '2026-08-22T12:00:00.000Z';
const TRUCK: PlacedObject = {
  id: 'obj-1',
  libraryPath: 'lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj',
  position: { lon: -70.78462, lat: -33.3762 },
  rotation: 30,
};

const created: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xop-project-'));
  created.push(dir);
  return dir;
}

/** A picker that answers with a fixed path, and remembers whether it was asked. */
function picks(path: string | null): PickSpy {
  const spy = (() => {
    spy.calls += 1;
    return path;
  }) as PickSpy;
  spy.calls = 0;
  return spy;
}
type PickSpy = (() => string | null) & { calls: number };

const project = (): Project => ({ ...newProject(NOW), name: 'apron', objects: [TRUCK] });

beforeEach(() => forgetProject());
afterEach(() => {
  forgetProject();
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

describe('save as', () => {
  it('writes a project that reads back as the same project', async () => {
    const file = join(scratch(), 'apron.xop');
    await saveProjectAs(project(), picks(file), NOW);

    const back = parseProject(JSON.parse(readFileSync(file, 'utf8')));
    expect(back.objects).toEqual([TRUCK]);
    expect(back.camera).toEqual(project().camera);
  });

  it('adds the extension when the user did not type one', async () => {
    const dir = scratch();
    const written = await saveProjectAs(project(), picks(join(dir, 'apron')), NOW);
    expect(written).toBe(join(dir, 'apron.xop'));
    expect(existsSync(join(dir, 'apron.xop'))).toBe(true);
  });

  it('leaves an extension that is already right alone, whatever its case', () => {
    expect(withExtension('a/b.xop')).toBe('a/b.xop');
    expect(withExtension('a/b.XOP')).toBe('a/b.XOP');
    expect(withExtension('a/b.backup')).toBe('a/b.backup.xop');
  });

  it('takes the document name from the file the user chose', async () => {
    const dir = scratch();
    await saveProjectAs(project(), picks(join(dir, 'Valparaiso docks.xop')), NOW);
    expect(documentName()).toBe('Valparaiso docks');

    const back = parseProject(JSON.parse(readFileSync(join(dir, 'Valparaiso docks.xop'), 'utf8')));
    expect(back.name).toBe('Valparaiso docks');
  });

  it('writes nothing and keeps the old path when the user cancels', async () => {
    const dir = scratch();
    const first = join(dir, 'first.xop');
    await saveProjectAs(project(), picks(first), NOW);

    expect(await saveProjectAs(project(), picks(null), NOW)).toBeNull();
    expect(getCurrentProjectPath()).toBe(first);
    expect(readdirSync(dir)).toEqual(['first.xop']);
  });
});

describe('save', () => {
  it('goes to the open file without asking again', async () => {
    const file = join(scratch(), 'apron.xop');
    await saveProjectAs(project(), picks(file), NOW);

    const pick = picks(null);
    const written = await saveProject({ ...project(), objects: [] }, pick, NOW);

    expect(written).toBe(file);
    expect(pick.calls).toBe(0);
    expect(parseProject(JSON.parse(readFileSync(file, 'utf8'))).objects).toEqual([]);
  });

  it('falls through to save-as when nothing is open yet', async () => {
    const file = join(scratch(), 'fresh.xop');
    const pick = picks(file);
    expect(await saveProject(project(), pick, NOW)).toBe(file);
    expect(pick.calls).toBe(1);
  });

  it('stamps the modification time it was saved at', async () => {
    const file = join(scratch(), 'apron.xop');
    await saveProjectAs(project(), picks(file), '2026-09-09T09:09:09.000Z');
    const back = parseProject(JSON.parse(readFileSync(file, 'utf8')));
    expect(back.createdAt).toBe(NOW);
    expect(back.modifiedAt).toBe('2026-09-09T09:09:09.000Z');
  });

  // The previous save is exactly what somebody falls back on, so the one thing a save may never do
  // is destroy it on the way to failing.
  it('leaves no temporary file behind', async () => {
    const dir = scratch();
    await saveProjectAs(project(), picks(join(dir, 'apron.xop')), NOW);
    expect(readdirSync(dir)).toEqual(['apron.xop']);
  });
});

describe('open', () => {
  it('reads back what was saved, and clears the unsaved mark', async () => {
    const file = join(scratch(), 'apron.xop');
    await saveProjectAs(project(), picks(file), NOW);
    forgetProject();
    setDirty(true);

    const opened = await openProject(picks(file));
    expect(opened?.path).toBe(file);
    expect(opened?.project.objects).toEqual([TRUCK]);
    expect(isDirty()).toBe(false);
    expect(documentName()).toBe('apron');
  });

  it('does nothing at all when the user cancels', async () => {
    setCurrentProjectPath('C:/somewhere/open.xop');
    expect(await openProject(picks(null))).toBeNull();
    expect(getCurrentProjectPath()).toBe('C:/somewhere/open.xop');
  });

  // A failed open must not take the open document down with it. Somebody who tries to open the
  // wrong file still has their work, and the path they were saving to.
  it('keeps the current document when the file turns out not to be a project', async () => {
    const dir = scratch();
    const good = join(dir, 'good.xop');
    await saveProjectAs(project(), picks(good), NOW);

    const bad = join(dir, 'bad.xop');
    writeFileSync(bad, '{ "app": "something else" }', 'utf8');

    await expect(openProject(picks(bad))).rejects.toThrow();
    expect(getCurrentProjectPath()).toBe(good);
  });

  it('says a damaged file is damaged, in a sentence', async () => {
    const file = join(scratch(), 'torn.xop');
    writeFileSync(file, '{ "app": "xop", "objects": [', 'utf8');
    await expect(openProject(picks(file))).rejects.toThrow(/not valid JSON/);
  });

  it('says a newer format is a newer format', async () => {
    const file = join(scratch(), 'future.xop');
    writeFileSync(file, JSON.stringify({ ...project(), schemaVersion: 99 }), 'utf8');
    await expect(openProject(picks(file))).rejects.toThrow(UnsupportedSchemaVersionError);
  });
});

describe('the document name', () => {
  it('is Untitled until there is a file', () => {
    expect(documentName()).toBe(UNTITLED);
  });

  it('drops the extension, whatever its case', () => {
    setCurrentProjectPath('C:/x/SCEL apron.XOP');
    expect(documentName()).toBe('SCEL apron');
  });
});
