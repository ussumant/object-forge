# Contributing to Object Forge

Thank you for helping improve Object Forge.

## Before opening a pull request

1. Open an issue for changes that alter persisted data, provider execution,
   generated-code safety, or the exported bundle contract.
2. Keep user projects and source media under the ignored `data/` directory.
3. Use fake provider adapters for automated tests. Do not make live Codex or
   Claude calls from routine test suites.
4. Keep each provider process inside its isolated per-run workspace.
5. Preserve the last successful active model when a run fails or is canceled.

## Development

Requirements and local setup are documented in [README.md](README.md).

Before submitting a pull request, run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

For UI changes, check both 1440x900 and 393x852 layouts and confirm the browser
console has no errors.

## Pull requests

- Explain the user-facing outcome and any persistence or security impact.
- Include tests for new behavior and failure paths.
- Do not include source photographs, videos, provider transcripts, credentials,
  or generated project data.
- Preserve third-party attribution when changing vendored code.
