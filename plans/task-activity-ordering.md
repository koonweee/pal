# Task Activity Ordering

## Status

Done

## Goal

Order active and archived task lists by their most recent task activity so ongoing work returns to the top consistently across snapshots and live updates.

## Current Behavior

- The backend persists `lastActivityAt` and orders active and archived lists by activity and task ID, both descending.
- Task metadata changes and task-scoped messages advance activity and task version; only metadata changes update `updatedAt`.
- iOS sorts snapshots and live task revisions using the backend activity contract.

## Target Data Shape

Tasks expose `lastActivityAt`. Creation, task metadata changes, and new task-scoped messages advance it. `updatedAt` continues to describe metadata changes. Task-list pagination orders by `lastActivityAt` and task ID, both descending.

## Milestones

### 1. Add the backend activity contract

Implementation tasks:

- [x] Add and backfill `tasks.last_activity_at` from task and task-message timestamps.
- [x] Advance activity and task version atomically for task messages and metadata changes.
- [x] Publish the resulting task revision and paginate lists by activity.

Exit criteria:

- [x] Task list responses, details, and live events expose `lastActivityAt` and a task with newer activity sorts first.

### 2. Apply activity ordering in iOS

Implementation tasks:

- [x] Decode `lastActivityAt` and sort snapshots plus live task revisions by activity and ID.
- [x] Publish a verified internal build against the migrated local backend.

Exit criteria:

- [x] Initial, refreshed, and live-updated task lists show the most recently active task first.

## Tests

- One backend regression covering message activity, metadata semantics, revision advancement, and list order.
- One iOS store regression covering snapshot and live-update reordering.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- test/chat.e2e-spec.ts
cd ..
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project ios/Pal/Pal.xcodeproj -scheme Pal -destination 'platform=iOS Simulator,id=031A26CE-F844-44B7-99ED-11230B19FCF4' -derivedDataPath .local/pal-ios-tests test
```

## Overall Exit Criteria

- [x] Task activity has one backend-owned timestamp and ordering contract.
- [x] Task list pagination and live iOS ordering agree.
- [x] The local backend is migrated and an installable internal build is published.

## Progress Evidence

- 2026-10-11: Migration `0014_legal_vermin.sql` backfilled activity from task edits and messages. The migrated local backend returns the most recently active task first through its Tailscale endpoint.
- 2026-10-11: Backend build, lint, all 45 service tests, the focused nine-test end-to-end suite, and the full iOS unit/UI scheme pass.
- Signed-package verification covers the task-ordering implementation; distribution records remain private.
