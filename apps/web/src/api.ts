import type {
  CreatorProject,
  GenerationRun,
  ProviderHealth,
  ReferenceRole,
  StartRunInput,
  VideoCapture,
} from '@img3d/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<{ projects: CreatorProject[] }>('/api/projects'),
  getProject: (id: string) => request<{ project: CreatorProject }>(`/api/projects/${id}`),
  createProject: (name: string) => request<{ project: CreatorProject }>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }),
  providerHealth: () => request<{ providers: ProviderHealth[] }>('/api/system/providers'),
  captureHealth: () => request<{ available: boolean; message: string }>('/api/system/capture'),
  uploadVideo: (projectId: string, file: File, provider: ProviderHealth['provider']) => {
    const data = new FormData();
    data.append('provider', provider);
    data.append('file', file);
    return request<{ capture: VideoCapture }>(`/api/projects/${projectId}/captures/video`, { method: 'POST', body: data });
  },
  getCapture: (projectId: string, captureId: string) => request<{ capture: VideoCapture }>(`/api/projects/${projectId}/captures/${captureId}`),
  acceptCapture: (
    projectId: string,
    captureId: string,
    input: { frameIds: string[]; texts: Array<{ id?: string; value: string; frameId: string; bounds?: { x: number; y: number; width: number; height: number }; exportAllowed: boolean }> },
  ) => request<{ project: CreatorProject }>(`/api/projects/${projectId}/captures/${captureId}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  deleteCapture: (projectId: string, captureId: string) => request<{ project: CreatorProject }>(`/api/projects/${projectId}/captures/${captureId}`, { method: 'DELETE' }),
  uploadReference: (
    projectId: string,
    file: File,
    role: ReferenceRole,
    crop?: { x: number; y: number; width: number; height: number },
    replaceEvidence = false,
  ) => {
    const data = new FormData();
    data.append('role', role);
    if (crop) data.append('crop', JSON.stringify(crop));
    if (replaceEvidence) data.append('replaceEvidence', 'true');
    data.append('file', file);
    return request<{ project: CreatorProject }>(`/api/projects/${projectId}/references`, { method: 'POST', body: data });
  },
  removeReference: (projectId: string, referenceId: string) => request<{ project: CreatorProject }>(
    `/api/projects/${projectId}/references/${referenceId}`,
    { method: 'DELETE' },
  ),
  startRun: (projectId: string, input: StartRunInput) => request<{ run: GenerationRun }>(`/api/projects/${projectId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }),
  cancelRun: (runId: string) => request<{ ok: true }>(`/api/runs/${runId}/cancel`, { method: 'POST' }),
  activateRun: (projectId: string, runId: string) => request<{ project: CreatorProject }>(`/api/projects/${projectId}/activate-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId }),
  }),
};

export function referenceUrl(projectId: string, referenceId: string, cropped = true): string {
  return `/api/projects/${projectId}/references/${referenceId}/${cropped ? 'crop' : 'original'}`;
}

export function modelUrl(projectId: string, runId: string): string {
  return `/api/projects/${projectId}/runs/${runId}/model.js?v=${encodeURIComponent(runId)}`;
}

export function artifactUrl(projectId: string, runId: string, index: number): string {
  return `/api/projects/${projectId}/runs/${runId}/artifacts/${index}`;
}

export function captureFrameUrl(projectId: string, captureId: string, frameId: string): string {
  return `/api/projects/${projectId}/captures/${captureId}/frames/${frameId}`;
}
