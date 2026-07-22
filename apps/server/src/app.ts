import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import {
  isProvider,
  isReferenceRole,
  isRunKind,
  type NormalizedRect,
  type CropRect,
  type ReferenceImage,
  type SurfaceTextEvidence,
  type StartRunInput,
  type VideoCapture,
} from '@img3d/shared';
import { CaptureManager, captureFrameStream, captureToolHealth, type CaptureProcessor } from './capture.js';
import { RunEventBus } from './events.js';
import { buildProjectExport } from './exporter.js';
import { WEB_DIST_DIR } from './paths.js';
import { providerHealth } from './providers.js';
import { RunManager } from './runner.js';
import { ProjectStore } from './store.js';

const uploadMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const videoMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const cropSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

function fieldValue(fields: Record<string, unknown>, key: string): string | undefined {
  const field = fields[key] as { value?: unknown } | Array<{ value?: unknown }> | undefined;
  const item = Array.isArray(field) ? field.at(-1) : field;
  return typeof item?.value === 'string' ? item.value : undefined;
}

function extensionForMime(mime: string): string {
  return mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
}

function parseCrop(raw: string | undefined): CropRect | undefined {
  if (!raw) return undefined;
  return cropSchema.parse(JSON.parse(raw));
}

export async function createApp(options: { store?: ProjectStore; captureProcessor?: CaptureProcessor } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const store = options.store ?? new ProjectStore();
  await store.init();
  const eventBus = new RunEventBus();
  const runs = new RunManager(store, eventBus);
  const captures = options.captureProcessor ?? new CaptureManager(store);

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 16, parts: 18 },
  });

  app.get('/api/health', async () => ({ ok: true, fakeProvider: process.env.IMG3D_FAKE_PROVIDER === '1' }));

  app.get('/api/system/capture', async () => captureToolHealth());

  app.get('/api/system/providers', async () => {
    const [codex, claude] = await Promise.all([providerHealth('codex'), providerHealth('claude')]);
    return { providers: [codex, claude] };
  });

  app.get('/api/projects', async () => ({ projects: await store.listProjects() }));

  app.post<{ Body: { name?: string } }>('/api/projects', async (request, reply) => {
    const name = z.string().trim().min(1).max(100).parse(request.body?.name);
    const project = await store.createProject(name);
    return reply.code(201).send({ project });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) => ({
    project: await store.getProject(request.params.id),
  }));

  app.post<{ Params: { id: string } }>('/api/projects/:id/references', async (request, reply) => {
    const project = await store.getProject(request.params.id);
    if (project.references.length >= 8) throw new Error('A project can contain at most eight reference images.');
    const upload = await request.file();
    if (!upload) throw new Error('Attach one image file.');
    const role = fieldValue(upload.fields as Record<string, unknown>, 'role');
    if (!isReferenceRole(role)) throw new Error('Choose a valid reference role.');
    if (role === 'hero' && project.references.some((item) => item.role === 'hero')) {
      throw new Error('This project already has a hero image.');
    }
    if (!uploadMimeTypes.has(upload.mimetype)) throw new Error('Only PNG, JPEG, and WebP images are supported.');
    const buffer = await upload.toBuffer();
    if (buffer.byteLength > 20 * 1024 * 1024) throw new Error('Reference images must be 20 MB or smaller.');
    const image = sharp(buffer, { failOn: 'error' });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) throw new Error('The image dimensions could not be read.');

    const referenceId = nanoid(12);
    const extension = extensionForMime(upload.mimetype);
    const storedFilename = `${referenceId}${extension}`;
    const referenceDir = store.referencesDir(project.id);
    await mkdir(referenceDir, { recursive: true });
    await writeFile(resolve(referenceDir, storedFilename), buffer);

    const crop = parseCrop(fieldValue(upload.fields as Record<string, unknown>, 'crop'));
    let croppedFilename: string | undefined;
    if (crop) {
      const boundedCrop = {
        left: Math.min(crop.x, width - 1),
        top: Math.min(crop.y, height - 1),
        width: Math.min(crop.width, width - Math.min(crop.x, width - 1)),
        height: Math.min(crop.height, height - Math.min(crop.y, height - 1)),
      };
      croppedFilename = `${referenceId}-crop${extension}`;
      await sharp(buffer).extract(boundedCrop).toFile(resolve(referenceDir, croppedFilename));
    }

    const warnings: string[] = [];
    if (width < 512 || height < 512) warnings.push('Low resolution: details below 512 px may be unreliable.');
    if (Math.max(width / height, height / width) > 3) warnings.push('Extreme aspect ratio: confirm the object is not cropped.');
    const reference: ReferenceImage = {
      id: referenceId,
      role,
      originalFilename: upload.filename,
      storedFilename,
      croppedFilename,
      mimeType: upload.mimetype as ReferenceImage['mimeType'],
      bytes: buffer.byteLength,
      width,
      height,
      crop,
      warnings,
      createdAt: new Date().toISOString(),
    };
    const updated = await store.addReference(project.id, reference);
    return reply.code(201).send({ project: updated, reference });
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/captures/video', async (request, reply) => {
    await store.getProject(request.params.id);
    const upload = await request.file();
    if (!upload) throw new Error('Attach one MOV, MP4, or WebM video.');
    if (!videoMimeTypes.has(upload.mimetype)) throw new Error('Only MOV, MP4, and WebM videos are supported.');
    const providerValue = fieldValue(upload.fields as Record<string, unknown>, 'provider') ?? 'codex';
    if (!isProvider(providerValue)) throw new Error('Choose a valid capture-analysis provider.');
    const captureId = nanoid(12);
    const extension = upload.mimetype === 'video/quicktime' ? '.mov' : upload.mimetype === 'video/webm' ? '.webm' : '.mp4';
    const storedFilename = `source${extension}`;
    const captureDir = store.captureDir(request.params.id, captureId);
    await mkdir(captureDir, { recursive: true });
    let bytes = 0;
    upload.file.on('data', (chunk: Buffer) => { bytes += chunk.byteLength; });
    await pipeline(upload.file, createWriteStream(resolve(captureDir, storedFilename), { flags: 'wx' }));
    if (upload.file.truncated || bytes > MAX_VIDEO_BYTES) throw new Error('Object videos must be 500 MB or smaller.');
    const createdAt = new Date().toISOString();
    const capture: VideoCapture = {
      id: captureId,
      provider: providerValue,
      status: 'queued',
      originalFilename: upload.filename,
      storedFilename,
      mimeType: upload.mimetype as VideoCapture['mimeType'],
      bytes,
      frames: [],
      createdAt,
      updatedAt: createdAt,
    };
    await store.addCapture(request.params.id, capture);
    void captures.process(request.params.id, captureId);
    return reply.code(202).send({ capture });
  });

  app.get<{ Params: { id: string; captureId: string } }>('/api/projects/:id/captures/:captureId', async (request, reply) => {
    const project = await store.getProject(request.params.id);
    const capture = project.captures.find((item) => item.id === request.params.captureId);
    if (!capture) return reply.code(404).send({ error: 'Video capture not found.' });
    return { capture };
  });

  app.get<{ Params: { id: string; captureId: string; frameId: string } }>(
    '/api/projects/:id/captures/:captureId/frames/:frameId',
    async (request, reply) => {
      const project = await store.getProject(request.params.id);
      const capture = project.captures.find((item) => item.id === request.params.captureId);
      if (!capture) return reply.code(404).send({ error: 'Video capture not found.' });
      try {
        return reply.type('image/jpeg').send(captureFrameStream(store, project.id, capture, request.params.frameId));
      } catch {
        return reply.code(404).send({ error: 'Capture frame not found.' });
      }
    },
  );

  const acceptedTextSchema = z.object({
    id: z.string().optional(),
    value: z.string().trim().min(1).max(200),
    frameId: z.string().min(1),
    bounds: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    }).optional(),
    exportAllowed: z.boolean().default(true),
  });

  app.post<{
    Params: { id: string; captureId: string };
    Body: { frameIds?: string[]; texts?: Array<z.input<typeof acceptedTextSchema>> };
  }>('/api/projects/:id/captures/:captureId/accept', async (request, reply) => {
    const project = await store.getProject(request.params.id);
    const capture = project.captures.find((item) => item.id === request.params.captureId);
    if (!capture) return reply.code(404).send({ error: 'Video capture not found.' });
    if (capture.status !== 'needs_review') throw new Error('This video is not ready for review.');
    const requestedIds = z.array(z.string()).min(1).max(8).parse(request.body?.frameIds ?? capture.frames.filter((item) => item.selected).map((item) => item.id));
    const selected = requestedIds.map((id) => capture.frames.find((item) => item.id === id));
    if (selected.some((item) => !item)) throw new Error('One or more selected video frames no longer exist.');
    const frames = selected.filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!frames.some((item) => item.assignedRole === 'hero')) frames[0]!.assignedRole = 'hero';
    const references: ReferenceImage[] = [];
    await mkdir(store.referencesDir(project.id), { recursive: true });
    for (const frame of frames) {
      const id = nanoid(12);
      const storedFilename = `${id}.jpg`;
      const source = resolve(store.captureDir(project.id, capture.id), 'frames', frame.filename);
      const target = resolve(store.referencesDir(project.id), storedFilename);
      await sharp(source).jpeg({ quality: 94 }).toFile(target);
      references.push({
        id,
        role: frame.assignedRole ?? 'detail',
        originalFilename: `${capture.originalFilename} @ ${(frame.timestampMs / 1_000).toFixed(1)}s`,
        storedFilename,
        mimeType: 'image/jpeg',
        bytes: (await readFile(target)).byteLength,
        width: frame.width,
        height: frame.height,
        warnings: [],
        captureProvenance: { captureId: capture.id, frameId: frame.id, timestampMs: frame.timestampMs },
        createdAt: new Date().toISOString(),
      });
    }
    const textInputs = z.array(acceptedTextSchema).max(20).parse(request.body?.texts ?? []);
    const labelDir = resolve(store.captureDir(project.id, capture.id), 'labels');
    await mkdir(labelDir, { recursive: true });
    const surfaceTexts: SurfaceTextEvidence[] = [];
    for (const input of textInputs) {
      const frame = capture.frames.find((item) => item.id === input.frameId);
      if (!frame) throw new Error('Confirmed label text references an unknown video frame.');
      const id = input.id ?? nanoid(10);
      let assetFilename: string | undefined;
      if (input.exportAllowed && input.bounds) {
        const bounds = input.bounds as NormalizedRect;
        const left = Math.max(0, Math.floor(bounds.x * frame.width));
        const top = Math.max(0, Math.floor(bounds.y * frame.height));
        const width = Math.min(frame.width - left, Math.max(1, Math.floor(bounds.width * frame.width)));
        const height = Math.min(frame.height - top, Math.max(1, Math.floor(bounds.height * frame.height)));
        assetFilename = `label-${id}.png`;
        await sharp(resolve(store.captureDir(project.id, capture.id), 'frames', frame.filename))
          .extract({ left, top, width, height }).normalize().png().toFile(resolve(labelDir, assetFilename));
      }
      surfaceTexts.push({
        id,
        value: input.value,
        frameId: input.frameId,
        captureId: capture.id,
        bounds: input.bounds,
        renderingMethod: assetFilename ? 'hybrid-decal' : 'generated-text',
        exportAllowed: input.exportAllowed,
        assetFilename,
      });
    }
    const updated = await store.acceptCapture(project.id, capture.id, references, surfaceTexts);
    return reply.code(201).send({ project: updated });
  });

  app.delete<{ Params: { id: string; captureId: string } }>('/api/projects/:id/captures/:captureId', async (request) => {
    const project = await store.getProject(request.params.id);
    const capture = project.captures.find((item) => item.id === request.params.captureId);
    if (!capture) throw new Error('Video capture not found.');
    if (capture.status === 'processing' || capture.status === 'queued') await captures.cancel(project.id, capture.id);
    return { project: await store.removeCapture(project.id, capture.id) };
  });

  app.delete<{ Params: { id: string; referenceId: string } }>('/api/projects/:id/references/:referenceId', async (request) => ({
    project: await store.removeReference(request.params.id, request.params.referenceId),
  }));

  app.get<{ Params: { id: string; referenceId: string; variant: string } }>(
    '/api/projects/:id/references/:referenceId/:variant',
    async (request, reply) => {
      const project = await store.getProject(request.params.id);
      const reference = project.references.find((item) => item.id === request.params.referenceId);
      if (!reference) return reply.code(404).send({ error: 'Reference not found.' });
      const filename = request.params.variant === 'crop' && reference.croppedFilename
        ? reference.croppedFilename
        : reference.storedFilename;
      reply.type(reference.mimeType);
      return reply.send(createReadStream(resolve(store.referencesDir(project.id), filename)));
    },
  );

  app.post<{ Params: { id: string }; Body: StartRunInput }>('/api/projects/:id/runs', async (request, reply) => {
    const body = request.body ?? {} as StartRunInput;
    if (!isProvider(body.provider) || !isRunKind(body.kind)) throw new Error('Choose a valid provider and run type.');
    if (body.feedback && body.feedback.length > 1_000) throw new Error('Refinement feedback is limited to 1,000 characters.');
    const run = await runs.start(request.params.id, body);
    return reply.code(202).send({ run });
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const writeEvent = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = eventBus.subscribe(request.params.id, writeEvent);
    const keepAlive = setInterval(() => reply.raw.write(': keepalive\n\n'), 15_000);
    request.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (request) => {
    const projects = await store.listProjects();
    const project = projects.find((item) => item.runs.some((run) => run.id === request.params.id));
    if (!project) throw new Error('Run not found.');
    await runs.cancel(project.id, request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { runId?: string } }>('/api/projects/:id/activate-run', async (request) => {
    const runId = z.string().min(1).parse(request.body?.runId);
    return { project: await store.activateRun(request.params.id, runId) };
  });

  app.get<{ Params: { id: string; runId: string } }>('/api/projects/:id/runs/:runId/model.js', async (request, reply) => {
    const project = await store.getProject(request.params.id);
    const run = project.runs.find((item) => item.id === request.params.runId);
    if (!run || run.status !== 'succeeded') return reply.code(404).send({ error: 'Preview is not available.' });
    const modelPath = resolve(store.runDir(project.id, run.id), 'bundle/model.js');
    reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'no-store');
    return reply.send(createReadStream(modelPath));
  });

  app.get<{ Params: { id: string; runId: string; index: string } }>(
    '/api/projects/:id/runs/:runId/artifacts/:index',
    async (request, reply) => {
      const project = await store.getProject(request.params.id);
      const run = project.runs.find((item) => item.id === request.params.runId);
      const index = Number.parseInt(request.params.index, 10);
      const artifact = Number.isInteger(index) ? run?.artifacts[index] : undefined;
      if (!run || !artifact) return reply.code(404).send({ error: 'Run artifact not found.' });
      const runRoot = store.runDir(project.id, run.id);
      const artifactPath = resolve(runRoot, artifact.path);
      if (!artifactPath.startsWith(`${runRoot}/`) || !existsSync(artifactPath)) {
        return reply.code(404).send({ error: 'Run artifact file is unavailable.' });
      }
      const extension = extname(artifactPath).toLowerCase();
      const mime = extension === '.png'
        ? 'image/png'
        : extension === '.jpg' || extension === '.jpeg'
          ? 'image/jpeg'
        : extension === '.webp'
          ? 'image/webp'
          : extension === '.json' || extension === '.jsonl'
            ? 'application/json'
            : 'application/octet-stream';
      return reply.type(mime).send(createReadStream(artifactPath));
    },
  );

  app.get<{ Params: { id: string } }>('/api/projects/:id/export', async (request, reply) => {
    const project = await store.getProject(request.params.id);
    const run = project.runs.find((item) => item.id === project.activeRunId);
    if (!run) throw new Error('Generate and activate a successful model before exporting.');
    const zipPath = await buildProjectExport(store, project, run);
    reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${project.slug}-threejs.zip"`);
    return reply.send(createReadStream(zipPath));
  });

  if (existsSync(WEB_DIST_DIR)) {
    await app.register(fastifyStatic, { root: WEB_DIST_DIR, wildcard: false });
  }

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = message.includes('not found') ? 404 : 400;
    reply.code(statusCode).send({ error: message });
  });

  return app;
}
