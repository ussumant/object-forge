import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
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
  type CropRect,
  type ReferenceImage,
  type StartRunInput,
} from '@img3d/shared';
import { RunEventBus } from './events.js';
import { buildProjectExport } from './exporter.js';
import { WEB_DIST_DIR } from './paths.js';
import { providerHealth } from './providers.js';
import { RunManager } from './runner.js';
import { ProjectStore } from './store.js';

const uploadMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
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

export async function createApp(options: { store?: ProjectStore } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const store = options.store ?? new ProjectStore();
  await store.init();
  const eventBus = new RunEventBus();
  const runs = new RunManager(store, eventBus);

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 8, parts: 10 },
  });

  app.get('/api/health', async () => ({ ok: true, fakeProvider: process.env.IMG3D_FAKE_PROVIDER === '1' }));

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
