import type { RunContext } from '@img3d/shared';
import { ROOT_DIR } from './paths.js';

export function buildGenerationPrompt(context: Omit<RunContext, 'prompt'>, acceptApproximation: boolean): string {
  const references = context.referencePaths.map((item) => `- ${item.role}: ${item.path}`).join('\n');
  const confirmedTexts = context.project.surfaceTexts.length
    ? context.project.surfaceTexts.map((item) => `- ${JSON.stringify(item.value)} (evidence id ${item.id}, method ${item.renderingMethod}${item.assetFilename ? `, local asset assets/labels/${item.assetFilename}` : ''})`).join('\n')
    : '- none confirmed';
  const stageInstruction = context.run.kind === 'draft'
    ? 'Complete intake, assessment/spec, blockout, structural-pass, and form-refinement. Stop before material-pass.'
    : context.run.kind === 'finish'
      ? 'Continue the active model through material, surface, lighting, interaction, and optimization passes.'
      : `Refine the active model in response to this feedback: ${context.run.feedback ?? 'Improve the visible mismatch.'}`;

  return `You are running an isolated Image-to-3D Creator job.

Authorized run workspace: ${context.workDir}

Read ${context.workDir}/.pipeline/SKILL.md completely, then follow its quality gates for a hard-surface browser prop. The application source is not accessible and must not be requested. Work only inside the authorized run workspace. The launcher may keep a stable provider-session directory as its process cwd; do not write there. Use absolute paths, or begin every shell command with cd ${JSON.stringify(context.workDir)}.

Object: ${context.project.name}
Run kind: ${context.run.kind}
Provider: ${context.run.provider}
Approximation of hidden geometry accepted: ${acceptApproximation ? 'yes' : 'no'}

References:
${references}

Confirmed surface text:
${confirmedTexts}

${stageInstruction}

Requirements:
1. Use the hero image as sourceImage and capture-manifest.json for all extra evidence.
2. If the target is not an isolated hard-surface object, or the available evidence cannot support a defensible reconstruction, write run-result.json with status needs_input and a concrete request. Do not pretend confidence.
3. Keep all correction loops to at most two attempts per pass. A remaining mismatch must become needs_input.
4. Produce object-sculpt-spec.json and src/createModel.ts.
5. src/createModel.ts must import only three, make no network calls, and export a factory whose name begins with create and returns a THREE.Group.
6. Preserve stable named nodes, pivots, sockets, and root.userData.sculptRuntime. Do not implement clickable or video behavior.
7. Do not include source photographs in the generated model unless a projected texture is essential and explicitly recorded in object-sculpt-spec.json.
8. Finish by writing run-result.json with status succeeded or needs_input, a short summary, and any requestedViews.
9. For finish/refine runs, every confirmed surface-text phrase must appear exactly and visibly in the model. Use a THREE.CanvasTexture/vector text layer for exact wording, optionally combined with its approved local crop. Never rely on OCR guesses or external fonts.
10. Keep label nodes stable and expose them under root.userData.sculptRuntime.labels. Update label-evidence.json renderings with each evidence id, exact text, nodeName, and method. If exact text cannot be rendered, return needs_input instead of succeeding.

Local verification tools:
- Dependencies are already installed at ${ROOT_DIR}/node_modules and resolve from this nested workspace. Do not run npm install and do not treat a missing workspace-local node_modules directory as a blocker.
- Run package scripts with npm run <script>. For a deterministic browser render, run node .img3d/capture-preview.mjs --output output/playwright/<name>.png from the authorized workspace. It starts a temporary local Vite server, uses the installed system browser, fails on browser console/page errors, and makes no network request.
`;
}
