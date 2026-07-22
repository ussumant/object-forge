# Image to 3D Creator

A local, desktop-first creator that turns one or more object photos into editable procedural Three.js code. It is designed for isolated hard-surface products and props: the result is a convincing, website-ready reconstruction, not photogrammetry or exact recovery of unseen geometry.

The application vendors [`hoainho/img2threejs`](https://github.com/hoainho/img2threejs) at commit [`a2907eb`](https://github.com/hoainho/img2threejs/commit/a2907eb5b0d00d6792150948f904eb901dc202c4) and wraps its agent-guided reconstruction process in a persistent creator UI.

## What v1 includes

- Project library and recoverable run history stored locally under `data/projects/`.
- Guided PNG, JPEG, and WebP intake with roles, cropping, image validation, and hidden-geometry acknowledgement.
- Codex and Claude CLI adapters with startup health checks, resumable same-provider sessions, cancellation, event streaming, and a ten-minute inactivity detector.
- Draft, finish, and prompted refinement runs in isolated workspaces.
- Orbitable React Three Fiber preview with reference comparison, wireframe, lighting, background, and camera reset controls.
- Safety scanning, type-aware bundling, preview validation, and stable runtime node metadata for future interactions.
- ZIP export containing a pure Three.js TypeScript factory, React Three Fiber wrapper, vanilla example, sculpt specification, assets, and integration instructions.

## Requirements

- macOS
- Node.js 24 or newer and npm
- Python 3.10 or newer for the vendored reconstruction utilities
- An authenticated `codex` CLI, `claude` CLI, or both
- Google Chrome for Playwright end-to-end tests

The UI reports provider availability and authentication before a run begins. Models are chosen by each CLI; this app does not expose model or cost controls in v1.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Fastify service runs on port `4057` and Vite proxies `/api` requests to it.

To exercise the full workflow without calling either provider:

```bash
IMG3D_FAKE_PROVIDER=1 npm run dev
```

For a production-style local build:

```bash
npm run build
npm start
```

Then open [http://127.0.0.1:4057](http://127.0.0.1:4057).

## Creator workflow

1. Create a project.
2. Add one required hero photo and up to seven supporting views.
3. Crop the object and review the suitability result. A one-view reconstruction requires explicit acknowledgement that hidden geometry will be inferred.
4. Generate a draft, orbit and compare it, then submit plain-language refinements.
5. Finish materials and presentation details.
6. Export the active successful run as a standalone ZIP.

Use evenly lit, sharp images with the whole silhouette visible. Front, back, side, and top views improve geometry; detail views are best for materials and small features. Glass-dominant objects, people, animals, scenes, and manufacturing-grade reconstruction are outside the v1 promise.

## Commands

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

End-to-end tests start isolated fake-provider servers, run against system Chrome, verify the complete upload-to-export path, and capture desktop and mobile screenshots under the ignored `output/playwright/` directory.

## Architecture and safety

The npm workspace contains:

- `apps/web`: React, Vite, React Three Fiber creator studio.
- `apps/server`: Fastify API, filesystem persistence, provider processes, SSE, validation, and ZIP export.
- `packages/shared`: cross-process data contracts.
- `vendor/img2threejs`: pinned upstream pipeline used inside isolated per-run workspaces.

Every run has its own workspace. Providers receive the photos, previous successful artifacts when applicable, the pinned pipeline instructions, and a narrow output contract. Failed, canceled, and `needs_input` runs never replace the active model. Switching providers seeds a new run from the active artifacts; it does not transfer a proprietary provider session.

Before preview or export, generated code is rejected if it uses unapproved imports, network access, external URLs, dynamic execution, Node APIs, unsafe HTML writes, dynamic imports, or path traversal. The server then bundles the factory and the browser checks it in the actual Three.js viewer.

Generated model roots expose `root.userData.sculptRuntime`, and meaningful parts should use stable names, pivots, and sockets. Those contracts prepare for clickable controls and video surfaces without implementing v2 behavior yet.

## Local data

Projects, references, run logs, workspaces, generated artifacts, provider session identifiers, and activation state live in the gitignored `data/projects/` tree. Source photographs are not included in exports unless a generated model explicitly depends on a local projected texture.

The app is intentionally local-only in v1: there are no accounts, billing, collaboration, public hosting, GLB export, or cloud persistence.
