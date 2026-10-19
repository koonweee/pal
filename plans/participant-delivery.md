# Participant delivery

## Status

Done

## Goal

Deliver to canonical channels and accumulated secondary participants; notify participants on final answers. Keep routing deterministic and lifecycle tracking approximate.

## Current Behavior

Sources and logical channels are defined in `backend/src/chat/message-delivery.ts`. Native input processors previously suppressed mixed destinations. Transport adapters and concrete platform addresses are not implemented.

## Target Data Shape

Keep `deliveryChannels`; add `notificationChannels`. `notify` summarizes whether any destination should notify. Canonical channel roles are code configuration. No model controls are added.

## Milestones

### 1. Routing and persistence

- [x] Accumulate participants across Main and Tasks using shared in-memory state.
- [x] Reset on new input after 60 seconds of idle; retain saved schedule routing.
- [x] Derive canonical delivery and per-channel notification metadata; migrate existing records.

Exit: outputs reflect participants at publication time; commentary is quiet; persistence and SSE agree.

### 2. Validation and complexity review

- [x] Test accumulation, idle boundaries, schedule isolation, API metadata and restored history.
- [x] Update architecture contracts and review complexity.
- [x] Deploy after validation.

Exit: focused tests, build and lint pass; deployment is verified.

## Tests

Use deterministic activity/processor checks plus existing native Main/Task and chat API suites. No additional model evaluation is needed because model output is unchanged.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/participant-delivery.spec.ts test/main-session.spec.ts test/task-agents.spec.ts test/file-agents.spec.ts
npx vitest run --config ./vitest.config.e2e.ts test/chat.e2e-spec.ts
```

## Overall Exit Criteria

Routing and notification policy is enforced in host code, documented at its seam, and validated. No lifecycle registry, timers, or model choices are introduced. Transport adapters and platform reply mappings remain deferred.

## Complexity Review

The participant tracker is 37 lines and uses one shared Set plus a last-input timestamp. AgentActivityService adds an idle timestamp to its existing busy/idle transitions. Native processors keep a reference to the set; replacing it isolates older publications. Scheduled executions use a separate saved snapshot until steered. This is the only meaningful branching in routing.

There are no timers, background cleanup, lifecycle registries, per-task participant maps, or model controls. Per-channel notification persistence and the migration are necessary to represent quiet canonical copies. Repeated channel decoding is shared across the three host metadata boundaries. Failure publications use a small shared helper to keep their routing consistent.

Tradeoffs: state resets on restart; close unrelated requests share participants; an unreported handoff lasting over 60 seconds can split activity. The grace period also waits 60 seconds after the latest input, covering intake before Working begins. This implementation supports the existing single owner and logical channel enum. Transport addresses, additional providers, and multi-owner routing are deferred.

## Validation

Backend build, type-aware lint, frontend production build, and 18 focused tests pass. Coverage includes native active-input accumulation, sharing with Task runs, quoted-source isolation, schedule persistence/restart and failure routing, idle/reset boundaries, historical migration backfill, source validation, and history/SSE notification metadata. Model tools and output schema are unchanged.

Private deployment applied migration 0009 after verified backups. API, frontend proxy, desktop, service health, tested-code identity, and record-invariant checks pass; no live test messages were sent.
