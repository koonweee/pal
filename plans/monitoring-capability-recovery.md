# Monitoring Capability Recovery

## Status

In Progress

## Goal

Prevent remembered tool names and agent assumptions from blocking authorized monitoring; recover the production connected-source task.

## Current Behavior

Discovery exposes current service tools. Agent-authored exact-name constraints can conflict with that catalog. Empty text arrays fail response parsing. The production monitor retains its last successful checkpoint while aborting on a nonexistent reader.

## Milestones

### 1. Guidance and silent output

- [x] Share context-authority guidance across Main/Task.
- [x] Add capability-based discovery and independent-source monitoring guidance.
- [x] Normalize empty text arrays through existing envelope validation.
- [x] Run focused parser checks and synthetic model scenarios.

Exit criteria: parser regression passes; seeded false-name and unavailable-source scenarios produce correct reads and coverage reporting.

### 2. Production recovery

- [ ] Deploy validated backend/guidance through existing production configuration.
- [ ] Correct retained task instructions and verify checkpoint pointers against successful artifacts.
- [ ] Resume monitoring with independent source checkpoints and preserved deduplication/history.
- [ ] Verify actual source reads and checkpoint advancement, then clean temporary artifacts.

Exit criteria: healthy production with current guidance; the repaired task performs successful checks without the invented prerequisite.

## Tests

Focused public-output regressions; synthetic real-model capability recovery and source-isolation scenarios; production source/checkpoint evidence.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/public-output.spec.ts
node scripts/monitoring-recovery-smoke.mjs
```

## Overall Exit Criteria

- Guidance and parser changes are committed after validation.
- Production uses the validated changes and monitoring resumes from verified checkpoints.
- Historical audit/deduplication data remain intact; task-created temporary resources are removed.

## Validation

Backend build, lint/boundary checks, and all four public-output tests pass. Both synthetic real-model scenarios pass using production model authentication with fixture-only tools: the false remembered name resolves to the available reader; a finance failure preserves its checkpoint while Gmail/Calendar/Drive advance and one coverage report is emitted. Temporary fixture directories are removed.
