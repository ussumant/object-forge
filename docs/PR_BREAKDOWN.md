# Image-to-3D Creator v1 PR Breakdown

## PR 1 — Local creator vertical slice

- **Purpose:** Deliver the first independently usable local flow from project creation and reference upload through draft/final generation, Three.js preview, refinement history, and website export.
- **Target branch:** `main`, implemented on `codex/image-to-3d-v1`.
- **Owned subsystems:** Repository foundation, shared contracts, local persistence/API, provider adapters, generated-code safety, React/Three.js UI, tests, and local documentation.
- **Dependencies:** None. This is the first repository change and merges first.
- **Automated tests:** Unit and integration tests with fake provider processes, typecheck, production build, and browser flow verification.
- **Manual QA:** Verify the desktop and mobile layouts, project persistence after reload, cancel/retry behavior, viewer controls, console cleanliness, and export contents.
- **Justification for one PR:** The directory starts empty and no partial subsystem is independently usable. Keeping the initial vertical slice together avoids landing an API or UI that cannot be exercised. Follow-on provider hardening, live reconstruction quality work, and v2 interactions should use separate PRs.

The user accepted the complete v1 implementation plan and explicitly requested implementation on 2026-07-21.

## Video-first follow-on sequence

1. **Existing v1 baseline** — `codex/linear-ascii-redesign` → `main`; preserves and verifies the photo-first creator before feature work.
2. **Local video processing** — `codex/video-capture-core` → `main`; owns FFmpeg extraction, frame scoring, restricted analysis, persistence, APIs, and capture tests.
3. **Verified label decals** — `codex/verified-label-decals` → `main`; owns the exact-text generation contract, local decal safety, label evidence, preview, and export.
4. **Guided video build** — `codex/guided-video-build` → `main`; owns the video-first UI, review and text confirmation, automatic draft-to-finish chaining, responsive QA, and documentation.

Merge in the order above. Every PR includes its own unit/integration checks; the final PR runs the full video and photo Playwright flows at desktop and mobile sizes.
