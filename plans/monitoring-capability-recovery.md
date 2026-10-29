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
- [x] Correct retained task instructions and verify checkpoint pointers against successful artifacts.
- [x] Resume monitoring with independent source checkpoints and preserved deduplication/history.
- [x] Verify actual source reads and checkpoint advancement, then clean temporary artifacts.

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

## Production task acceptance

The existing task description, schedule prompt and persisted policy now supersede the invented exact-name requirement. Prior metadata remains in private audit history. The previous complete baseline passed 45 evidence hashes and its completion guard; stale summary pointers were reconciled without advancing source checkpoints.

The recovery run read and validated Gmail, all six calendars, Drive and Splice, committed each source checkpoint, and published a recovery report. Independent readback verified 35 evidence hashes and all four checkpoint timestamps. Historical finance/email review entries, seen-message keys and unresolved items are preserved. The existing ten-minute schedule is active. Historical rental link-detail comparison remains incomplete because prior evidence was truncated.

Temporary evaluation code (4.7 MB), recovery rollback/scratch files (about 2.5 MB), and operator scripts/private plans are removed after verification. Permanent recovery evidence, audit history and the active ledgers remain.

## Remaining release work

The backend-only release is prepared as application commit `9548fd7` with the matching local Stack v2 build pin. Automatic approval review rejected default-branch publication pending explicit user permission to push Pal and Stack v2 main. No build or deployment was executed. After permission: publish, build/verify the immutable backend image, update pins and deploy only agent-service using the existing Komodo workflow. The production-wide parser and guidance fix is not deployed yet.
