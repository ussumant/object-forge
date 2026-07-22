# Image to 3D Creator — Agent Instructions

## Product Boundary

- This repository is a local-first creator for procedural Three.js reconstructions.
- V1 supports isolated hard-surface objects. Do not silently expand into photogrammetry, organic subjects, GLB export, public hosting, billing, or v2 component interactions.
- Generated models must remain plain Three.js factories with stable runtime node metadata and must pass the local safety scan before preview or export.
- Keep authenticated Codex and Claude executions explicit. Tests must use fake adapters unless a human deliberately starts a live smoke run.

## Development Rules

- Use TypeScript for application code and shared contracts.
- Persist user projects only under the gitignored `data/` directory.
- Keep provider processes inside isolated per-run workspaces. Never give a reconstruction process write access to application source.
- Preserve earlier successful runs; cancellation or failure must not replace the active model.
- Run `npm test`, `npm run typecheck`, and `npm run build` before handoff. For UI changes, also verify 1440x900 and 393x852 layouts and check the browser console.

## Branch And PR Requirements

- Do not commit directly to protected branches such as `main` or `staging`.
- Use a `codex/` feature branch for implementation work.
- Keep PRs focused on one responsibility when practical.
- Before merging, run the relevant automated checks and note any manual QA performed.

### Feature Planning Requirements

Before implementing any non-trivial feature, the plan must include a PR breakdown.

For each proposed PR, include:
- purpose
- target branch
- files or subsystem owned by the PR
- dependencies on earlier PRs
- test plan
- manual QA plan, if user-facing
- merge order

Prefer small PRs with one responsibility. Split app behavior, persistence, UI, release tooling, and docs unless keeping them together is explicitly justified.

Do not start implementation until the PR breakdown is accepted.
