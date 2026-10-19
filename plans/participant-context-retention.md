# Participant Context Retention

## Status

Done

## Goal

Preserve Main and Task destinations across memory processing, follow-ups, publication, delegation, and schedule creation; deploy the validated fix.

## Current Behavior

Mastra runs memory processors before agent-configured processors. Observational memory can move live input signals to history before routing reads them. DeliveryMemory captures destinations through the memory input-processor extension before native memory processing. Existing request context survives empty steps and fresh processor state. Worker memory remains unchanged.

## Milestones

### 1. Capture and retain routing

- [x] Reproduce missed follow-up destinations with native observational memory.
- [x] Capture live signals before native memory processing for Main and Task.
- [x] Preserve existing context when processor state is fresh.
- [x] Validate memory/follow-up and task/schedule behavior.

Exit criteria: targeted regression, runtime, and integration tests pass; no routing from recalled history.

### 2. Deploy

- [x] Build, back up database and persistent files, deploy, and verify.

Exit criteria: tested code runs with preserved data and healthy services.

## Tests

- Existing Main follow-up/restart test with observational memory enabled.
- Shared processor retains seeded context across empty steps.
- Existing Task delegation/schedule tests and secondary delivery integration.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/participant-delivery.spec.ts test/main-session.spec.ts test/task-agents.spec.ts
npx vitest run --config vitest.config.e2e.ts test/secondary-adapter.e2e-spec.ts
```

## Overall Exit Criteria

- [x] Confirmed participant-context loss is fixed, validated, committed, and deployed.
- Scheduled recipients joining interactive work and registration before failed preparation retain their current behavior.
- No agent tools or guidance change.

Validation: backend build and lint/boundary checks pass. Eleven participant/Main/Task tests pass with observational memory enabled in native follow-up and schedule cases; three secondary delivery integration tests pass when run sequentially against the shared test database.

## Deployment

Private deployment required no migration. Routing/memory/session identity, service health, API, desktop, frontend, SSE, and startup-log checks pass.

Record invariants match the verified pre-deployment backup, and private rollback checks pass. No live Telegram test messages were sent, and missing historical messages were not replayed.
