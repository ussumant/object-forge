import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { ProjectStore } from './store.js';

let temporaryDirectory = '';

beforeEach(async () => {
  process.env.IMG3D_FAKE_PROVIDER = '1';
  temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'img3d-app-'));
});

afterEach(async () => {
  delete process.env.IMG3D_FAKE_PROVIDER;
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function multipart(
  boundary: string,
  fields: Record<string, string>,
  file: Buffer,
  filename = 'fixture.png',
  mimeType = 'image/png',
): Buffer {
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
  chunks.push(file);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

describe('local creator API', () => {
  it('stores an analyzed video capture and accepts its selected frame and label', async () => {
    const store = new ProjectStore(resolve(temporaryDirectory, 'video-projects'));
    const captureProcessor = {
      process: async (projectId: string, captureId: string) => {
        const framesDir = resolve(store.captureDir(projectId, captureId), 'frames');
        await mkdir(framesDir, { recursive: true });
        await sharp({ create: { width: 800, height: 600, channels: 3, background: '#1674ba' } })
          .jpeg().toFile(resolve(framesDir, 'frame-0001.jpg'));
        await store.updateCapture(projectId, captureId, {
          status: 'needs_review',
          durationMs: 10_000,
          width: 800,
          height: 600,
          frames: [{
            id: 'frame-one', filename: 'frame-0001.jpg', timestampMs: 500,
            width: 800, height: 600, sharpness: 0.8, exposure: 0.8, diversity: 1,
            selected: true, assignedRole: 'hero', confidence: 0.95,
          }],
          analysis: {
            summary: 'One clear front label frame.', warnings: [], requestedViews: ['back'],
            detectedTexts: [{
              id: 'text-one', value: 'POCARI SWEAT', frameId: 'frame-one', confidence: 0.98,
              bounds: { x: 0.2, y: 0.3, width: 0.6, height: 0.25 },
            }],
          },
        });
      },
      cancel: async (projectId: string, captureId: string) => {
        await store.updateCapture(projectId, captureId, { status: 'canceled' });
      },
    };
    const app = await createApp({ store, captureProcessor });
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Bottle' } });
    const projectId = created.json().project.id as string;
    const boundary = 'img3d-video-boundary';
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/captures/video`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, { provider: 'codex' }, Buffer.from('fake video'), 'bottle.mov', 'video/quicktime'),
    });
    expect(uploaded.statusCode).toBe(202);
    const captureId = uploaded.json().capture.id as string;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/captures/${captureId}` });
      if (state.json().capture.status === 'needs_review') break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/captures/${captureId}/accept`,
      payload: {
        frameIds: ['frame-one'],
        texts: [{
          id: 'text-one', value: 'POCARI SWEAT', frameId: 'frame-one', exportAllowed: true,
          bounds: { x: 0.2, y: 0.3, width: 0.6, height: 0.25 },
        }],
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().project.references[0].captureProvenance.captureId).toBe(captureId);
    expect(accepted.json().project.surfaceTexts[0]).toMatchObject({ value: 'POCARI SWEAT', renderingMethod: 'hybrid-decal' });
    expect(accepted.json().project.captures[0].status).toBe('ready');
    await app.close();
  });

  it('creates, captures, drafts, activates, previews, and exports a project', async () => {
    const store = new ProjectStore(resolve(temporaryDirectory, 'projects'));
    const app = await createApp({ store });
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Fixture Camera' } });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#b9b8ae' } }).png().toBuffer();
    const boundary = 'img3d-test-boundary';
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/references`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, { role: 'hero', crop: JSON.stringify({ x: 50, y: 40, width: 700, height: 520 }) }, image),
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().project.suitability.verdict).toBe('conditional');

    const started = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      payload: { provider: 'codex', kind: 'draft', acceptApproximation: true },
    });
    expect(started.statusCode).toBe(202);
    const runId = started.json().run.id as string;

    let project: {
      activeRunId?: string;
      runs: Array<{
        id: string;
        status: string;
        providerSessionId?: string;
        error?: string;
        artifacts: Array<{ kind: string; path: string }>;
      }>;
    } | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}` });
      project = response.json().project;
      if (project?.runs.find((run) => run.id === runId)?.status === 'succeeded') break;
    }
    expect(project?.activeRunId).toBe(runId);

    const draftSessionId = project?.runs.find((run) => run.id === runId)?.providerSessionId;
    expect(draftSessionId).toMatch(/^fake-codex-/);
    const finished = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      payload: { provider: 'codex', kind: 'finish', sourceRunId: runId },
    });
    expect(finished.statusCode).toBe(202);
    const finishRunId = finished.json().run.id as string;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}` });
      project = response.json().project;
      if (project?.runs.find((run) => run.id === finishRunId)?.status === 'succeeded') break;
    }
    const finishRun = project?.runs.find((run) => run.id === finishRunId);
    expect(finishRun?.status, finishRun?.error).toBe('succeeded');
    expect(project?.activeRunId).toBe(finishRunId);
    expect(finishRun?.providerSessionId).toBe(draftSessionId);

    const reviewIndex = finishRun?.artifacts.findIndex((artifact) => artifact.kind === 'comparison') ?? -1;
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    const review = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${finishRunId}/artifacts/${reviewIndex}`,
    });
    expect(review.statusCode).toBe(200);
    expect(review.headers['content-type']).toContain('image/png');

    const model = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/${finishRunId}/model.js` });
    expect(model.statusCode).toBe(200);
    expect(model.body).toContain('sculptRuntime');

    const archive = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/export` });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers['content-type']).toContain('application/zip');
    expect(archive.rawPayload.byteLength).toBeGreaterThan(1_000);
    await app.close();
  });
});
