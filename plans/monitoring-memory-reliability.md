# Monitoring memory reliability

## Status

Complete

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

- [x] Build and deploy only the backend after active tasks settle.
- [x] Archive superseded state; compact the three task checkpoints and correct retained instructions through native task signals.
- [x] Verify mobile refund terms independently and correct any affected claim.
- [x] Observe subsequent real checks, source reads, state updates and notification behavior.
- [x] Remove temporary rollout/evaluation artifacts.

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

Production backend `2ba506c` deployed through Stack v2 `73f0c7a` on October29. HTTPS health passed; web/execution/egress/PostgreSQL/Google MCP container IDs unchanged. Mac mini checkpoint reduced from1,398,254 to13,062 bytes with original history archived; charger checkpoint compacted and mobile checkpoint moved into persistent home, with its old path resolving to the same file. Delivered mobile messages2002/2023 reconciled once. Native reflection completed for all three threads; suggested-response extractors are absent in both observer and reflector. All four temporarily paused schedules were restored with their original cron/timezone. Fresh checks completed for all three watches. Mac mini and charger returned silent outcomes after current web/browser research; mobile completed after a targeted correction to stop rewriting provider-local source IDs. No duplicate notifications were published. All three repaired task runs were idle at acceptance.

Mac mini working state is about 14 KB after its fresh check, versus 1.4 MB before recovery. Original task checkpoint history (about 1.4 MB) remains archived as task data. Mobile retains seven delivered-notification records and the December 9 stop rule. Native MCP catalog remains 85 tools; backend health passed with zero restarts and about 414 MiB memory during validation.

Temporary operator/evaluation files and private rollout plans were removed. The unreferenced prior backend image (2.74 GB logical size; about 4.7 MB exclusive layers) was removed after all-container reference checks. Active service images, persistent volumes and shared build caches remain. Monitoring behavior remains model-driven; the fixture and observed runs validate this rollout, not every future source or compaction outcome.
