# Attachment Inspection Guidance

## Status

Done

## Goal

Main and Task inspect relevant user attachments by default before making content claims. Preserve explicit no-read requests, copy/resend operations, prior inspection of unchanged files, and Main's prompt delegation of substantial work. Push and deploy the validated session file-handling changes.

## Current Behavior

- Agents receive file metadata and local paths embedded in incoming and quoted messages.
- Main has native read-only inspection; Task and workers have full native workspace access.
- Inspection is instructed model behavior. The harness provides access and validates file delivery.

## Milestones

### 1. Guidance and Validation

Implementation tasks:

- [x] Strengthen Main and Task file guidance with default inspection, exceptions, and clear reporting when reading fails.
- [x] Preserve Main delegation and task worker inspection.
- [x] Update current architecture and README guidance.
- [x] Extend the existing real-model smoke with a direct question about uploaded PDF/image contents before delegation.
- [x] Validate build/lint, relevant suites, playground build, and real-model file smoke.

Exit criteria:

- Main answers a simple file-content question using native inspection without an explicit tool instruction.
- Tasks retain delegated inspection and generated-file delivery, including quoted-message files.

### 2. Push and Deployment

Implementation tasks:

- [x] Commit the authorized session changes and push main to origin.
- [x] Build and recreate the documented Compose runtime with persistent data and current migrations.
- [x] Verify backend/playground readiness and deployed instruction assets.
- [x] Remove disposable validation resources.

Exit criteria:

- Origin/main matches the local commit; the local deployed runtime includes the validated guidance and file flow.

## Tests

Reuse the native file and existing real-model smoke coverage; avoid prompt wording assertions. Reuse file/chat HTTP suites and playground file checks for the session changes being published.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
npm run files:smoke
cd ../frontend-playground
npm run build
npm test -- test/chat.spec.ts --grep 'uploads mixed|preserves selected|delegates into task'
```

Database checks use a disposable PostgreSQL instance. The real-model smoke uses the configured ChatGPT login and its own temporary database and filesystem.

## Overall Exit Criteria

- Guidance requires relevant-file inspection before content claims and states the agreed exceptions.
- Main can delegate substantial inspection and Task can rely on worker findings.
- Validation passes, origin/main contains the session changes, and the documented local deployment is healthy with updated instruction assets.

## Validation Results

- Backend build, type-aware lint, formatting, and diff checks passed.
- Full backend service/native-agent checks passed: 9 suites, 19 tests. File/chat HTTP checks passed: 2 suites, 9 tests.
- Playground build and three targeted browser checks passed, covering task switching, mixed-file upload/preview/download, and selected-file retry.
- The configured-model smoke passed: Main answered a direct PDF/image question using native inspection without a tool instruction; a task used a native worker for independent verification, delivered generated document/image files, compressed memory, restarted, and reopened the original document. Prior output bytes remained identical.

- Session changes were committed and pushed to the verified private origin/main repository as af910ea.
- The local Compose application was rebuilt and recreated with persistent volumes. Database migration, backend/playground API readiness, and task details checks passed. Deployed Main/Task instruction hashes match the validated source assets.
- Disposable validation databases, temporary smoke files, and the PostgreSQL validation container were removed.

## Remaining Work

None. Milestone and overall exit criteria are validated.
