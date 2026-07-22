import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CreatorProject,
  GenerationRun,
  GeneratorAdapter,
  GeneratorEvent,
  ReferenceRole,
  RunArtifact,
  RunKind,
  RunPhase,
  StartRunInput,
} from '@img3d/shared';
import { VENDOR_PIPELINE_DIR, WORKSPACE_CAPTURE_SCRIPT } from './paths.js';
import { RunEventBus } from './events.js';
import { createAdapter } from './providers.js';
import { buildGenerationPrompt } from './prompt.js';
import { validateAndBundleModel } from './security.js';
import { ProjectStore } from './store.js';

function now(): string {
  return new Date().toISOString();
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

type RunResultFile = {
  status?: 'succeeded' | 'needs_input';
  summary?: string;
  requestedViews?: ReferenceRole[];
};

const phaseOrder: RunPhase[] = [
  'intake', 'spec', 'blockout', 'structure', 'form', 'materials', 'surface', 'lighting', 'interaction', 'optimization', 'export',
];

const pipelinePhase: Record<string, RunPhase> = {
  blockout: 'blockout',
  'structural-pass': 'structure',
  'form-refinement': 'form',
  'material-pass': 'materials',
  'surface-pass': 'surface',
  'lighting-pass': 'lighting',
  'interaction-pass': 'interaction',
  'optimization-pass': 'optimization',
};

async function deriveArtifactPhase(workDir: string, kind: RunKind): Promise<RunPhase> {
  let phase: RunPhase = 'intake';
  if (await exists(resolve(workDir, 'assessment.json'))) phase = 'spec';
  const specPath = resolve(workDir, 'object-sculpt-spec.json');
  if (await exists(specPath)) {
    phase = 'spec';
    try {
      const spec = JSON.parse(await readFile(specPath, 'utf8')) as { sculptPipeline?: { currentPass?: string } };
      const currentPass = spec.sculptPipeline?.currentPass;
      if (currentPass && pipelinePhase[currentPass]) phase = pipelinePhase[currentPass];
    } catch {
      // A provider may be between edits. The next provider event will retry.
    }
  }
  if (phase === 'spec' && await exists(resolve(workDir, 'src/createModel.ts'))) {
    phase = kind === 'finish' ? 'materials' : 'form';
  }
  return phase;
}

async function collectReviewArtifacts(workDir: string): Promise<RunArtifact[]> {
  const reviewDir = resolve(workDir, 'output/playwright');
  if (!(await exists(reviewDir))) return [];
  const filenames = await readdir(reviewDir, { recursive: true });
  return filenames
    .filter((filename) => /\.(png|jpe?g|webp)$/i.test(filename))
    .sort()
    .map((filename) => ({
      kind: 'comparison' as const,
      path: `workspace/output/playwright/${filename}`,
      createdAt: now(),
    }));
}

export class RunManager {
  private readonly activeAdapters = new Map<string, GeneratorAdapter>();
  private readonly canceled = new Set<string>();

  constructor(
    private readonly store: ProjectStore,
    readonly events: RunEventBus,
  ) {}

  async start(projectId: string, input: StartRunInput): Promise<GenerationRun> {
    const project = await this.store.getProject(projectId);
    const hero = project.references.find((reference) => reference.role === 'hero');
    if (!hero) throw new Error('Add a hero image before starting generation.');

    const sourceRunId = input.sourceRunId ?? project.activeRunId;
    if (input.kind !== 'draft' && !sourceRunId) {
      throw new Error('Finish and refine runs require an active successful draft.');
    }
    const sourceRun = sourceRunId ? project.runs.find((run) => run.id === sourceRunId) : undefined;
    if (sourceRunId && (!sourceRun || sourceRun.status !== 'succeeded')) {
      throw new Error('The selected source run is not available or successful.');
    }

    const extraGeometryViews = project.references.filter((reference) => !['hero', 'detail'].includes(reference.role));
    const acceptedBySuccessfulSingleViewDraft = sourceRun?.kind === 'draft'
      && sourceRun.status === 'succeeded'
      && extraGeometryViews.length === 0;
    const acceptApproximation = Boolean(
      input.acceptApproximation
      || project.suitability.acceptedApproximation
      || sourceRun?.acceptApproximation
      || acceptedBySuccessfulSingleViewDraft,
    );
    if (acceptApproximation && !project.suitability.acceptedApproximation) {
      project.suitability.acceptedApproximation = true;
      await this.store.saveProject(project);
    }

    const run = await this.store.createRun(
      projectId,
      input.provider,
      input.kind,
      sourceRunId,
      input.feedback,
      acceptApproximation,
      Boolean(input.autoFinish),
    );
    if (sourceRun?.provider === input.provider && sourceRun.providerSessionId) {
      await this.store.updateRun(projectId, run.id, { providerSessionId: sourceRun.providerSessionId });
    }
    if (input.kind === 'draft' && extraGeometryViews.length === 0 && !acceptApproximation) {
      await this.store.updateRun(projectId, run.id, {
        status: 'needs_input',
        error: 'Add a side or back view, or explicitly accept inferred hidden geometry.',
        completedAt: now(),
      });
      this.events.publish({
        type: 'input_requested',
        runId: run.id,
        message: 'A single hero image leaves hidden geometry unknown.',
        requestedViews: ['left', 'back'],
        at: now(),
      });
      return this.store.getProject(projectId).then((fresh) => fresh.runs.find((item) => item.id === run.id)!);
    }

    await this.store.updateRun(projectId, run.id, { status: 'running', startedAt: now() });
    void this.execute(project, run, acceptApproximation);
    return this.store.getProject(projectId).then((fresh) => fresh.runs.find((item) => item.id === run.id)!);
  }

  async cancel(projectId: string, runId: string): Promise<void> {
    this.canceled.add(runId);
    await this.activeAdapters.get(runId)?.cancel(runId);
    await this.store.setRunStatus(projectId, runId, 'canceled');
    this.events.publish({ type: 'failed', runId, message: 'Run canceled.', at: now() });
  }

  private async execute(projectSnapshot: CreatorProject, runSnapshot: GenerationRun, acceptApproximation: boolean): Promise<void> {
    const projectId = projectSnapshot.id;
    const runId = runSnapshot.id;
    const runDir = this.store.runDir(projectId, runId);
    const workDir = resolve(runDir, 'workspace');
    try {
      await this.prepareWorkspace(projectSnapshot, runSnapshot, workDir);
      const freshProject = await this.store.getProject(projectId);
      const freshRun = freshProject.runs.find((item) => item.id === runId)!;
      const referencePaths = freshProject.references.map((reference) => ({
        role: reference.role,
        path: resolve(workDir, 'references', reference.croppedFilename ?? reference.storedFilename),
      }));
      const contextWithoutPrompt = { project: freshProject, run: freshRun, workDir, referencePaths };
      const prompt = buildGenerationPrompt(contextWithoutPrompt, acceptApproximation);
      await writeFile(resolve(workDir, 'TASK.md'), prompt, 'utf8');
      const context = { ...contextWithoutPrompt, prompt };
      const adapter = createAdapter(runSnapshot.provider);
      this.activeAdapters.set(runId, adapter);

      let providerFailure: string | undefined;
      let lastObservedPhase = freshRun.phase;
      const stream = freshRun.providerSessionId
        ? adapter.resume(freshRun.providerSessionId, context)
        : adapter.start(context);
      for await (const event of stream) {
        if (this.canceled.has(runId)) return;
        this.events.publish(event);
        await this.consumeEvent(projectId, event);
        if (event.type === 'phase_started') lastObservedPhase = event.phase;
        if (event.type === 'log') {
          const derivedPhase = await deriveArtifactPhase(workDir, runSnapshot.kind);
          if (phaseOrder.indexOf(derivedPhase) > phaseOrder.indexOf(lastObservedPhase)) {
            lastObservedPhase = derivedPhase;
            await this.store.updateRun(projectId, runId, { phase: derivedPhase });
            this.events.publish({
              type: 'phase_started',
              runId,
              phase: derivedPhase,
              message: `Validated workspace artifacts reached ${derivedPhase}.`,
              at: now(),
            });
          }
        }
        if (event.type === 'failed') providerFailure = event.message;
      }
      if (providerFailure) throw new Error(providerFailure);
      if (this.canceled.has(runId)) return;

      if (context.run.providerSessionId) {
        await this.store.updateRun(projectId, runId, { providerSessionId: context.run.providerSessionId });
      }

      const resultPath = resolve(workDir, 'run-result.json');
      if (await exists(resultPath)) {
        const result = JSON.parse(await readFile(resultPath, 'utf8')) as RunResultFile;
        if (result.status === 'needs_input') {
          const message = result.summary ?? 'The generator needs more evidence before it can continue.';
          await this.store.setRunStatus(projectId, runId, 'needs_input', message);
          this.events.publish({
            type: 'input_requested',
            runId,
            message,
            requestedViews: result.requestedViews,
            at: now(),
          });
          return;
        }
      }

      const modelPath = resolve(workDir, 'src/createModel.ts');
      if (!(await exists(modelPath))) throw new Error('The provider completed without writing src/createModel.ts.');
      const bundleDir = resolve(runDir, 'bundle');
      await mkdir(bundleDir, { recursive: true });
      const bundlePath = resolve(bundleDir, 'model.js');
      await validateAndBundleModel(modelPath, bundlePath);

      const artifacts: RunArtifact[] = [
        { kind: 'model', path: 'workspace/src/createModel.ts', createdAt: now() },
        { kind: 'preview', path: 'bundle/model.js', createdAt: now() },
      ];
      if (await exists(resolve(workDir, 'object-sculpt-spec.json'))) {
        artifacts.push({ kind: 'spec', path: 'workspace/object-sculpt-spec.json', createdAt: now() });
      }
      if (await exists(resolve(workDir, 'provider.jsonl'))) {
        artifacts.push({ kind: 'log', path: 'workspace/provider.jsonl', createdAt: now() });
      }
      artifacts.push(...await collectReviewArtifacts(workDir));
      await this.store.updateRun(projectId, runId, {
        status: 'succeeded',
        phase: runSnapshot.kind === 'draft' ? 'form' : 'optimization',
        artifacts,
        completedAt: now(),
      });
      await this.store.activateRun(projectId, runId);
      for (const artifact of artifacts) {
        this.events.publish({ type: 'artifact_ready', runId, artifact, at: now() });
      }
      this.events.publish({
        type: 'preview_ready',
        runId,
        modelUrl: `/api/projects/${projectId}/runs/${runId}/model.js`,
        at: now(),
      });
      this.events.publish({ type: 'completed', runId, at: now() });
    } catch (error) {
      if (this.canceled.has(runId)) return;
      const message = error instanceof Error ? error.message : String(error);
      await this.store.setRunStatus(projectId, runId, 'failed', message).catch(() => undefined);
      this.events.publish({ type: 'failed', runId, message, at: now() });
    } finally {
      this.activeAdapters.delete(runId);
      this.canceled.delete(runId);
    }
  }

  private async consumeEvent(projectId: string, event: GeneratorEvent): Promise<void> {
    if (event.type === 'phase_started') {
      await this.store.updateRun(projectId, event.runId, { phase: event.phase });
      if (event.message) await this.store.appendRunMessage(projectId, event.runId, event.message);
    } else if (event.type === 'log') {
      await this.store.appendRunMessage(projectId, event.runId, event.message);
    }
  }

  private async prepareWorkspace(project: CreatorProject, run: GenerationRun, workDir: string): Promise<void> {
    await mkdir(workDir, { recursive: true });
    await cp(VENDOR_PIPELINE_DIR, resolve(workDir, '.pipeline'), {
      recursive: true,
      filter: (source) => !source.includes('/assets/'),
    });
    await mkdir(resolve(workDir, '.img3d'), { recursive: true });
    await cp(WORKSPACE_CAPTURE_SCRIPT, resolve(workDir, '.img3d/capture-preview.mjs'));
    const referenceDir = resolve(workDir, 'references');
    await mkdir(referenceDir, { recursive: true });
    for (const reference of project.references) {
      const sourceDir = this.store.referencesDir(project.id);
      await cp(resolve(sourceDir, reference.storedFilename), resolve(referenceDir, reference.storedFilename));
      if (reference.croppedFilename) {
        await cp(resolve(sourceDir, reference.croppedFilename), resolve(referenceDir, reference.croppedFilename));
      }
    }

    if (run.sourceRunId) {
      const sourceWorkspace = resolve(this.store.runDir(project.id, run.sourceRunId), 'workspace');
      for (const name of [
        'src',
        'assets',
        'tests',
        'output',
        'object-sculpt-spec.json',
        'package.json',
        'tsconfig.json',
        'index.html',
      ]) {
        const sourcePath = resolve(sourceWorkspace, name);
        if (await exists(sourcePath)) await cp(sourcePath, resolve(workDir, name), { recursive: true });
      }
    }

    await writeFile(resolve(workDir, 'capture-manifest.json'), `${JSON.stringify({
      projectId: project.id,
      targetName: project.name,
      sourceImage: project.references.find((item) => item.role === 'hero')?.croppedFilename
        ?? project.references.find((item) => item.role === 'hero')?.storedFilename,
      references: project.references.map((item) => ({
        id: item.id,
        role: item.role,
        path: `references/${item.croppedFilename ?? item.storedFilename}`,
        originalPath: `references/${item.storedFilename}`,
        crop: item.crop,
        width: item.width,
        height: item.height,
      })),
    }, null, 2)}\n`, 'utf8');
  }
}
