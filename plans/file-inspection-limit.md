# Shared File Inspection Limit

## Status

Done

## Goal

Allow native image/PDF inspection of every file size accepted by uploads, using the same MAX_FILE_BYTES definition.

## Current Behavior

- Upload and generated-file storage enforce MAX_FILE_BYTES = 25,000,000.
- Main, tasks, and workers share one native workspace with configurable read_file media size handling.

## Milestones

### 1. Share and Validate the Limit

Implementation tasks:

- [x] Configure native read_file maxMediaBytes from the existing upload constant.
- [x] Update agent guidance and documentation to describe the shared limit.
- [x] Extend existing native workspace coverage to read media at the limit and return metadata above it.
- [x] Run relevant backend build, lint, and native-agent checks.
- [x] Rebuild and restart the local backend and verify readiness.

Exit criteria:

- All agents use the shared native reader configuration; files at the upload limit return media and larger workspace files return metadata.
- Relevant checks pass and the local runtime uses the new configuration.

## Tests

Extend the existing native workspace test with boundary file reads; reuse Main/task file delegation and retry coverage.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/main-session.spec.ts test/file-agents.spec.ts
```

## Overall Exit Criteria

- Upload, generated-file import, and native image/PDF inspection use the same size definition.
- Native inspection at the limit succeeds; above-limit reads retain the dependency's metadata fallback.
- Agent guidance, architecture, and the local runtime reflect the shared limit.

## Validation Results

- Backend build, type-aware lint, formatting, and diff checks passed.
- Main and file-agent suites passed: 2 suites, 8 tests. Native read_file returned exact media bytes at 25,000,000 bytes and metadata at 25,000,001 bytes. The boundary check uses a direct byte comparison to avoid expanding large buffers through the test framework.
- The local backend image was rebuilt and restarted. Backend and live playground API readiness checks passed.
- The disposable PostgreSQL container and abandoned boundary fixture were removed.

## Remaining Work

None. Milestone and overall exit criteria are validated.
