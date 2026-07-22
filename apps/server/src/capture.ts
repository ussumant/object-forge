import { createReadStream } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import {
  REFERENCE_ROLES,
  type CaptureAnalysis,
  type CaptureFrame,
  type Provider,
  type ReferenceRole,
  type VideoCapture,
} from '@img3d/shared';
import { stringifyEventPayload } from './providers.js';
import { ProjectStore } from './store.js';

const MAX_DURATION_MS = 60_000;
const ANALYSIS_TIMEOUT_MS = 2 * 60_000;

type ProbeResult = { durationMs: number; width: number; height: number };
type AnalysisResult = CaptureAnalysis & { assignments: Array<{ frameId: string; role: ReferenceRole; confidence: number }> };

const analysisSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  warnings: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  requestedViews: z.array(z.enum(REFERENCE_ROLES)).max(8).default([]),
  assignments: z.array(z.object({
    frameId: z.string().min(1),
    role: z.enum(REFERENCE_ROLES),
    confidence: z.number().min(0).max(1),
  })).min(1).max(8),
  detectedTexts: z.array(z.object({
    value: z.string().trim().min(1).max(200),
    frameId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    bounds: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    }).optional(),
  })).max(20).default([]),
});

function now(): string {
  return new Date().toISOString();
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; stdin?: string; timeoutMs?: number; onChild?: (child: ChildProcessWithoutNullStreams) => void } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    options.onChild?.(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs) : undefined;
    child.once('error', (error) => {
      if (timer) clearTimeout(timer);
      rejectRun(error);
    });
    child.once('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(`${basename(command)} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}: ${stderr.trim().slice(-500)}`));
    });
    child.stdin.end(options.stdin ?? '');
  });
}

export async function captureToolHealth(): Promise<{ available: boolean; message: string }> {
  try {
    await Promise.all([
      runCommand('ffmpeg', ['-version'], { timeoutMs: 5_000 }),
      runCommand('ffprobe', ['-version'], { timeoutMs: 5_000 }),
    ]);
    return { available: true, message: 'FFmpeg video capture tools are ready.' };
  } catch {
    return { available: false, message: 'Install FFmpeg with `brew install ffmpeg` to use video capture.' };
  }
}

async function probeVideo(path: string, onChild: (child: ChildProcessWithoutNullStreams) => void): Promise<ProbeResult> {
  const { stdout } = await runCommand('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path,
  ], { timeoutMs: 20_000, onChild });
  const payload = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
  const stream = payload.streams?.[0];
  const durationMs = Math.round(Number(payload.format?.duration) * 1_000);
  if (!stream?.width || !stream.height || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('The uploaded file does not contain a readable video track.');
  }
  if (durationMs > MAX_DURATION_MS) throw new Error('Object videos must be 60 seconds or shorter.');
  return { durationMs, width: stream.width, height: stream.height };
}

async function frameMetrics(path: string): Promise<{ width: number; height: number; sharpness: number; exposure: number; hash: boolean[] }> {
  const metadata = await sharp(path).metadata();
  const { data } = await sharp(path).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let edge = 0;
  let total = 0;
  let clipped = 0;
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const index = y * 32 + x;
      const value = data[index] ?? 0;
      total += value;
      if (value < 12 || value > 243) clipped += 1;
      if (x < 31) edge += Math.abs(value - (data[index + 1] ?? value));
      if (y < 31) edge += Math.abs(value - (data[index + 32] ?? value));
    }
  }
  const mean = total / data.length;
  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    sharpness: Math.min(1, edge / (32 * 31 * 2 * 36)),
    exposure: Math.max(0, 1 - Math.abs(mean - 128) / 128 - clipped / data.length),
    hash: [...data].map((value) => value >= mean),
  };
}

function hashDistance(left: boolean[], right: boolean[]): number {
  let different = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) different += 1;
  }
  return different / Math.max(1, Math.min(left.length, right.length));
}

async function selectFrames(framesDir: string): Promise<CaptureFrame[]> {
  const filenames = (await readdir(framesDir)).filter((name) => name.endsWith('.jpg')).sort();
  const measured = await Promise.all(filenames.map(async (filename, index) => ({
    filename,
    timestampMs: index * 500,
    metrics: await frameMetrics(resolve(framesDir, filename)),
  })));
  if (!measured.length) throw new Error('No usable screenshots could be extracted from this video.');
  const eligible = measured.filter((item) => item.metrics.sharpness >= 0.035 && item.metrics.exposure >= 0.2);
  const pool = eligible.length >= 4 ? eligible : measured;
  const selected: typeof pool = [];
  const bucketSize = Math.max(1, Math.ceil(pool.length / 8));
  for (let offset = 0; offset < pool.length && selected.length < 8; offset += bucketSize) {
    const bucket = pool.slice(offset, offset + bucketSize);
    const ranked = bucket.sort((a, b) => {
      const diversityA = selected.length ? Math.min(...selected.map((other) => hashDistance(a.metrics.hash, other.metrics.hash))) : 1;
      const diversityB = selected.length ? Math.min(...selected.map((other) => hashDistance(b.metrics.hash, other.metrics.hash))) : 1;
      return (b.metrics.sharpness * 0.45 + b.metrics.exposure * 0.25 + diversityB * 0.3)
        - (a.metrics.sharpness * 0.45 + a.metrics.exposure * 0.25 + diversityA * 0.3);
    });
    if (ranked[0]) selected.push(ranked[0]);
  }
  const ordered = selected.sort((a, b) => a.timestampMs - b.timestampMs);
  const defaultRoles: ReferenceRole[] = ['front', 'hero', 'right', 'detail', 'back', 'detail', 'left', 'top'];
  return ordered.map((item, index) => ({
    id: nanoid(10),
    filename: item.filename,
    timestampMs: item.timestampMs,
    width: item.metrics.width,
    height: item.metrics.height,
    sharpness: Number(item.metrics.sharpness.toFixed(3)),
    exposure: Number(item.metrics.exposure.toFixed(3)),
    diversity: index === 0 ? 1 : Number(Math.min(...ordered.slice(0, index).map((other) => hashDistance(item.metrics.hash, other.metrics.hash))).toFixed(3)),
    selected: true,
    assignedRole: defaultRoles[index] ?? 'detail',
    confidence: 0.45,
  }));
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return JSON.parse(fenced);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('Capture analyzer did not return JSON.');
}

async function analyzeWithProvider(provider: Provider, captureDir: string, frames: CaptureFrame[]): Promise<AnalysisResult> {
  const framePaths = frames.map((frame) => resolve(captureDir, 'frames', frame.filename));
  const frameList = frames.map((frame, index) => `${index + 1}. frameId=${frame.id}, file=${framePaths[index]}, timestampMs=${frame.timestampMs}`).join('\n');
  const prompt = `Analyze these ordered screenshots from one slow orbit around a stationary hard-surface object.
Return ONLY one JSON object with keys summary, warnings, requestedViews, assignments, and detectedTexts.
assignments must contain every supplied frameId once with a role from hero, front, back, left, right, top, detail and confidence 0..1. Use exactly one hero; only detail may repeat.
detectedTexts contains clearly readable object text only, with value, frameId, confidence, and optional normalized bounds {x,y,width,height}. Never guess unreadable letters.
Frame order:\n${frameList}`;
  let output = '';
  if (provider === 'codex') {
    const args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', captureDir];
    for (const path of framePaths) args.push('-i', path);
    args.push('-');
    const result = await runCommand('codex', args, { cwd: captureDir, stdin: prompt, timeoutMs: ANALYSIS_TIMEOUT_MS });
    output = result.stdout.split('\n').filter(Boolean).map((line) => {
      try { return stringifyEventPayload(JSON.parse(line)); } catch { return line; }
    }).filter(Boolean).join('\n');
  } else {
    const result = await runCommand('claude', [
      '-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--add-dir', captureDir,
      '--allowedTools', 'Read', prompt,
    ], { cwd: captureDir, timeoutMs: ANALYSIS_TIMEOUT_MS });
    const wrapper = JSON.parse(result.stdout) as unknown;
    output = stringifyEventPayload(wrapper) || result.stdout;
  }
  const parsed = analysisSchema.parse(extractJson(output));
  const validIds = new Set(frames.map((frame) => frame.id));
  if (parsed.assignments.some((item) => !validIds.has(item.frameId))) throw new Error('Capture analyzer referenced an unknown frame.');
  if (parsed.detectedTexts.some((item) => !validIds.has(item.frameId))) throw new Error('Capture analyzer text referenced an unknown frame.');
  const heroCount = parsed.assignments.filter((item) => item.role === 'hero').length;
  const uniqueRoles = parsed.assignments.filter((item) => item.role !== 'detail').map((item) => item.role);
  if (heroCount !== 1 || new Set(uniqueRoles).size !== uniqueRoles.length) throw new Error('Capture analyzer returned invalid or duplicate view roles.');
  return {
    ...parsed,
    detectedTexts: parsed.detectedTexts.map((item) => ({ ...item, id: nanoid(10) })),
  };
}

function fallbackAnalysis(frames: CaptureFrame[], reason?: string): AnalysisResult {
  return {
    summary: 'Selected the clearest, most varied frames from the video. Review them once before building.',
    warnings: reason ? [`Automatic semantic review was unavailable: ${reason}`] : [],
    requestedViews: [],
    detectedTexts: [],
    assignments: frames.map((frame) => ({ frameId: frame.id, role: frame.assignedRole ?? 'detail', confidence: 0.45 })),
  };
}

export class CaptureManager {
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly store: ProjectStore) {}

  async process(projectId: string, captureId: string): Promise<void> {
    const project = await this.store.getProject(projectId);
    const capture = project.captures.find((item) => item.id === captureId);
    if (!capture) return;
    const captureDir = this.store.captureDir(projectId, captureId);
    const sourcePath = resolve(captureDir, capture.storedFilename);
    const onChild = (child: ChildProcessWithoutNullStreams) => this.active.set(captureId, child);
    try {
      await this.store.updateCapture(projectId, captureId, { status: 'processing', error: undefined });
      const probe = await probeVideo(sourcePath, onChild);
      const framesDir = resolve(captureDir, 'frames');
      await mkdir(framesDir, { recursive: true });
      await runCommand('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
        '-vf', 'fps=2,scale=1600:-2:force_original_aspect_ratio=decrease',
        '-q:v', '2', resolve(framesDir, 'frame-%04d.jpg'),
      ], { timeoutMs: 90_000, onChild });
      let frames = await selectFrames(framesDir);
      let analysis: AnalysisResult;
      if (process.env.IMG3D_FAKE_PROVIDER === '1') analysis = fallbackAnalysis(frames);
      else {
        try { analysis = await analyzeWithProvider(capture.provider, captureDir, frames); }
        catch (error) { analysis = fallbackAnalysis(frames, error instanceof Error ? error.message : String(error)); }
      }
      const assignments = new Map(analysis.assignments.map((item) => [item.frameId, item]));
      frames = frames.map((frame) => ({
        ...frame,
        assignedRole: assignments.get(frame.id)?.role ?? frame.assignedRole,
        confidence: assignments.get(frame.id)?.confidence ?? frame.confidence,
      }));
      await writeFile(resolve(captureDir, 'analysis.json'), `${JSON.stringify({ ...analysis, assignments: undefined }, null, 2)}\n`, 'utf8');
      await this.store.updateCapture(projectId, captureId, {
        status: 'needs_review',
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        frames,
        analysis: {
          summary: analysis.summary,
          warnings: analysis.warnings,
          requestedViews: analysis.requestedViews,
          detectedTexts: analysis.detectedTexts,
        },
      });
    } catch (error) {
      const fresh = await this.store.getProject(projectId).catch(() => undefined);
      const status = fresh?.captures.find((item) => item.id === captureId)?.status;
      if (status !== 'canceled') {
        await this.store.updateCapture(projectId, captureId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
    } finally {
      this.active.delete(captureId);
    }
  }

  async cancel(projectId: string, captureId: string): Promise<void> {
    this.active.get(captureId)?.kill('SIGTERM');
    await this.store.updateCapture(projectId, captureId, { status: 'canceled', error: 'Video processing was canceled.' });
  }
}

export interface CaptureProcessor {
  process(projectId: string, captureId: string): Promise<void>;
  cancel(projectId: string, captureId: string): Promise<void>;
}

export function captureFrameStream(store: ProjectStore, projectId: string, capture: VideoCapture, frameId: string) {
  const frame = capture.frames.find((item) => item.id === frameId);
  if (!frame) throw new Error('Capture frame not found.');
  return createReadStream(resolve(store.captureDir(projectId, capture.id), 'frames', frame.filename));
}
