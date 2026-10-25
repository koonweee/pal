# Markdown List Guidance

## Status

Done

## Goal

Keep list items on separate lines in public messages by specifying Markdown list syntax in shared Main and Task guidance, and deploy it to development and production.

## Current Behavior

- Main and Task load `texting.md` at startup.
- The web Markdown renderer treats literal bullet characters as paragraph text; single newlines collapse in the browser.

## Milestones

### 1. Shared guidance

- [x] Add one Markdown list rule to `texting.md`.
- [x] Validate built Main and Task instructions and existing Markdown rendering.

Exit criteria: both public roles receive the rule and valid Markdown lists render separate items.

### 2. Deployment

- [x] Rebuild development and verify deployed guidance and health.
- [x] Deploy production through its existing Komodo workflow and verify deployed guidance and health.

Exit criteria: both environments load the new instruction with persistent execution state retained.

## Tests

Reuse the existing Markdown renderer tests and inspect composed role instructions. No new tests or model calls are required for this guidance change.

## Validation Commands

```bash
cd backend
npm run build
cd ../frontend
npm run test:unit -- test-unit/assistant-markdown.test.tsx
cd ..
./scripts/dev-local rebuild
```

## Overall Exit Criteria

- [x] Main and Task share one list-formatting rule.
- [x] Focused validation passes and the change is committed.
- [x] Development and production are healthy with matching deployed guidance.

## Validation

Backend build and both existing Markdown renderer tests pass. Built Main/Task instructions contain the shared rule; private interaction workers do not load public texting guidance.

Development rebuild succeeds; Vite/API and staged PWA/API are healthy, the deployed guidance matches source, and execution identity/start time are unchanged.

Production runs source `ec3b3d3` through infrastructure revision `efe8203`. Immutable Linux AMD64 backend/web manifests are verified; backend image guidance matches source byte for byte. HTTPS/API, matching PWA release identity, SSE and desktop WebSocket checks pass. Only backend/web containers changed; all other container identities are retained. Original Stack deployment arguments are restored, both ResourceSyncs are clean, and exact private plans are removed. All 163 existing deployment operational checks pass.
