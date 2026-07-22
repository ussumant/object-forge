export const PROVIDERS = ['codex', 'claude'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const REFERENCE_ROLES = ['hero', 'front', 'back', 'left', 'right', 'top', 'detail'] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

export const RUN_KINDS = ['draft', 'finish', 'refine'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_STATUSES = ['queued', 'running', 'needs_input', 'succeeded', 'failed', 'canceled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_PHASES = [
  'intake',
  'spec',
  'blockout',
  'structure',
  'form',
  'materials',
  'surface',
  'lighting',
  'interaction',
  'optimization',
  'export',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ReferenceImage = {
  id: string;
  role: ReferenceRole;
  originalFilename: string;
  storedFilename: string;
  croppedFilename?: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  crop?: CropRect;
  warnings: string[];
  createdAt: string;
};

export type SuitabilityReport = {
  verdict: 'pass' | 'conditional' | 'reject' | 'pending';
  summary: string;
  warnings: string[];
  requestedViews: ReferenceRole[];
  acceptedApproximation: boolean;
};

export type RunArtifact = {
  kind: 'spec' | 'model' | 'preview' | 'comparison' | 'log' | 'export';
  path: string;
  createdAt: string;
};

export type GenerationRun = {
  id: string;
  projectId: string;
  provider: Provider;
  kind: RunKind;
  status: RunStatus;
  phase: RunPhase;
  sourceRunId?: string;
  providerSessionId?: string;
  feedback?: string;
  acceptApproximation?: boolean;
  artifacts: RunArtifact[];
  messages: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type CreatorProject = {
  id: string;
  name: string;
  slug: string;
  references: ReferenceImage[];
  suitability: SuitabilityReport;
  runs: GenerationRun[];
  activeRunId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderHealth = {
  provider: Provider;
  available: boolean;
  authenticated: boolean;
  version?: string;
  message: string;
};

export type GeneratorEvent =
  | { type: 'phase_started'; runId: string; phase: RunPhase; message?: string; at: string }
  | { type: 'log'; runId: string; message: string; at: string }
  | { type: 'artifact_ready'; runId: string; artifact: RunArtifact; at: string }
  | { type: 'preview_ready'; runId: string; modelUrl: string; at: string }
  | { type: 'input_requested'; runId: string; message: string; requestedViews?: ReferenceRole[]; at: string }
  | { type: 'completed'; runId: string; at: string }
  | { type: 'failed'; runId: string; message: string; at: string };

export type StartRunInput = {
  provider: Provider;
  kind: RunKind;
  sourceRunId?: string;
  feedback?: string;
  acceptApproximation?: boolean;
};

export type RunContext = {
  project: CreatorProject;
  run: GenerationRun;
  workDir: string;
  referencePaths: Array<{ role: ReferenceRole; path: string }>;
  prompt: string;
};

export interface GeneratorAdapter {
  start(context: RunContext): AsyncIterable<GeneratorEvent>;
  resume(sessionId: string, context: RunContext): AsyncIterable<GeneratorEvent>;
  cancel(runId: string): Promise<void>;
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && PROVIDERS.includes(value as Provider);
}

export function isReferenceRole(value: unknown): value is ReferenceRole {
  return typeof value === 'string' && REFERENCE_ROLES.includes(value as ReferenceRole);
}

export function isRunKind(value: unknown): value is RunKind {
  return typeof value === 'string' && RUN_KINDS.includes(value as RunKind);
}
