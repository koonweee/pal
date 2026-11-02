# Admission-only device turns

## Status

Planned

## Goal

Simplify desktop and Android coordination in development. The host grants FIFO permission to start tool calls. Ending a turn rejects new calls from that execution and admits the next owner immediately; previously dispatched work may continue. Agents inspect and recover current UI state.

## Current Behavior

- `InteractionCoordinator.finish()` drains pending operations; uncertain actions can disable a device until backend restart.
- Desktop commands add a second native lock/deadline layer. Adapters classify failures for fencing; activity contracts expose that state.
- Production worker composition and exclusive dev acceptance already exist; reuse them.

## Target Data Shape

Remove the fencing-specific resource `unavailable` field and `pal.interaction.unavailable` event. Regenerate OpenAPI/frontend contracts. No database migration or new model-facing tools, parameters or configuration.

## Milestones

### 1. Simplify admission and adapters

Implementation tasks:

- Release ownership immediately on completion, failure, cancellation or parent termination. Remove device-operation drain barriers and deferred finalization; retain rejection of retired executions and ordinary ordering within an active turn.
- Remove persistent device fencing, uncertainty callbacks/classification, desktop `flock` and stacked handoff deadlines, and the fencing-only pre-dispatch error type. Keep ordinary tool timeouts and connection cleanup.
- Preserve FIFO, independent devices, one-device binding, nested private-call admission, user-submission queueing, private-target validation and secret isolation. Keep actual adapter fixes and normal application persistence/shutdown.
- Ensure late results/errors cannot release a newer owner or blindly clear a replacement connection. Do not automatically replay unconfirmed fills.

Exit: focused tests prove immediate handoff with unresolved old work, rejection of new old-execution calls, and continued admission after tool failures.

### 2. Align guidance, contracts and dev acceptance

Implementation tasks:

- Put minimal shared turn-taking/inspection guidance in the existing Task/worker instruction source. Remove stale Android busy-blocker guidance; preserve agent cleanup responsibilities.
- Remove fencing-specific activity/API/telemetry state and regenerate clients. Update architecture and affected smoke assertions to describe admission-only ownership.
- Replace drain/fence-only tests; preserve FIFO, private-entry and known-defect regressions. Rebuild the existing dev stack and run exclusive desktop, Android and synthetic private-entry acceptance.
- Record observed failures, fixes and any evidence-backed proposals. Add no watchdog, priority, automatic tab cleanup or recovery framework. Clean task artifacts, restore healthy dev services, update plan status and commit locally. No production deployment.

Exit: automated and native dev checks pass under the new contract, with concise evidence and no leftover task resources.

## Tests

- A has an unresolved operation; A ends; B acquires immediately. New A calls fail; A's late success/error cannot alter B's ownership. Reuse cancellation/FIFO coverage.
- Failed desktop/Android/private calls report errors without disabling later turns. Private-field validation and safe failure reporting remain intact.
- Existing production-wired dev scenarios verify contention, current-screen takeover, tab cleanup and private-entry continuation; assert no guarantee that old work has finished.

## Validation Commands

- Backend: `npm run build`, `npm run lint`, targeted tests, `npm test`, `npm run test:e2e`, `npm run openapi:check`.
- Frontend: `npm run api:generate`, `npm run api:check`, `npm run check`, focused unit/activity tests, `npm run check:ui`, `npm run trim`.
- Repository root: `./scripts/dev-local rebuild`, `interaction-smoke`, `android-smoke`, `android-secure-smoke`, and `status` through that script. Use disposable test storage and existing exclusive acceptance windows.

## Overall Exit Criteria

- Only the current owner can start new device calls; turn end does not await remote settlement or require backend restart after an uncertain outcome.
- FIFO and private-entry workflows remain functional; model guidance owns takeover and cleanup decisions.
- Obsolete code, tests and contract fields are removed. Validation, documentation, cleanup and local commits are complete; production is untouched.
