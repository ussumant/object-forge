import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Code2,
  Download,
  Eye,
  FileImage,
  Grid3X3,
  Hammer,
  ImagePlus,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  Sparkles,
  Trash2,
  TriangleAlert,
  Video,
  X,
} from 'lucide-react';
import type {
  CreatorProject,
  GenerationRun,
  GeneratorEvent,
  Provider,
  ProviderHealth,
  ReferenceImage,
  ReferenceRole,
  RunPhase,
  VideoCapture,
} from '@img3d/shared';
import { api, artifactUrl, modelUrl, referenceUrl } from './api';
import { UploadModal } from './UploadModal';
import { VideoCaptureReview } from './VideoCaptureReview';

const Viewer = lazy(() => import('./Viewer').then((module) => ({ default: module.Viewer })));

type Route = { page: 'library' } | { page: 'project'; projectId: string };

function parseRoute(): Route {
  const match = window.location.hash.match(/^#\/projects\/([^/]+)/);
  return match?.[1] ? { page: 'project', projectId: match[1] } : { page: 'library' };
}

function navigate(path: string): void {
  window.location.hash = path;
}

function formatDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function providerLabel(provider: Provider): string {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    void api.providerHealth().then((payload) => setProviders(payload.providers)).catch(() => undefined);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route.page === 'library'
    ? <Library providers={providers} />
    : <ProjectStudio projectId={route.projectId} providers={providers} />;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark ${compact ? 'compact' : ''}`}>
      <span className="brand-icon" aria-hidden="true"><span>[o]</span></span>
      <span>
        <strong>Object Forge</strong>
        {!compact && <small>image → spatial code</small>}
      </span>
    </div>
  );
}

const asciiSculpture = String.raw`
          .:--------:.
       .+############+.
     .####+.      .+####.
    +###.    .::.    .###+
   :###     +####+     ###:
   +##:     ######     :##+
   +##:     ######     :##+
   :###     +####+     ###:
    +###.    '::'    .###+
     '####+.      .+####'
       '+############+'
          '::----::'`;

function AsciiSculpture({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`ascii-sculpture ${compact ? 'compact' : ''}`} aria-hidden="true">
      <pre>{asciiSculpture}</pre>
      <figcaption><span>mesh study</span><span>12×12</span></figcaption>
    </figure>
  );
}

function ProviderStatus({ providers }: { providers: ProviderHealth[] }) {
  return (
    <div className="provider-status-row" aria-label="Generator status">
      {(['codex', 'claude'] as Provider[]).map((provider) => {
        const health = providers.find((item) => item.provider === provider);
        const ready = health?.available && health.authenticated;
        return (
          <span key={provider} className={`provider-health ${ready ? 'ready' : 'offline'}`} title={health?.message ?? 'Checking…'}>
            <i /> {providerLabel(provider)} {ready ? 'ready' : health ? 'offline' : 'checking'}
          </span>
        );
      })}
    </div>
  );
}

function Library({ providers }: { providers: ProviderHealth[] }) {
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    void api.listProjects().then((payload) => setProjects(payload.projects)).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);

  useEffect(refresh, [refresh]);

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const payload = await api.createProject(name);
      navigate(`/projects/${payload.project.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCreating(false);
    }
  };

  return (
    <main className="library-shell">
      <header className="library-topbar">
        <BrandMark />
        <ProviderStatus providers={providers} />
      </header>

      <section className="library-hero">
        <div className="hero-copy reveal-1">
          <span className="eyebrow"><span className="eyebrow-index">01</span> Image evidence → spatial code</span>
          <h1>Give a virtual object<br /><em>weight.</em></h1>
          <p>Rebuild hard-surface objects as editable, website-ready Three.js—using your own local coding agents.</p>
          <div className="hero-proof" aria-label="Product capabilities">
            <span><i /> local-first</span>
            <span><i /> procedural</span>
            <span><i /> exportable</span>
          </div>
        </div>
        <div className="hero-console reveal-2">
          <AsciiSculpture />
          <form className="new-project-card" onSubmit={createProject}>
            <div className="project-card-index"><span>New object</span><span>01 / 03</span></div>
            <label htmlFor="project-name">What are we rebuilding?</label>
            <input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Braun alarm clock"
              autoComplete="off"
              maxLength={100}
            />
            <p>Recommended: upload one short phone video. We’ll choose the useful views and read the label for you.</p>
            {error && <span className="inline-error">{error}</span>}
            <button className="primary-button wide" disabled={creating || !name.trim()}>
              {creating ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}
              {creating ? 'Opening workbench…' : 'Create object project'}
            </button>
          </form>
        </div>
      </section>

      <section className="project-library reveal-3">
        <div className="section-heading">
          <div>
            <span className="eyebrow"><span className="eyebrow-index">02</span> Local archive</span>
            <h2>Your objects</h2>
          </div>
          <span className="object-count">{String(projects.length).padStart(2, '0')} PROJECTS</span>
        </div>

        {projects.length === 0 ? (
          <div className="empty-library">
            <AsciiSculpture compact />
            <div>
              <strong>No captured objects yet.</strong>
              <p>Name the first object above. Every image, run, and export stays on this machine.</p>
            </div>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project, index) => {
              const hero = project.references.find((reference) => reference.role === 'hero');
              const activeRun = project.runs.find((run) => run.id === project.activeRunId);
              return (
                <button className="project-tile" key={project.id} onClick={() => navigate(`/projects/${project.id}`)}>
                  <span className="tile-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="project-thumb">
                    {hero
                      ? <img src={referenceUrl(project.id, hero.id)} alt={`${project.name} hero reference`} />
                      : <div className="thumb-placeholder"><ImagePlus size={28} /><span>awaiting evidence</span></div>}
                    <span className={`project-state ${activeRun ? 'ready' : project.runs[0]?.status ?? 'capture'}`}>
                      {activeRun ? 'model ready' : project.runs[0]?.status ?? 'capture'}
                    </span>
                  </div>
                  <span className="tile-meta">{project.references.length} views · {project.runs.length} runs</span>
                  <strong>{project.name}</strong>
                  <span className="tile-footer">Updated {formatDate(project.updatedAt)} <ChevronRight size={16} /></span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <footer className="library-footer"><span>LOCAL ONLY</span><span>THREE.JS / PROCEDURAL FACTORIES</span><span>NO CLOUD LIBRARY</span></footer>
    </main>
  );
}

function ProjectStudio({ projectId, providers }: { projectId: string; providers: ProviderHealth[] }) {
  const [project, setProject] = useState<CreatorProject>();
  const [error, setError] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<Provider>('codex');
  const [uploadFile, setUploadFile] = useState<File>();
  const [uploadReplacesEvidence, setUploadReplacesEvidence] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [showCaptureReview, setShowCaptureReview] = useState(false);
  const [autoOpenedCaptureId, setAutoOpenedCaptureId] = useState<string>();
  const [captureHealth, setCaptureHealth] = useState<{ available: boolean; message: string }>();
  const [wireframe, setWireframe] = useState(false);
  const [background, setBackground] = useState<'graphite' | 'bone' | 'studio'>('graphite');
  const [resetKey, setResetKey] = useState(0);
  const [showReference, setShowReference] = useState(false);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string>();
  const [acceptApproximation, setAcceptApproximation] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [startingRun, setStartingRun] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'evidence' | 'build' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingReplacement = useRef(false);
  const videoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.captureHealth().then(setCaptureHealth).catch((reason: unknown) => {
      setCaptureHealth({ available: false, message: reason instanceof Error ? reason.message : String(reason) });
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getProject(projectId);
      setProject(payload.project);
      if (!selectedReferenceId) setSelectedReferenceId(payload.project.references.find((item) => item.role === 'hero')?.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [projectId, selectedReferenceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (project) setAcceptApproximation(project.suitability.acceptedApproximation);
  }, [project?.id, project?.suitability.acceptedApproximation]);

  const runningRun = project?.runs.find((run) => run.status === 'running' || run.status === 'queued');
  const latestCapture = project?.captures[0];
  const processingCapture = project?.captures.find((capture) => capture.status === 'queued' || capture.status === 'processing');
  useEffect(() => {
    if (!runningRun) return;
    const source = new EventSource(`/api/runs/${runningRun.id}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as GeneratorEvent;
      if (['phase_started', 'artifact_ready', 'preview_ready', 'input_requested', 'completed', 'failed'].includes(event.type)) {
        void refresh();
      }
    };
    const poll = window.setInterval(() => void refresh(), 1_500);
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [refresh, runningRun?.id]);

  useEffect(() => {
    if (!processingCapture) return;
    const poll = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(poll);
  }, [processingCapture?.id, refresh]);

  useEffect(() => {
    if (latestCapture?.status === 'needs_review' && autoOpenedCaptureId !== latestCapture.id) {
      setAutoOpenedCaptureId(latestCapture.id);
      setShowCaptureReview(true);
    }
  }, [autoOpenedCaptureId, latestCapture?.id, latestCapture?.status]);

  const hero = project?.references.find((reference) => reference.role === 'hero');
  const selectedReference = project?.references.find((reference) => reference.id === selectedReferenceId) ?? hero;
  const activeRun = project?.runs.find((run) => run.id === project.activeRunId);
  const readyModelUrl = project && activeRun ? modelUrl(project.id, activeRun.id) : undefined;
  const providerReady = (provider: Provider) => {
    const health = providers.find((item) => item.provider === provider);
    return Boolean(health?.available && health.authenticated);
  };

  useEffect(() => {
    if (!providerReady(selectedProvider)) {
      const fallback = providers.find((item) => item.available && item.authenticated)?.provider;
      if (fallback) setSelectedProvider(fallback);
    }
  }, [providers, selectedProvider]);

  const chooseFile = async (file?: File, replaceEvidence = false) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('Reference images must be 20 MB or smaller.');
      return;
    }
    const isHeic = ['image/heic', 'image/heif'].includes(file.type) || /\.hei[cf]$/i.test(file.name);
    if (!isHeic && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG, WebP, HEIC, or HEIF image.');
      return;
    }
    setPreparingPhoto(true);
    setError('');
    try {
      let prepared = file;
      if (isHeic) {
        const { default: heic2any } = await import('heic2any');
        const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.94 });
        const blob = Array.isArray(converted) ? converted[0] : converted;
        if (!blob) throw new Error('The HEIC image did not contain a readable photo.');
        prepared = new File(
          [blob],
          file.name.replace(/\.hei[cf]$/i, '') + '.jpg',
          { type: 'image/jpeg', lastModified: file.lastModified },
        );
      }
      setUploadReplacesEvidence(replaceEvidence);
      setUploadFile(prepared);
    } catch (reason) {
      setError(`Could not prepare this photo. ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setPreparingPhoto(false);
    }
  };

  const chooseVideo = async (file?: File) => {
    if (!file) return;
    if (captureHealth && !captureHealth.available) {
      setError(captureHealth.message);
      return;
    }
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) {
      setError('Choose a MOV, MP4, or WebM video.');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setError('Object videos must be 500 MB or smaller.');
      return;
    }
    setUploadingVideo(true);
    setError('');
    try {
      await api.uploadVideo(projectId, file, selectedProvider);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploadingVideo(false);
    }
  };

  const uploadReference = async (role: ReferenceRole, crop?: { x: number; y: number; width: number; height: number }) => {
    if (!uploadFile) return;
    await api.uploadReference(projectId, uploadFile, role, crop, uploadReplacesEvidence);
    setUploadFile(undefined);
    setUploadReplacesEvidence(false);
    await refresh();
  };

  const removeReference = async (reference: ReferenceImage) => {
    setError('');
    try {
      await api.removeReference(projectId, reference.id);
      if (selectedReferenceId === reference.id) setSelectedReferenceId(undefined);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const startRun = async (kind: 'draft' | 'finish' | 'refine') => {
    if (!project) return;
    setStartingRun(true);
    setError('');
    try {
      await api.startRun(project.id, {
        provider: selectedProvider,
        kind,
        sourceRunId: project.activeRunId,
        feedback: kind === 'refine' ? feedback.trim() : undefined,
        acceptApproximation,
        autoFinish: kind === 'draft',
      });
      setFeedback('');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartingRun(false);
    }
  };

  const retryRun = async (run: GenerationRun) => {
    if (!project) return;
    setStartingRun(true);
    setSelectedProvider(run.provider);
    setError('');
    try {
      await api.startRun(project.id, {
        provider: run.provider,
        kind: run.kind,
        sourceRunId: project.activeRunId,
        feedback: run.feedback,
        acceptApproximation: run.acceptApproximation ?? project.suitability.acceptedApproximation,
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartingRun(false);
    }
  };

  if (!project) {
    return <main className="loading-screen"><AsciiSculpture compact /><span>Opening local workbench…</span>{error && <p>{error}</p>}</main>;
  }

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <button className="back-button" onClick={() => navigate('/')} aria-label="Back to object library"><ArrowLeft size={18} /></button>
        <BrandMark compact />
        <div className="studio-title">
          <span>PROJECT / {project.id.slice(0, 6).toUpperCase()}</span>
          <strong>{project.name}</strong>
        </div>
        <div className="topbar-state">
          <span className={`status-light ${runningRun ? 'working' : activeRun ? 'ready' : ''}`} />
          {runningRun ? `${runningRun.phase} in progress` : activeRun ? 'active model ready' : 'capture required'}
        </div>
        <a className={`export-button ${activeRun ? '' : 'disabled'}`} href={activeRun ? `/api/projects/${project.id}/export` : undefined} aria-disabled={!activeRun}>
          <Download size={17} /> Export
        </a>
      </header>

      <div className="studio-mobile-tabs">
        <button onClick={() => setMobilePanel(mobilePanel === 'evidence' ? null : 'evidence')}><FileImage size={17} /> Evidence</button>
        <button onClick={() => setMobilePanel(mobilePanel === 'build' ? null : 'build')}><Hammer size={17} /> Build</button>
      </div>

      <div className="studio-grid">
        <aside className={`evidence-panel ${mobilePanel === 'evidence' ? 'mobile-open' : ''}`}>
          <PanelHeader index="01" title="Evidence" subtitle={`${project.references.length}/8 source views`} onClose={() => setMobilePanel(null)} />
          <div className="evidence-guide">
            <Video size={18} />
            <p><strong>One slow phone video is enough.</strong> Keep the object still, start at the front, circle it once, then tilt slightly above and below.</p>
          </div>
          <section className={`video-capture-card ${latestCapture?.status ?? ''}`}>
            <div className="video-capture-title">
              <span><Video size={16} /><strong>Video capture</strong></span>
              <small>Recommended</small>
            </div>
            {!latestCapture || latestCapture.status === 'failed' || latestCapture.status === 'canceled' ? (
              <>
                <p>{latestCapture?.error ?? (captureHealth && !captureHealth.available ? captureHealth.message : 'Upload a 15–30 second orbit. The app will choose clear angles and detect visible text.')}</p>
                <button className="primary-button wide" disabled={uploadingVideo || Boolean(processingCapture) || captureHealth?.available === false} onClick={() => videoInput.current?.click()}>
                  {uploadingVideo ? <LoaderCircle className="spin" size={16} /> : <Video size={16} />}
                  {uploadingVideo ? 'Uploading video…' : latestCapture ? 'Try another video' : 'Upload object video'}
                </button>
              </>
            ) : latestCapture.status === 'queued' || latestCapture.status === 'processing' ? (
              <div className="capture-processing"><LoaderCircle className="spin" size={17} /><span><strong>Choosing useful views</strong><small>Checking sharpness, angles, and label text locally…</small></span></div>
            ) : latestCapture.status === 'needs_review' ? (
              <>
                <p>{latestCapture.analysis?.summary ?? 'Your capture pack is ready for one quick review.'}</p>
                <button className="primary-button wide" onClick={() => setShowCaptureReview(true)}><CheckCircle2 size={16} /> Review selected views</button>
              </>
            ) : (
              <div className="capture-ready"><CheckCircle2 size={16} /><span><strong>Capture pack ready</strong><small>{latestCapture.frames.filter((frame) => frame.selected).length} views · {project.surfaceTexts.length} confirmed text phrase{project.surfaceTexts.length === 1 ? '' : 's'}</small></span></div>
            )}
          </section>
          <input
            ref={videoInput}
            className="visually-hidden"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mov"
            onChange={(event) => { void chooseVideo(event.target.files?.[0]); event.target.value = ''; }}
          />
          <div className="reference-list">
            {project.references.map((reference) => (
              <button
                key={reference.id}
                className={`reference-card ${selectedReference?.id === reference.id ? 'selected' : ''}`}
                onClick={() => { setSelectedReferenceId(reference.id); setShowReference(true); }}
              >
                <img src={referenceUrl(project.id, reference.id)} alt={`${reference.role} reference`} />
                <span className="reference-role">{reference.role}</span>
                <span className="reference-size">{reference.width}×{reference.height}</span>
                <span
                  className="reference-delete"
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove ${reference.role} reference`}
                  onClick={(event) => { event.stopPropagation(); void removeReference(reference); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') void removeReference(reference); }}
                ><Trash2 size={14} /></span>
              </button>
            ))}
          </div>
          <section className="photo-capture-card">
            <div>
              <strong>Use individual photos</strong>
              <small>{project.references.length >= 8 ? 'Replace the incorrect capture pack' : 'Video is optional'}</small>
            </div>
            <button
              className="add-reference"
              disabled={preparingPhoto}
              onClick={() => {
                pendingReplacement.current = project.references.length >= 8;
                fileInput.current?.click();
              }}
            >
              {preparingPhoto ? <LoaderCircle className="spin" size={20} /> : <ImagePlus size={20} />}
              <span>
                <strong>{preparingPhoto ? 'Preparing photo…' : project.references.length >= 8 ? 'Replace current evidence' : 'Add a photo'}</strong>
                <small>PNG, JPEG, WebP or iPhone HEIC · max 20 MB</small>
              </span>
            </button>
          </section>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
            onChange={(event) => {
              void chooseFile(event.target.files?.[0], pendingReplacement.current);
              pendingReplacement.current = false;
              event.target.value = '';
            }}
          />
          <div className={`suitability-card ${project.suitability.verdict}`}>
            <div>
              {project.suitability.verdict === 'pass' ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}
              <strong>{project.suitability.verdict === 'pending' ? 'Awaiting hero image' : `${project.suitability.verdict} capture`}</strong>
            </div>
            <p>{project.suitability.summary}</p>
            {project.suitability.verdict !== 'pending' && (
              <label className="check-row">
                <input type="checkbox" checked={acceptApproximation} onChange={(event) => setAcceptApproximation(event.target.checked)} />
                <span>I accept inferred geometry for unseen sides or the underside.</span>
              </label>
            )}
          </div>
        </aside>

        <section className="viewer-stage">
          <div className="stage-toolbar">
            <div className="view-toggle">
              <button className={!showReference ? 'active' : ''} onClick={() => setShowReference(false)}><Box size={15} /> Model</button>
              <button className={showReference ? 'active' : ''} disabled={!selectedReference} onClick={() => setShowReference(true)}><Eye size={15} /> Compare</button>
            </div>
            <div className="viewer-tools">
              <button className={wireframe ? 'active' : ''} onClick={() => setWireframe((value) => !value)} title="Toggle wireframe"><Grid3X3 size={16} /></button>
              <select value={background} onChange={(event) => setBackground(event.target.value as typeof background)} aria-label="Viewer background">
                <option value="graphite">Graphite</option>
                <option value="studio">Studio green</option>
                <option value="bone">Bone</option>
              </select>
              <button onClick={() => setResetKey((value) => value + 1)} title="Reset camera"><RotateCcw size={16} /></button>
            </div>
          </div>
          <div className={`stage-composition ${showReference && selectedReference ? 'compare' : ''}`}>
            {showReference && selectedReference && (
              <figure className="reference-compare">
                <img src={referenceUrl(project.id, selectedReference.id)} alt={`${selectedReference.role} reference`} />
                <figcaption><span>REFERENCE / {selectedReference.role.toUpperCase()}</span><strong>{selectedReference.originalFilename}</strong></figcaption>
              </figure>
            )}
            <div className="model-viewport">
              <Suspense fallback={<div className="viewer-empty-note"><AsciiSculpture compact /><span>Preparing viewport</span><strong>Loading the Three.js inspection bench…</strong></div>}>
                <Viewer modelUrl={readyModelUrl} wireframe={wireframe} background={background} resetKey={resetKey} />
              </Suspense>
              <div className="viewport-corners" aria-hidden="true"><i /><i /><i /><i /></div>
              <span className="viewport-label">LIVE THREE.JS / ORBIT ENABLED</span>
            </div>
          </div>
          {error && <div className="stage-error"><AlertCircle size={16} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
        </section>

        <aside className={`build-panel ${mobilePanel === 'build' ? 'mobile-open' : ''}`}>
          <PanelHeader index="02" title="Build" subtitle="Agent-guided reconstruction" onClose={() => setMobilePanel(null)} />
          <section className="build-section">
            <label className="section-label">Generator</label>
            <div className="provider-picker">
              {(['codex', 'claude'] as Provider[]).map((provider) => (
                <button
                  key={provider}
                  className={selectedProvider === provider ? 'selected' : ''}
                  disabled={!providerReady(provider) || Boolean(runningRun)}
                  onClick={() => setSelectedProvider(provider)}
                >
                  <span>{provider === 'codex' ? <Code2 size={17} /> : <Sparkles size={17} />}{providerLabel(provider)}</span>
                  <i className={providerReady(provider) ? 'online' : ''} />
                </button>
              ))}
            </div>
          </section>

          {!hero ? (
            <section className="build-gate">
              <div className="gate-number">01</div>
              <ImagePlus size={28} />
              <strong>Capture the object once</strong>
              <p>Use a short phone video. We’ll choose the angles and prepare the label automatically.</p>
              <button className="primary-button wide" disabled={captureHealth?.available === false} onClick={() => videoInput.current?.click()}><Video size={17} /> Upload object video</button>
              {captureHealth?.available === false && <span className="inline-error">{captureHealth.message}</span>}
              <button className="text-button" onClick={() => fileInput.current?.click()}>Or add photos manually</button>
            </section>
          ) : !activeRun ? (
            <section className="build-gate ready-gate">
              <div className="gate-number">02</div>
              <Layers3 size={28} />
              <strong>Create the full 3D model</strong>
              <p>We first verify the shape, then automatically add materials, confirmed label text, transparency, and lighting.</p>
              <button
                className="primary-button wide"
                disabled={Boolean(runningRun) || startingRun || !providerReady(selectedProvider) || (project.suitability.verdict !== 'pass' && !acceptApproximation)}
                onClick={() => void startRun('draft')}
              >
                {startingRun || runningRun ? <LoaderCircle className="spin" size={18} /> : <Hammer size={18} />}
                {runningRun ? `Building ${runningRun.phase}…` : 'Create 3D model'}
              </button>
              <small className="guided-build-note">Draft checks shape. Finish adds the label and realistic surface.</small>
            </section>
          ) : (
            <>
              <section className="active-model-card">
                <div><CheckCircle2 size={18} /><span><small>ACTIVE RUN</small><strong>{activeRun.kind} · {providerLabel(activeRun.provider)}</strong></span></div>
                <span className="run-stamp">{activeRun.id.slice(0, 6)}</span>
              </section>
              {activeRun.kind !== 'finish' && (
                <section className="finish-section">
                  <span className="section-label">Stage two</span>
                  <p>Commit material response, lighting, runtime sockets, and browser optimization.</p>
                  <button className="primary-button wide" disabled={Boolean(runningRun) || startingRun} onClick={() => void startRun('finish')}>
                    {runningRun ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
                    Finish materials + light
                  </button>
                </section>
              )}
              <section className="refine-section">
                <label htmlFor="refinement"><MessageSquareText size={15} /> Directed refinement</label>
                <textarea
                  id="refinement"
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Make the handle wider and soften the top edge…"
                  maxLength={1000}
                />
                <button className="secondary-button wide" disabled={!feedback.trim() || Boolean(runningRun) || startingRun} onClick={() => void startRun('refine')}>
                  <RefreshCcw size={16} /> Create refinement run
                </button>
              </section>
            </>
          )}

          {runningRun && (
            <button className="cancel-run" onClick={() => void api.cancelRun(runningRun.id).then(refresh)}>
              <CircleStop size={16} /> Stop current run
            </button>
          )}

          <RunTimeline
            project={project}
            onActivate={async (runId) => { await api.activateRun(project.id, runId); await refresh(); }}
            onRetry={retryRun}
          />
        </aside>
      </div>

      {uploadFile && (
        <UploadModal
          file={uploadFile}
          initialRole={uploadReplacesEvidence || !hero ? 'hero' : 'left'}
          replacementCount={uploadReplacesEvidence ? project.references.length : 0}
          onClose={() => { setUploadFile(undefined); setUploadReplacesEvidence(false); }}
          onSubmit={uploadReference}
        />
      )}
      {showCaptureReview && latestCapture?.status === 'needs_review' && (
        <VideoCaptureReview
          projectId={project.id}
          capture={latestCapture as VideoCapture}
          onClose={() => setShowCaptureReview(false)}
          onAccept={async (input) => {
            await api.acceptCapture(project.id, latestCapture.id, input);
            setShowCaptureReview(false);
            await refresh();
          }}
        />
      )}
    </main>
  );
}

function PanelHeader({ index, title, subtitle, onClose }: { index: string; title: string; subtitle: string; onClose: () => void }) {
  return (
    <header className="panel-header">
      <span>{index}</span>
      <div><strong>{title}</strong><small>{subtitle}</small></div>
      <button onClick={onClose} aria-label={`Close ${title} panel`}><X size={17} /></button>
    </header>
  );
}

const phaseLabels: Record<RunPhase, string> = {
  intake: 'Probe image',
  spec: 'Sculpt spec',
  blockout: 'Blockout',
  structure: 'Structure',
  form: 'Form',
  materials: 'Materials',
  surface: 'Surface',
  lighting: 'Lighting',
  interaction: 'Runtime hierarchy',
  optimization: 'Optimize',
  export: 'Package',
};

function RunTimeline({
  project,
  onActivate,
  onRetry,
}: {
  project: CreatorProject;
  onActivate: (runId: string) => Promise<void>;
  onRetry: (run: GenerationRun) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string>();
  if (project.runs.length === 0) return null;
  return (
    <section className="run-history">
      <div className="section-label"><span>Run history</span><span>{project.runs.length}</span></div>
      <div className="run-list">
        {project.runs.map((run) => {
          const isActive = run.id === project.activeRunId;
          const isExpanded = expanded === run.id;
          return (
            <article className={`run-row ${run.status} ${isActive ? 'active' : ''}`} key={run.id}>
              <button className="run-summary" onClick={() => setExpanded(isExpanded ? undefined : run.id)}>
                <span className="run-icon">
                  {run.status === 'running' ? <LoaderCircle className="spin" size={15} />
                    : run.status === 'succeeded' ? <CheckCircle2 size={15} />
                      : run.status === 'needs_input' ? <TriangleAlert size={15} />
                        : <AlertCircle size={15} />}
                </span>
                <span><strong>{run.kind}</strong><small>{providerLabel(run.provider)} · {phaseLabels[run.phase]}</small></span>
                <time>{formatDate(run.updatedAt)}</time>
              </button>
              {isExpanded && (
                <div className="run-detail">
                  {run.error && <p className="run-error">{run.error}</p>}
                  {run.messages.slice(-4).map((message, index) => <p key={index}>{message}</p>)}
                  {run.artifacts.some((artifact) => artifact.kind === 'comparison') && (
                    <div className="run-artifacts">
                      {run.artifacts.map((artifact, index) => artifact.kind === 'comparison' ? (
                        <a key={`${artifact.path}-${index}`} href={artifactUrl(project.id, run.id, index)} target="_blank" rel="noreferrer">
                          <img src={artifactUrl(project.id, run.id, index)} alt="Run review evidence" loading="lazy" />
                        </a>
                      ) : null)}
                    </div>
                  )}
                  {run.status === 'succeeded' && !isActive && (
                    <button onClick={() => void onActivate(run.id)}>Make active model</button>
                  )}
                  {['failed', 'canceled', 'needs_input'].includes(run.status) && (
                    <button onClick={() => void onRetry(run)}><RefreshCcw size={13} /> Retry from active model</button>
                  )}
                  {isActive && <span className="active-tag">ACTIVE MODEL</span>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
