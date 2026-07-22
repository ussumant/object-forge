import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReferenceImage } from '@img3d/shared';
import { ProjectStore } from './store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createStore(): Promise<ProjectStore> {
  const directory = await mkdtemp(resolve(tmpdir(), 'img3d-store-'));
  temporaryDirectories.push(directory);
  const store = new ProjectStore(directory);
  await store.init();
  return store;
}

function reference(id = 'hero123'): ReferenceImage {
  return {
    id,
    role: 'hero',
    originalFilename: 'clock.png',
    storedFilename: `${id}.png`,
    mimeType: 'image/png',
    bytes: 1_024,
    width: 800,
    height: 600,
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

describe('ProjectStore', () => {
  it('persists projects, references, and immutable run history', async () => {
    const store = await createStore();
    const project = await store.createProject('Braun Alarm Clock');
    await writeFile(resolve(store.referencesDir(project.id), 'hero123.png'), 'fixture');
    const withReference = await store.addReference(project.id, reference());
    expect(withReference.slug).toBe('braun-alarm-clock');
    expect(withReference.suitability.verdict).toBe('conditional');

    const first = await store.createRun(project.id, 'codex', 'draft');
    await store.updateRun(project.id, first.id, { status: 'succeeded', completedAt: new Date().toISOString() });
    await store.activateRun(project.id, first.id);
    const second = await store.createRun(project.id, 'claude', 'refine', first.id, 'Wider handle');
    await store.updateRun(project.id, second.id, { status: 'failed', error: 'fixture failure' });

    const reloaded = await store.getProject(project.id);
    expect(reloaded.activeRunId).toBe(first.id);
    expect(reloaded.runs).toHaveLength(2);
    expect(reloaded.runs.find((run) => run.id === second.id)?.status).toBe('failed');
  });

  it('rejects path-like project ids', async () => {
    const store = await createStore();
    expect(() => store.projectDir('../outside')).toThrow('Invalid project id');
  });
});
