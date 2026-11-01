# Compact worker results

## Status

Done

## Goal

Keep nested worker tool results out of Task history and downstream delegation results.

## Current Behavior

Task uses native Mastra delegation and a tool-result processor to remove `subAgentToolResults`. Answer text, thread/resource references, pending calls and other completion metadata are preserved. Worker history remains available in its own thread.

## Milestones

### 1. Compact delegation results

- [x] Add the Task output processor using the supported message-list update hook.
- [x] Validate native delegation streaming and persisted parent/worker histories.
- [x] Run backend build and lint and update architecture documentation.

Exit: parent results exclude nested payloads while worker history and delegation lifecycle behavior remain intact.

## Tests

Extend native worker integration coverage with a large synthetic image result and assert compact parent results, persisted history and preserved worker evidence. Check pending-call metadata and unrelated tool passthrough.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
TEST_DATABASE_URL=postgresql://pal:pal@127.0.0.1:15433/pal_suggested_replies_test npx vitest run test/task-workers.spec.ts test/compact-worker-result.spec.ts
```

## Overall Exit Criteria

- Checks pass and the change is committed locally.
- No production restart, deployment or historical data rewrite. Screenshot retention inside workers is deferred.

## Validation

Backend build and lint/boundary checks pass. Both focused tests pass against the existing development test database with isolated schemas removed afterward. Native result streaming and persisted parent history exclude nested worker payloads; worker history, pending-call metadata, references, unrelated results, concurrent delegation and failure/abort cleanup are verified.
