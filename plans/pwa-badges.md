# PWA Notification Badges

## Status

In Progress: implementation and automated validation complete; physical-device acceptance pending.

## Goal

Show unseen notification-worthy Main updates on each subscribed PWA installation. Viewing Main at its latest messages acknowledges presented updates for that installation.

## Current Behavior

- Web Push registrations and per-installation delivery live in `backend/src/adapters/web-push`.
- Push displays and Main navigation live in `frontend/src/pwa`; notification controls reconcile the current subscription on launch.
- Notification intents persist independently of transport outcomes. Badge snapshots and read receipts use publication ordering and each installation’s persisted seen position.

## Target Data Shape

Migration `0025_pwa_badges.sql` adds notification publication sequences and installation seen positions. Badge snapshots contain installation ID, generation, count, publication boundary, and revision. Read receipts identify the generation and boundary captured before refreshing Main. IndexedDB retains one worker-owned badge record.

## Milestones

### 1. Durable badge state and API

Implementation tasks:

- [x] Add migration, per-installation count/read contracts, and publication ordering.
- [x] Include authoritative badge snapshots in push payloads without changing alert delivery policy.
- [x] Validate independent installations, retries, offline reconciliation, and acknowledgment races.

Exit criteria:

- Counts start empty, include unseen eligible publications independently of delivery, and acknowledge only presented updates.

### 2. PWA badge lifecycle and viewing acknowledgment

Implementation tasks:

- [x] Apply versioned snapshots in the service worker and reconcile on launch/reconnect/live updates.
- [x] Acknowledge only when Main is visible at its latest messages; preserve counts in other views.
- [x] Add focused behavioral coverage and update architecture and notification scope.

Exit criteria:

- Duplicate/stale snapshots cannot regress a badge. Disabling clears it. Notification clicks retain drafts and acknowledge after presentation.

## Tests

- Extend Web Push integration coverage for counts, generation resets, independent reads, and concurrent publication/acknowledgment.
- Focused frontend coverage for reconciliation, visibility gating, and stale badge snapshots.
- Production-worker coverage for push badge updates and existing click behavior.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/web-push.spec.ts
npm run openapi:check
cd ../frontend
npm run api:check
npm run check
npm run test:unit -- web-push notification-badge notification-navigation
npm run check:ui
npm run trim
npm run test:pwa
```

## Device Acceptance

- [ ] On an iPhone Home Screen installation, verify numeric badges while closed and clearing after opening Main.
- [ ] Verify Preferences, task views, older history, notification dismissal, and independent installations retain counts.
- [ ] Verify offline recovery, disabling/re-enabling, and frontend updates preserve the documented behavior.

Production-worker checks stub notification and OS badge APIs. They validate application behavior and durable ordering; physical presentation remains pending.

## Overall Exit Criteria

- [x] Backend and frontend invariants pass relevant automated checks.
- [x] Documentation reflects implemented contracts and remaining device acceptance.
- [ ] Real iPhone badge display, clearing, and offline recovery are verified before claiming physical-device acceptance.

## Validation

Backend build/lint and OpenAPI drift checks pass. The 11 Web Push/native notification integration tests and 11 client/OpenAPI contract tests pass against isolated PostgreSQL. Frontend type, generated API, ownership, unused-code, and three focused unit checks pass. All four notification/badge production-browser tests pass. The full PWA run passed ten of twelve tests; two existing update-activation checks timed out after reload and passed on isolated rerun. Physical iPhone presentation and recovery remain pending.
