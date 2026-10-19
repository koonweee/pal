# Citation Normalization

## Status

Done

## Goal

Deliver readable source links across public messages and Worker findings; remove unresolved provider citation markers.

## Current Behavior

The shared model stream normalizes each completed text block using provider citation annotations. Existing links remain intact. API message shape and client renderers are unchanged.

## Milestones

### 1. Implement and validate

- [x] Normalize exact annotated marker spans into safe Markdown links, including JSON strings and message arrays.
- [x] Strip unresolved markers with diagnostic counts.
- [x] Verify shared model streaming covers Worker findings and structured public output.

Exit criteria: targeted regression tests, build, and lint pass.

### 2. Deploy

- [x] Commit and deploy at idle; verify service health and deployed assets.

Exit criteria: tested implementation is live.

## Tests

Normalization tests cover annotations, existing links, invalid offsets/URLs, Unicode offsets, JSON arrays, and unresolved markers. A mocked native model stream verifies normalized text reaches the consumer.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/citations.spec.ts test/chatgpt-model.spec.ts
npm run lint
```

## Overall Exit Criteria

- [x] Public replies and Worker findings share citation handling, without client or database changes.

## Validation

Build, lint, and five focused tests pass. Native Mastra streaming tests verify plain Worker-style results and structured message arrays, including the public publication processor. Tests cover JSON escaping, Unicode offsets, unsafe URLs, multiple sources, existing links, and unresolved markers.

## Deployment

Implementation commit `4bff38b` is deployed. API, Playground, and desktop health checks pass; deployed citation and model modules match the tested build. Application and Telegram startup checks report no errors. The validated database backup is in ignored `backend/data/backups/deploy-20261010-citations/`; the previous image is tagged `pal-local:pre-citations-20261010`. No schema migrations or user-facing test sends were needed.
