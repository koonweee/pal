# Markdown List Guidance

## Status

In Progress

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
- [ ] Deploy production through its existing Komodo workflow and verify deployed guidance and health.

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
- [ ] Focused validation passes and the change is committed.
- [ ] Development and production are healthy with matching deployed guidance.

## Validation

Backend build and both existing Markdown renderer tests pass. Built Main/Task instructions contain the shared rule; private interaction workers do not load public texting guidance.

Development rebuild succeeds; Vite/API and staged PWA/API are healthy, the deployed guidance matches source, and execution identity/start time are unchanged.

## Remaining Work

Production uses Git-backed Komodo Builds and requires source/deployment pushes to `main`. Scoped commits, pushes and production deployment are approved. Production is healthy and idle, its container identities are recorded privately, and the existing builder is ready with no linked deployments. Commit/push the reviewed source, publish immutable backend/web images, update deployment pins and release identity, then deploy only agent-service/web with the existing service filter and verify retained container identities. Preserve the prior `236cc84` backend/web pins for rollback.
