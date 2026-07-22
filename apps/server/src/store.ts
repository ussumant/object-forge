import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type {
  CreatorProject,
  GenerationRun,
  Provider,
  ReferenceImage,
  RunKind,
  RunPhase,
  RunStatus,
} from '@img3d/shared';
import { PROJECTS_DIR } from './paths.js';

const PROJECT_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeId(value: string, label: string): void {
  if (!PROJECT_ID.test(value)) throw new Error(`Invalid ${label}`);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'untitled-object';
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${nanoid(6)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export class ProjectStore {
  readonly projectsDir: string;

  constructor(projectsDir = PROJECTS_DIR) {
    this.projectsDir = projectsDir;
  }

  async init(): Promise<void> {
    await mkdir(this.projectsDir, { recursive: true });
    const projects = await this.listProjects();
    await Promise.all(projects.map(async (project) => {
      let changed = false;
      for (const run of project.runs) {
        if (run.status === 'queued' || run.status === 'running') {
          run.status = 'failed';
          run.error = 'The local service restarted while this run was active. Start a new run to continue.';
          run.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      if (changed) await this.saveProject(project);
    }));
  }

  projectDir(projectId: string): string {
    assertSafeId(projectId, 'project id');
    return resolve(this.projectsDir, projectId);
  }

  referencesDir(projectId: string): string {
    return resolve(this.projectDir(projectId), 'references');
  }

  runDir(projectId: string, runId: string): string {
    assertSafeId(runId, 'run id');
    return resolve(this.projectDir(projectId), 'runs', runId);
  }

  private manifestPath(projectId: string): string {
    return resolve(this.projectDir(projectId), 'manifest.json');
  }

  async createProject(name: string): Promise<CreatorProject> {
    const now = new Date().toISOString();
    const project: CreatorProject = {
      id: nanoid(12),
      name: name.trim().slice(0, 100) || 'Untitled object',
      slug: slugify(name),
      references: [],
      suitability: {
        verdict: 'pending',
        summary: 'Add a hero image to begin the suitability check.',
        warnings: [],
        requestedViews: [],
        acceptedApproximation: false,
      },
      runs: [],
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(this.referencesDir(project.id), { recursive: true });
    await mkdir(resolve(this.projectDir(project.id), 'runs'), { recursive: true });
    await this.saveProject(project);
    return project;
  }

  async listProjects(): Promise<CreatorProject[]> {
    await mkdir(this.projectsDir, { recursive: true });
    const entries = await readdir(this.projectsDir, { withFileTypes: true });
    const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        return await this.getProject(entry.name);
      } catch {
        return null;
      }
    }));
    return projects
      .filter((project): project is CreatorProject => project !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(projectId: string): Promise<CreatorProject> {
    const raw = await readFile(this.manifestPath(projectId), 'utf8');
    return JSON.parse(raw) as CreatorProject;
  }

  async saveProject(project: CreatorProject): Promise<void> {
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.manifestPath(project.id), project);
  }

  async addReference(projectId: string, reference: ReferenceImage): Promise<CreatorProject> {
    const project = await this.getProject(projectId);
    if (project.references.length >= 8) throw new Error('A project can contain at most eight reference images.');
    if (reference.role === 'hero' && project.references.some((item) => item.role === 'hero')) {
      throw new Error('This project already has a hero image. Remove it before uploading another.');
    }
    project.references.push(reference);
    const hasHero = project.references.some((item) => item.role === 'hero');
    const hasExtraView = project.references.some((item) => item.role !== 'hero' && item.role !== 'detail');
    project.suitability = {
      verdict: hasHero ? (hasExtraView ? 'pass' : 'conditional') : 'pending',
      summary: hasHero
        ? hasExtraView
          ? 'The capture pack has a hero image and supporting geometry evidence.'
          : 'A single hero image can work, but hidden geometry will be inferred.'
        : 'A hero image is required before generation.',
      warnings: project.references.flatMap((item) => item.warnings),
      requestedViews: hasHero && !hasExtraView ? ['left', 'back'] : [],
      acceptedApproximation: project.suitability.acceptedApproximation,
    };
    await this.saveProject(project);
    return project;
  }

  async removeReference(projectId: string, referenceId: string): Promise<CreatorProject> {
    assertSafeId(referenceId, 'reference id');
    const project = await this.getProject(projectId);
    const reference = project.references.find((item) => item.id === referenceId);
    if (!reference) throw new Error('Reference not found.');
    project.references = project.references.filter((item) => item.id !== referenceId);
    for (const filename of [reference.storedFilename, reference.croppedFilename]) {
      if (!filename) continue;
      await unlink(resolve(this.referencesDir(projectId), filename)).catch(() => undefined);
    }
    const hasHero = project.references.some((item) => item.role === 'hero');
    const hasExtraView = project.references.some((item) => item.role !== 'hero' && item.role !== 'detail');
    project.suitability = {
      verdict: !hasHero ? 'pending' : hasExtraView ? 'pass' : 'conditional',
      summary: !hasHero
        ? 'A hero image is required before generation.'
        : hasExtraView
          ? 'The capture pack has a hero image and supporting geometry evidence.'
          : 'A single hero image can work, but hidden geometry will be inferred.',
      warnings: project.references.flatMap((item) => item.warnings),
      requestedViews: hasHero && !hasExtraView ? ['left', 'back'] : [],
      acceptedApproximation: false,
    };
    await this.saveProject(project);
    return project;
  }

  async createRun(
    projectId: string,
    provider: Provider,
    kind: RunKind,
    sourceRunId?: string,
    feedback?: string,
    acceptApproximation = false,
  ): Promise<GenerationRun> {
    const project = await this.getProject(projectId);
    const now = new Date().toISOString();
    const startingPhase: RunPhase = kind === 'finish' ? 'materials' : kind === 'refine' ? 'form' : 'intake';
    const run: GenerationRun = {
      id: nanoid(14),
      projectId,
      provider,
      kind,
      status: 'queued',
      phase: startingPhase,
      sourceRunId,
      feedback,
      acceptApproximation,
      artifacts: [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    project.runs.unshift(run);
    await mkdir(this.runDir(projectId, run.id), { recursive: true });
    await this.saveProject(project);
    return run;
  }

  async updateRun(projectId: string, runId: string, patch: Partial<GenerationRun>): Promise<GenerationRun> {
    const project = await this.getProject(projectId);
    const run = project.runs.find((item) => item.id === runId);
    if (!run) throw new Error('Run not found.');
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    await this.saveProject(project);
    return run;
  }

  async appendRunMessage(projectId: string, runId: string, message: string): Promise<void> {
    const project = await this.getProject(projectId);
    const run = project.runs.find((item) => item.id === runId);
    if (!run) return;
    run.messages = [...run.messages.slice(-59), message.slice(0, 1_000)];
    run.updatedAt = new Date().toISOString();
    await this.saveProject(project);
  }

  async setRunStatus(projectId: string, runId: string, status: RunStatus, error?: string): Promise<GenerationRun> {
    const completedAt = ['succeeded', 'failed', 'canceled', 'needs_input'].includes(status)
      ? new Date().toISOString()
      : undefined;
    return this.updateRun(projectId, runId, { status, error, completedAt });
  }

  async activateRun(projectId: string, runId: string): Promise<CreatorProject> {
    const project = await this.getProject(projectId);
    const run = project.runs.find((item) => item.id === runId);
    if (!run || run.status !== 'succeeded') throw new Error('Only a successful run can be activated.');
    project.activeRunId = runId;
    await this.saveProject(project);
    return project;
  }
}
