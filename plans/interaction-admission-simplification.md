# Admission-only device turns

## Status

Done

## Goal

Simplify desktop and Android coordination in development. The host grants FIFO permission to start tool calls. Ending a turn rejects new calls from that execution and admits the next owner immediately; previously dispatched work may continue. Agents inspect and recover current UI state.

## Current Behavior

- `InteractionCoordinator` grants independent FIFO desktop and Android turns and releases them immediately at execution end.
- Ordinary adapter timeouts bound calls. Failures permit later turns, and retired executions cannot start new calls.
- Production worker composition and exclusive dev acceptance use the same admission contract.

## Target Data Shape

Remove the fencing-specific resource `unavailable` field and `pal.interaction.unavailable` event. Increment the existing first-party contract version to 8 for the removed required field; regenerate OpenAPI/frontend contracts and refresh dev clients. No database migration or new model-facing tools, parameters or configuration.

## Milestones

### 1. Simplify admission and adapters — Done

Implementation tasks:

- Release ownership immediately on completion, failure, cancellation or parent termination. Remove device-operation drain barriers and deferred finalization; retain rejection of retired executions and ordinary ordering within an active turn.
- Remove persistent device fencing, uncertainty callbacks/classification, desktop `flock` and stacked handoff deadlines, and the fencing-only pre-dispatch error type. Keep ordinary tool timeouts and connection cleanup.
- Preserve FIFO, independent devices, one-device binding, nested private-call admission, user-submission queueing, private-target validation and secret isolation. Keep actual adapter fixes and normal application persistence/shutdown.
- Ensure late results/errors cannot release a newer owner or blindly clear a replacement connection. Do not automatically replay unconfirmed fills.

Exit: focused tests prove immediate handoff with unresolved old work, rejection of new old-execution calls, and continued admission after tool failures.

### 2. Align guidance, contracts and dev acceptance — Done

Implementation tasks:

- Put minimal shared turn-taking/inspection guidance in the existing Task/worker instruction source. Remove stale Android busy-blocker guidance; preserve agent cleanup responsibilities.
- Remove fencing-specific activity/API/telemetry state and regenerate clients. Update architecture and affected smoke assertions to describe admission-only ownership.
- Replace drain/fence-only tests; preserve FIFO, private-entry and known-defect regressions. Rebuild the existing dev stack and run exclusive desktop and synthetic browser private-entry acceptance. Native phone acceptance is waived by the user (2026-11-02).
- Record observed failures, fixes and any evidence-backed proposals. Add no watchdog, priority, automatic tab cleanup or recovery framework. Clean task artifacts, restore healthy dev services, update plan status and commit locally. No production deployment.

Exit: automated and native dev checks pass under the new contract, with concise evidence and no leftover task resources.

Validation:

- Backend: build, lint, OpenAPI check, 96 service tests and 43 E2E tests pass. Frontend: generated-contract/type checks, 40 unit tests, activity browser test, UI ownership and trim pass.
- Exclusive dev desktop acceptance passes: ten FIFO waiters, immediate cancellation handoff, retired-call rejection and browser private filling after an intervening turn. Native workers verify temporary-tab cleanup and preserve the pre-existing tab. Runs: `af2823d9-ed17-4bff-a962-88723b32ac51`, `3ae96fe8-8f66-49aa-9ffc-06bd3549014a`.
- Rebuilt dev services and staged PWA are healthy; the staged browser connects using contract 8. Physical-phone acceptance is waived by the user (2026-11-02); Android automated regressions pass.
- Disposable test databases, runner, lock and test-result file are removed. Superseded task image tags are absent. Shared dev images/data (~10.5 GB) and reusable build cache (~17.8 GB) are retained. No production changes or additional recovery framework is needed.

## Tests

- A has an unresolved operation; A ends; B acquires immediately. New A calls fail; A's late success/error cannot alter B's ownership. Reuse cancellation/FIFO coverage.
- Failed desktop/Android/private calls report errors without disabling later turns. Private-field validation and safe failure reporting remain intact.
- Existing production-wired desktop dev scenarios verify contention, current-screen takeover, tab cleanup and browser private-entry continuation; assert no guarantee that old work has finished. Android/private-phone behavior retains automated regression coverage; physical-phone checks are waived.

## Validation Commands

- Backend: `npm run build`, `npm run lint`, targeted tests, `npm test`, `npm run test:e2e`, `npm run openapi:check`.
- Frontend: `npm run api:generate`, `npm run api:check`, `npm run check`, focused unit/activity tests, `npm run check:ui`, `npm run trim`.
- Repository root: `./scripts/dev-local rebuild`, `interaction-smoke --desktop-only`, `pwa-up` and `status` through that script. Use disposable test storage and existing exclusive acceptance windows. Physical-phone acceptance is waived.

## Overall Exit Criteria

- Only the current owner can start new device calls; turn end does not await remote settlement or require backend restart after an uncertain outcome.
- FIFO and private-entry workflows remain functional; model guidance owns takeover and cleanup decisions.
- Obsolete code, tests and contract fields are removed. Validation, documentation, cleanup and local commits are complete; production is untouched.
