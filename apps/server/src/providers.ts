import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  GeneratorAdapter,
  GeneratorEvent,
  Provider,
  ProviderHealth,
  RunContext,
  RunPhase,
} from '@img3d/shared';
import { ROOT_DIR } from './paths.js';

const IDLE_TIMEOUT_MS = 10 * 60 * 1_000;

function now(): string {
  return new Date().toISOString();
}

export function stringifyEventPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'message', 'result', 'output_text']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  if (Array.isArray(record.content)) {
    return record.content.map(stringifyEventPayload).filter(Boolean).join(' ');
  }
  if (record.message) return stringifyEventPayload(record.message);
  if (record.item) return stringifyEventPayload(record.item);
  if (record.type === 'tool_use' && ['Write', 'Edit'].includes(String(record.name))) {
    return 'Workspace artifacts are changing.';
  }
  return '';
}

export function findSessionId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['thread_id', 'session_id', 'sessionId']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  for (const child of Object.values(record)) {
    const result = findSessionId(child);
    if (result) return result;
  }
  return undefined;
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolveNext) => this.waiters.push(resolveNext));
      },
    };
  }
}

export class CliGeneratorAdapter implements GeneratorAdapter {
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly provider: Provider) {}

  start(context: RunContext): AsyncIterable<GeneratorEvent> {
    return this.run(context);
  }

  resume(sessionId: string, context: RunContext): AsyncIterable<GeneratorEvent> {
    return this.run(context, sessionId);
  }

  async cancel(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (child && !child.killed) child.kill('SIGTERM');
  }

  private run(context: RunContext, sessionId?: string): AsyncIterable<GeneratorEvent> {
    const queue = new AsyncQueue<GeneratorEvent>();
    const { command, args } = buildProviderCommand(this.provider, context, sessionId);
    const rawLog = resolve(context.workDir, 'provider.jsonl');

    void (async () => {
      await mkdir(context.workDir, { recursive: true });
      const processCwd = this.provider === 'claude'
        ? resolve(context.workDir, '../../../provider-sessions/claude')
        : context.workDir;
      await mkdir(processCwd, { recursive: true });
      const child = spawn(command, args, {
        cwd: processCwd,
        env: { ...process.env, NO_COLOR: '1', IMG3D_ROOT_DIR: ROOT_DIR },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.processes.set(context.run.id, child);
      queue.push({
        type: 'phase_started',
        runId: context.run.id,
        phase: context.run.phase,
        message: `${this.provider === 'codex' ? 'Codex' : 'Claude'} started in an isolated run workspace.`,
        at: now(),
      });

      let idleTimer: NodeJS.Timeout | undefined;
      let timedOut = false;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();

      const consume = (line: string, isError = false) => {
        resetIdleTimer();
        void appendFile(rawLog, `${line}\n`, 'utf8');
        let message = line;
        try {
          const payload = JSON.parse(line) as unknown;
          const foundSessionId = findSessionId(payload);
          if (foundSessionId) context.run.providerSessionId = foundSessionId;
          const record = payload as { item?: { type?: string } };
          message = stringifyEventPayload(payload)
            || (record.item?.type === 'file_change' ? 'Workspace artifacts changed.' : '');
        } catch {
          // The CLIs occasionally write plain diagnostics; preserve them as readable logs.
        }
        if (message.trim()) {
          queue.push({
            type: 'log',
            runId: context.run.id,
            message: `${isError ? 'stderr: ' : ''}${message.trim().slice(0, 1_000)}`,
            at: now(),
          });
        }
      };

      createInterface({ input: child.stdout }).on('line', (line) => consume(line));
      createInterface({ input: child.stderr }).on('line', (line) => consume(line, true));
      child.stdin.end(context.prompt);

      child.once('error', (error) => {
        if (idleTimer) clearTimeout(idleTimer);
        queue.push({ type: 'failed', runId: context.run.id, message: error.message, at: now() });
        this.processes.delete(context.run.id);
        queue.end();
      });
      child.once('close', (code, signal) => {
        if (idleTimer) clearTimeout(idleTimer);
        this.processes.delete(context.run.id);
        if (code !== 0) {
          const detail = timedOut
            ? 'Provider produced no output for ten minutes and was stopped.'
            : `Provider exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;
          queue.push({ type: 'failed', runId: context.run.id, message: detail, at: now() });
        }
        queue.end();
      });
    })().catch((error: unknown) => {
      queue.push({
        type: 'failed',
        runId: context.run.id,
        message: error instanceof Error ? error.message : String(error),
        at: now(),
      });
      queue.end();
    });

    return queue;
  }

}

export function buildProviderCommand(
  provider: Provider,
  context: RunContext,
  sessionId?: string,
): { command: string; args: string[] } {
  if (provider === 'codex') {
    const imageArgs = context.referencePaths.flatMap((reference) => ['-i', reference.path]);
    if (sessionId) {
      return { command: 'codex', args: ['exec', 'resume', '--json', ...imageArgs, sessionId, '-'] };
    }
    return {
      command: 'codex',
      args: [
        'exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check',
        '-C', context.workDir, ...imageArgs, '-',
      ],
    };
  }

  const args = [
    '-p',
    '--verbose',
    '--add-dir',
    context.workDir,
    '--output-format',
    'stream-json',
    '--permission-mode',
    'acceptEdits',
    '--setting-sources',
    'project',
  ];
  if (sessionId) args.push('--resume', sessionId);
  args.push(
    '--allowedTools',
    [
      'Read',
      'Write',
      'Edit',
      'Bash(python3 .pipeline/forge/*)',
      'Bash(npm run *)',
      'Bash(node scripts/*)',
      'Bash(cd * && python3 .pipeline/forge/*)',
      'Bash(cd * && npm run *)',
      'Bash(cd * && node .img3d/capture-preview.mjs *)',
      'Bash(*playwright_cli.sh *)',
    ].join(','),
  );
  return { command: 'claude', args };
}

function modelSource(name: string, finished: boolean, feedback?: string, surfaceTexts: string[] = []): string {
  const note = feedback ? `Applied refinement: ${feedback.replace(/[`$]/g, '').slice(0, 160)}` : 'Generated local preview';
  return `import * as THREE from 'three';

export type ModelOptions = { wireframe?: boolean; castShadow?: boolean };

export function create${name}Model(options: ModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = '${name}';
  const nodes: Record<string, THREE.Object3D> = {};
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xcfd2c8,
    roughness: ${finished ? '0.24' : '0.52'},
    metalness: ${finished ? '0.38' : '0.08'},
    clearcoat: ${finished ? '0.62' : '0.12'},
    clearcoatRoughness: 0.18,
    wireframe: options.wireframe ?? false,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171917, roughness: 0.44, metalness: 0.5, wireframe: options.wireframe ?? false });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff5a2a, roughness: 0.32, metalness: 0.24, wireframe: options.wireframe ?? false });
  const labels: Record<string, THREE.Object3D> = {};

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.9, 1.25, 6, 4, 4), material);
  body.geometry.translate(0, 0.08, 0);
  body.name = 'body-shell';
  body.castShadow = options.castShadow ?? true;
  root.add(body);
  nodes.body = body;
  meshes.body = body;

  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.35, 64), dark);
  face.rotation.x = Math.PI / 2;
  face.position.set(0.42, 0.17, 0.72);
  face.name = 'primary-dial';
  root.add(face);
  nodes.dial = face;
  meshes.dial = face;

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.54, 0.38, 64), material);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0.42, 0.17, 1.02);
  lens.name = 'front-lens';
  root.add(lens);
  nodes.lens = lens;
  meshes.lens = lens;

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.55, 0.46, 4, 6, 4), dark);
  grip.position.set(-1.44, -0.02, 0.36);
  grip.rotation.z = -0.05;
  grip.name = 'grip';
  root.add(grip);
  nodes.grip = grip;
  meshes.grip = grip;

  const shutter = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 24), accent);
  shutter.position.set(-0.86, 1.08, 0.28);
  shutter.name = 'shutter-button';
  root.add(shutter);
  nodes.shutter = shutter;
  meshes.shutter = shutter;

  const screenSocket = new THREE.Object3D();
  screenSocket.name = 'rear-screen-socket';
  screenSocket.position.set(0.42, 0.12, -0.66);
  root.add(screenSocket);
  sockets.screen = screenSocket;

  const confirmedLabelTexts = ${JSON.stringify(surfaceTexts)};
  if (confirmedLabelTexts.length > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#1674ba';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '700 76px Arial, sans-serif';
      context.fillText(confirmedLabelTexts.join(' · '), canvas.width / 2, canvas.height / 2, 940);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: false });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.62), labelMaterial);
    label.position.set(0.2, -0.48, 0.762);
    label.name = 'confirmed-label-decal';
    root.add(label);
    nodes.label = label;
    meshes.label = label;
    labels.primary = label;
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, labels, colliders: {}, destructionGroups: {} };
  root.userData.note = ${JSON.stringify(note)};
  return root;
}
`;
}

export class FakeGeneratorAdapter implements GeneratorAdapter {
  constructor(private readonly provider: Provider) {}

  start(context: RunContext): AsyncIterable<GeneratorEvent> {
    return this.generate(context);
  }

  resume(_sessionId: string, context: RunContext): AsyncIterable<GeneratorEvent> {
    return this.generate(context);
  }

  async cancel(): Promise<void> {}

  private async *generate(context: RunContext): AsyncIterable<GeneratorEvent> {
    context.run.providerSessionId ??= `fake-${this.provider}-${context.run.id}`;
    const phases: RunPhase[] = context.run.kind === 'draft'
      ? ['intake', 'spec', 'blockout', 'structure', 'form']
      : context.run.kind === 'finish'
        ? ['materials', 'surface', 'lighting', 'interaction', 'optimization']
        : ['form', 'materials', 'lighting'];
    for (const phase of phases) {
      yield { type: 'phase_started', runId: context.run.id, phase, message: `Simulating ${phase}`, at: now() };
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 35));
    }
    const safeName = context.project.slug.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join('') || 'Object';
    await mkdir(resolve(context.workDir, 'src'), { recursive: true });
    await writeFile(
      resolve(context.workDir, 'src/createModel.ts'),
      modelSource(
        safeName,
        context.run.kind !== 'draft',
        context.run.feedback,
        context.run.kind === 'draft' ? [] : context.project.surfaceTexts.map((item) => item.value),
      ),
      'utf8',
    );
    if (context.run.kind !== 'draft' && context.project.surfaceTexts.length) {
      await writeFile(resolve(context.workDir, 'label-evidence.json'), `${JSON.stringify({
        version: '1.0',
        confirmedTexts: context.project.surfaceTexts,
        renderings: context.project.surfaceTexts.map((item) => ({
          evidenceId: item.id,
          text: item.value,
          nodeName: 'confirmed-label-decal',
          method: 'canvas-texture',
        })),
      }, null, 2)}\n`, 'utf8');
    }
    await writeFile(resolve(context.workDir, 'object-sculpt-spec.json'), `${JSON.stringify({
      version: '1.0',
      targetName: context.project.name,
      sourceImage: context.referencePaths.find((item) => item.role === 'hero')?.path,
      provider: this.provider,
      stage: context.run.kind,
      suitability: { verdict: 'pass', summary: 'Fake adapter fixture passed.' },
      runtimeContract: { namedNodes: true, sockets: ['screen'] },
    }, null, 2)}\n`, 'utf8');
    const hero = context.referencePaths.find((item) => item.role === 'hero');
    if (hero) {
      const reviewDir = resolve(context.workDir, 'output/playwright');
      await mkdir(reviewDir, { recursive: true });
      const { copyFile } = await import('node:fs/promises');
      await copyFile(hero.path, resolve(reviewDir, 'deterministic-review.png'));
    }
    yield { type: 'log', runId: context.run.id, message: 'Model factory and sculpt spec written.', at: now() };
  }
}

async function runHealthCommand(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolveHealth) => {
    const child = spawn(command, args, { env: { ...process.env, NO_COLOR: '1' } });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 8_000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveHealth({ ok: false, output: error.message });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolveHealth({ ok: code === 0, output: output.trim() });
    });
  });
}

export async function providerHealth(provider: Provider): Promise<ProviderHealth> {
  if (process.env.IMG3D_FAKE_PROVIDER === '1') {
    return { provider, available: true, authenticated: true, version: 'fake', message: 'Deterministic test adapter enabled.' };
  }
  const command = provider === 'codex' ? 'codex' : 'claude';
  const version = await runHealthCommand(command, ['--version']);
  if (!version.ok) return { provider, available: false, authenticated: false, message: version.output || `${command} is not on PATH.` };
  const auth = await runHealthCommand(command, provider === 'codex' ? ['login', 'status'] : ['auth', 'status']);
  return {
    provider,
    available: true,
    authenticated: auth.ok,
    version: version.output.split('\n').at(-1),
    message: auth.ok ? 'Ready for local generation.' : auth.output || 'Authentication check failed.',
  };
}

export function createAdapter(provider: Provider): GeneratorAdapter {
  return process.env.IMG3D_FAKE_PROVIDER === '1'
    ? new FakeGeneratorAdapter(provider)
    : new CliGeneratorAdapter(provider);
}
