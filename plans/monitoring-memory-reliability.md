# Monitoring memory reliability

## Status

In Progress

## Goal

Keep scheduled monitoring focused on current sources and decisions across memory compaction, and repair Mac mini, charger and mobile-plan working checkpoints while retaining user constraints and delivered notification history.

## Current Behavior

Main and Task share thread-scoped observational memory. Hosted web-search metadata is sometimes treated as proof that source verification failed; summaries carry forward agent-created bookkeeping repair obligations.

## Milestones

### 1. Memory policy and regression

- [x] Share retained-context policy with observer/reflector and disable suggested responses.
- [x] Add forward-progress and compact-checkpoint Task guidance.
- [x] Force observation/reflection in a real-model fixture and verify the next check performs fresh monitoring, preserves uncertainty and closes completed bookkeeping.

Exit criteria: build/lint pass; observer/reflection and subsequent actor behavior pass focused regression.

### 2. Production rollout and task repair

- [ ] Build and deploy only the backend after active tasks settle.
- [ ] Archive superseded state; compact the three task checkpoints and correct retained instructions through native task signals.
- [ ] Verify mobile refund terms independently and correct any affected claim.
- [ ] Observe subsequent real checks, source reads, state updates and notification behavior.
- [ ] Remove temporary rollout/evaluation artifacts.

Exit criteria: healthy backend, unchanged schedules and user constraints, deduplication preserved and real monitoring progress without historical count-repair cycles.

## Tests

Real-model observer/reflection fixture with attributed hosted-search findings, genuinely unsupported claims and completed bookkeeping, followed by a fresh actor check using local fixture tools only.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
node scripts/monitoring-memory-smoke.mjs
```

## Overall Exit Criteria

Validated memory/guidance deployed; three tasks repaired and checked after rollout; original notification histories and constraints preserved.

## Validation evidence

Build and type-aware lint pass. The real-model fixture completed observation, reflection and a fresh storefront check, retained the attributed $659 finding, rejected the unsupported coupon, saved the current $649 checkpoint and did not invoke historical repair. It ran in isolated temporary SQLite storage using existing production authentication; local authentication was expired.
