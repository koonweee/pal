# Graceful Database Shutdown

## Status

Done

## Goal

Keep agent-service shutdown clean when PostgreSQL closes pooled connections during an intentional stack stop, while preserving visible and recoverable handling of unexpected database loss.

## Current Behavior

- `DatabaseService` owns the application `pg.Pool` and closes it through Nest application shutdown.
- Idle client failures are handled at the pool boundary. Planned SIGTERM or SIGINT marks shutdown synchronously before Nest's asynchronous lifecycle hooks run.
- Unexpected pool failures are logged, and `pg-pool` discards the affected client so later work can establish another connection.

## Milestones

### 1. Correlate Pool Failure and Shutdown

Status: Done

Implementation tasks:

- Handle idle client errors on the application pool.
- Suppress the expected error log after a planned stop signal without suppressing unexpected failures.
- Remove process signal listeners when the database service shuts down.

Exit criteria:

- A pool error cannot become an unhandled EventEmitter error.
- Planned shutdown pool termination is quiet; unexpected termination remains logged and leaves the pool available.

## Tests

- Cover an unexpected idle pool error and verify operational logging without a thrown error.
- Cover pool termination after the planned-stop signal and verify clean handling without an error log.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/database.spec.ts
npm run lint
npm test
```

## Overall Exit Criteria

- Intentional stack shutdown cannot exit agent-service through an unhandled PostgreSQL pool error.
- Unexpected idle connection loss remains observable and recoverable through the existing pool.

## Validation

- Backend build, focused database tests, lint and boundaries pass.
- Production release `eb9afb1` is deployed through GitOps revision `9df4c1f`. The migration exits successfully, agent-service restarts cleanly, startup contains no pool error, and health remains green.
