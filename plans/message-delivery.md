# Message Sources and Delivery

## Status

Done

## Goal

Persist input origins and assistant delivery intent while retaining canonical history and SSE. Use model testing to select the output contract. Commentary never notifies. External provider adapters remain deferred.

## Current Behavior

Sources and model output follow this plan. Current accumulated-participant routing and per-channel notifications are specified in [participant delivery](participant-delivery.md) and [backend architecture](../architecture/backend.md#message-origin-and-delivery-intent). Transport adapters remain deferred.

## Target Data Shape

- `POST /chat/messages`: optional source enum, included in normalized idempotency. Omission and explicit `api` are equivalent.
- `messages`: nullable source, JSON delivery_channels array, boolean notify. Migration 0008 backfills old user sources to api and leaves existing messages non-notifying with no extra delivery.
- History and SSE expose source, deliveryChannels, and notify. Database constraints enforce valid origins, role/channel relationships, and notification phases.
- Model schema: `{ text, replyTo, attachmentIds, files }`. There are no model notification or delivery-channel fields or send tool. Persisted API notification fields remain backend-owned.
- Native schedule attributes store a serialized channel snapshot. Provider addresses and recipient identities remain outside the public message contract.

## Milestones

### 1. Evaluate Structured Delivery Output

Implementation tasks:

- [x] Run ten declared scenarios once each through the configured model, native schema, and publication processor with fixture tools.
- [x] Retain every result and distinguish syntax, intent, and fixture failures.
- [x] Select backend-owned channels and model notification intent, without formatting retries or additional production logging.

Exit criteria:

- [x] Record the selected contract and supporting evidence below.

### 2. Implement the Selected Contract

Implementation tasks:

- [x] Add message fields, migration, API validation, normalized idempotency, and history/SSE views.
- [x] Carry backend routing through Main, Task delegation, and native schedule persistence.
- [x] Enforce quiet commentary in the service and database, with shared Main/Task notification guidance.
- [x] Update playground types/submission and architecture contracts.

Exit criteria:

- [x] Sources and delivery intent persist, commentary cannot notify, and overlapping destinations do not silently redirect existing work.

### 3. Validate

Implementation tasks:

- [x] Extend API/SSE, native active-run/restart, Task/schedule, and attachment-recovery regressions.
- [x] Run the simplified actual-model cases and native Main/Task lifecycle smoke.
- [x] Run backend build/lint/tests, playground build, and focused browser coverage.

Exit criteria:

- [x] Validation passes with fixture and external-delivery limits recorded.

### 4. Separate Reference Context and Deploy

Implementation tasks:

- [x] Keep sourceMessageRef independent of delivery routing; retain referenced context and files.
- [x] Put the approved mixed-input policy beside its resolution branch.
- [x] Document valid canonical reply references that are absent from a destination client; delivery proceeds without native threading when there is no mapping.
- [x] Validate the cross-source reference regression and relevant checks.
- [x] Back up the running deployment, apply migration 0008, rebuild/recreate Pal, and verify health and data preservation.
- [x] Commit and push the validated session changes to origin/main.

Exit criteria:

- [x] Referencing an older Telegram input preserves the current iOS delivery context.
- [x] The deployed runtime and playground expose the new contract, and origin/main contains the change.

### 5. Minimize Model Controls

Implementation tasks:

- [x] Remove model notification fields, runtime plumbing, and notification instructions; derive publication policy in ChatService.
- [x] Add repository policy aggressively minimizing model-facing choices that do not require model judgment.
- [x] Validate current schema, phase-derived notifications, legacy output, and native runtime behavior.
- [x] Deploy and push the validated simplification under the existing authorization.

Exit criteria:

- [x] Legacy model notify:false cannot suppress a final answer's notification intent; commentary remains quiet.
- [x] Current model guidance and architecture describe backend-owned policy; the deployed build and origin/main contain the simplification.

## Mixed-input Delivery Policy

Mixed inputs accumulate participants across interactive Main and Task runs. The idle approximation and current validation live in [participant delivery](participant-delivery.md). The implementation seams are `backend/src/agent/delivery-participants.ts` and `backend/src/agent/delivery-context.processor.ts`.

## Tests

- Ten candidate model cases: Main default, Task default, Telegram override, multiple channels, quiet answer, history only, commentary/tool/final, attachment override, delegation, silent schedule.
- Five selected-contract cases: Main default, Task default, quiet answer, commentary/tool/final, silent schedule.
- Native lifecycle smoke: Main and Task commentary/tool/final, explicit quiet final, unchanged schedule, and changed source after restart.
- Existing integration suites cover source/idempotency, persisted history/SSE fields, commentary enforcement, active mixed-client inputs, delegation, schedule snapshots/restart, and quiet attachment failure recovery.

## Validation Commands

```bash
cd backend
npm run build
npm run agent:smoke
npm run lint
npm test
npx vitest run --config ./vitest.config.e2e.ts
npx vitest run test/file-agents.spec.ts
cd ../frontend-playground
npm run build
PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=5186 npm test -- --grep 'reconciles snapshots'
```

## Validation Evidence

The earlier model-controlled candidates below are retained as historical experiment evidence. Milestone 5 removes those options from the current contract.

2026-10-09, using configured gpt-6.1-sol and existing OAuth. All model runs use fixture data and captured publications, with no live messages, provider deliveries, or production database changes.

| Run | Result | Evidence under backend/data/delivery-output-evals |
| --- | --- | --- |
| Channel-selection candidate | 9/10 intent checks, 14 provider calls; every emitted block parsed. “Here quietly” selected [] instead of retaining delivery with notify:false. | 2026-10-08T16-58-39.609Z.json |
| Backend-owned channels, notify-only model output | 5/5 cases, 7 provider calls. Quiet output used notify:false; unchanged scheduled check stayed silent. | 2026-10-08T17-04-45.429Z.json |
| Native lifecycle setup attempt | Failed before inference because the concurrently running build was replacing dist instruction files. | runtime-smoke.log |
| Native lifecycle rerun after compilation | Passed; 8 native JSON provider calls, six publications. Main/Task destinations and quiet intent persisted through the publication path; restart used the new source. | runtime-smoke-02.log |

The candidate failure is an intent distinction, not malformed JSON. Given the approved simplification, channel choice remains backend-owned instead of adding model correction machinery. These bounded fixtures support the selected contract; they do not estimate a production failure rate. One runtime commentary block omitted notify and used the supported backend default.

Backend build and type-aware lint pass. All 21 service/runtime tests and 11 end-to-end tests pass. The subsequently extended attachment-recovery regression passes independently and final lint passes. Playground typecheck/build and the focused submission/SSE/reload browser test pass. Migration 0008 was applied only to the test database during integration tests. The first playground compile identified missing fields in its typed fixture; the corrected fixture and source assertion pass. Git diff whitespace checks pass.

Deployment validation on 2026-10-09: the reference-isolation regression passes with an older Telegram message and current iOS destinations; referenced context is still forwarded. All eight focused Main/Task lifecycle tests and type-aware lint pass. The mixed-input policy is documented at its processor resolution branch and above. The client contract documents missing local/platform reply targets in architecture/backend.md.

Migration 0008 is applied to the local Compose deployment. Service health, API, frontend proxy, desktop, history fields, live source attribution, tested-code identity, and record invariants pass.

Validated PostgreSQL and persistent-data backups are in ignored `backend/data/backups/deploy-20261009-message-delivery/`. Docker could no longer resolve the old image content after rebuilding, so the rollback image `pal-local:pre-message-delivery-20261009` was rebuilt from unchanged committed baseline `1411d1d` before stopping the old runtime. No live test message or external provider delivery was sent.

Commit `eaa754b` contains the deployed implementation and client contract, verified pushed to the private origin/main repository.

Milestone 5 validation on 2026-10-09: backend build and type-aware lint pass; nine focused native Main/Task/file tests and six chat API tests pass. Legacy model notify:false is ignored through attachment-recovery publication. One real-model native lifecycle attempt passes with seven provider calls, five publications, a silent unchanged check, and routing after restart; every provider schema excludes notify. Evidence: `backend/data/delivery-output-evals/no-notify-runtime-smoke.log`.

Milestone 5 private deployment passes service health, API, frontend proxy, desktop, schema, parser, tested-code identity, record-invariant, backup, and rollback checks. No migration or live message was required.

Milestone 5 implementation and repository policy are pushed to origin/main in commit `3d7b07c`.

## Deferred Work

- Telegram, iOS push, and web push adapters, device/recipient bindings, durable delivery jobs, and external retry semantics.
- Model-selected destinations, cross-person/group recipients, and destination preference configuration.
- Live external-provider delivery.

## Overall Exit Criteria

- [x] Actual-model evidence determines the selected output contract.
- [x] Sources and backend delivery intent are durable and validated; history/SSE stay independent of external delivery.
- [x] Commentary always has notify:false.
- [x] Focused checks pass and current documentation states the routing and provider limits.
