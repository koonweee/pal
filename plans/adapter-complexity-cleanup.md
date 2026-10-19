# Adapter Complexity Cleanup

## Status

Done

## Goal

Reduce adapter reliability machinery to the smallest behavior required for the current single-owner deployment while preserving safe external-send retries, input idempotency, destination policy, and provider quote mappings.

## Current Behavior

- Delivery jobs durably checkpoint every provider-accepted part so a later safe failure can resume remaining parts.
- Agent handoff has a persistent four-state record in addition to canonical message idempotency.
- Secondary driver registration and provider state are split between a registry and a host service.
- Messages persist a `notify` boolean that duplicates whether `notificationDestinationIds` is nonempty.
- `npm run lint` includes a focused adapter-boundary check implemented in `scripts/check-boundaries.mjs`.

## Target Data Shape

- Drop `delivery_jobs.accepted_references`, `agent_submissions`, and `messages.notify`.
- Keep destination-specific `delivery_jobs.notify`, which snapshots the send effect for that job.
- Outgoing provider references are written after a send attempt returns. Any failure after one part was accepted is uncertain and is not retried.

## Milestones

### 1. Simplify Runtime Boundaries

Implementation tasks:

- [x] Return accepted external references in the driver outcome and classify partial delivery as uncertain.
- [x] Merge secondary driver registration and adapter state access into one host.
- [x] Replace durable agent-handoff state with process-local safe-retry eligibility for definite pre-acceptance failures.
- [x] Derive message `notify` in views and remove it from persisted policy results.

Exit criteria:

- Known-safe failures before any acceptance retry; partial or ambiguous sends never retry.
- Duplicate canonical submissions do not rerun accepted work; definite failures can retry during the same process.
- One documented host owns driver registration and opaque provider state.

### 2. Remove Persisted State and Validate

Implementation tasks:

- [x] Generate and test the cleanup migration.
- [x] Update architecture, completed adapter documentation, fixtures, and boundary-checker purpose.
- [x] Run relevant backend and playground checks.
- [x] Deploy with backups and push.

Exit criteria:

- Removed state is absent from schema and runtime imports.
- Current adapter and first-party behavior passes the minimal relevant suites.

## Tests

- Delivery retry coverage for safe pre-acceptance failure, partial delivery uncertainty, and restart uncertainty.
- Chat API coverage for same-process definite handoff retry and duplicate accepted input.
- Existing secondary, Telegram, destination, client-contract, and playground suites.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e

cd ../frontend-playground
npm run build
npm test
```

## Overall Exit Criteria

- [x] The four identified complexity issues are removed without weakening agreed deterministic routing or uncertain-send safety.
- [x] Documentation states that the boundary script is an architecture lint check and describes its scope.
- [x] Relevant checks pass and the deployed data survives migration.

## Complexity Review

The cleanup deletes the accepted-part checkpoint service, the separate driver registry, and the durable agent-submission repository. Source changes remove a net 189 lines while adding focused partial-delivery and uncertain-handoff coverage. The remaining durable delivery job is justified because canonical publication and external sending cross a process/provider boundary. Provider input deduplication, polling offset state, destination identities, and external quote mappings each serve current Telegram or client behavior.

Message `notify` remains in the public view as a derived compatibility field and in each delivery job as the destination-specific send effect. Neither duplicates message persistence. The boundary checker remains a focused architecture lint step and documents its static-import scope.

## Validation

Backend build and type-aware lint pass, including architecture lint. All 29 service/runtime tests and 21 database-backed end-to-end tests pass. The playground production build and all 21 Playwright tests pass.

Private deployment applied migration 0012 after verified backups. Service health, API, frontend, desktop, SSE, record invariants, removed columns/tables, and tested-code identity checks pass.

Backups are under ignored `backend/data/backups/deploy-20261009-adapter-cleanup/`; rollback image `pal-local:pre-adapter-cleanup-20261009` retains the previous deployment. Telegram remains disabled because development credentials are not configured, and no live message was sent.
