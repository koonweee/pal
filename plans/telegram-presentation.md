# Telegram Presentation

## Status

Done

## Goal

Deliver multi-image responses as albums and ordinary Markdown as native Telegram formatting.

## Current Behavior

Telegram owns deterministic Markdown rendering, photo grouping, captions, and provider reference mapping. Splitting is specific to Pal's automatic delivery contract. No agent tool or guidance changes are required.

## Milestones

### 1. Rendering and albums

- [x] Adapt the renderer with readable unsupported-syntax fallbacks and entity-aware splitting.
- [x] Group consecutive photos in batches of ten, use short captions, and retain all message IDs.
- [x] Inspect the acked2 case: its target is incoming Telegram message 24, covered by the prior reply fix.
- [x] Validate formatting, album boundaries, reply parameters, failure behavior, and integration.

Exit criteria: targeted tests and build/lint pass; content and reference identity survive provider splitting.

## Tests

- Markdown entities, emoji offsets, unsupported syntax, code nesting, and chunk boundaries.
- Six-photo album and eleven-photo boundary, caption/reply/notification fields, and returned references.
- Long captions, mixed files, and partial delivery failure.
- Existing secondary ingress/delivery regression suite.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/telegram-adapter.spec.ts test/delivery-retry.spec.ts
npx vitest run --config vitest.config.e2e.ts test/secondary-adapter.e2e-spec.ts
```

## Overall Exit Criteria

- [x] Local implementation and targeted verification complete; committed with current architecture documentation.
- Deployment includes the incoming-message reply fix and Telegram presentation changes. Live message checks remain separate from fixture validation.

Validation: backend build, lint/boundary checks, nine Telegram/retry tests, and three secondary integration tests pass. No live Telegram sends were performed.

## Deployment

Private deployment verification confirms healthy services, matching tested renderer/driver code, a preserved polling offset, and no Telegram intake errors during startup. No migration was required.

Before/after record invariants match, and private backup and rollback checks pass.

Startup logs include desktop accessibility warnings and a Picom backend configuration error; supervised desktop/viewer and HTTP checks pass. Live quote, album, and formatting exchanges remain unverified after deployment; no test messages were sent.
