# Browser cleanup after backend reconnect

## Status

Done

## Goal

Expire idle task tabs after backend reconnection even when a renderer is already unresponsive. Keep the existing 15-minute policy and ownership protections.

## Current Behavior

- BrowserService reaches extension group state through bounded direct browser CDP requests, independently of Playwright page initialization.
- A suspended worker is woken with browser-handled service-worker commands on an existing page; page JavaScript need not respond. Each request disconnects its own sessions and creates no page.
- The bundled extension owns session/group/activity records and closes current managed group members. The 15-minute activity recheck, human-moved tabs and native daemon teardown are preserved.

## Milestones

### 1. Independent extension control

Implementation tasks:

- Add a bounded direct browser CDP connection that attaches only to the Pal extension and wakes its suspended worker when needed.
- Route group operations and cleanup through that connection, retaining normal Playwright page access for page consumers.
- Preserve activity rechecks, human-moved tabs, cleanup without browser startup, and native daemon teardown.

Exit criteria:

- A fresh BrowserService can inspect and expire groups while a renderer is hung and the extension starts suspended.
- Timeouts/disconnections release the control socket. Wake-up uses browser-handled commands on an existing page and creates no page.

### 2. Regression and release

Implementation tasks:

- Extend the existing native infinite-loop regression to disconnect the backend and suspend the extension before cold cleanup.
- Verify warm and cold cleanup, worker lifecycle, ownership, threshold, state persistence and public browser tool contracts.
- Publish and deploy dev/production through the owning Stack v2 runbook.

Exit criteria:

- Targeted regression fails against the prior source and passes with the fix.
- Dev/prod release identity and health pass; retained execution/state and five-minute monitoring pass.

## Tests

- Existing native browser lifecycle fixture with a cold-reconnect/suspended-extension infinite-loop case, including preservation and daemon/process exit assertions.
- Existing browser tool identity unit test, build and lint.

## Validation Commands

```sh
cd backend
npm run build
npm run lint
npx vitest run test/browser.spec.ts
npm run browser:smoke -- --idle-cleanup
```

## Overall Exit Criteria

- Cold cleanup reaches the extension without waiting for a stuck page and closes expired managed groups while preserving human and recently active tabs.
- No dependency, runtime setting, schema or execution image changes; existing tool contracts are unchanged.
- Both deployments and post-rollout monitoring are verified, with temporary artifacts removed.

## Acceptance evidence

- Baseline `69efe6a`: the corrected fixture reaches a disconnected backend, suspended extension and a looping renderer; its cold sweep fails after repeated Playwright connection timeouts.
- Fixed isolated `npm run browser:smoke -- --idle-cleanup`: passes cold reconnect and exact 15-minute threshold, renderer exit, recoverable in-flight command failure, human/moved-tab preservation, concurrent workers and daemon teardown, login persistence, extension suspension, desktop survival across backend restart, and API availability during execution outage.
- Build, type-aware lint/boundary checks and existing browser tool identity/media unit test pass. Lint retains seven preexisting test-type warnings. The broad harness initially hits an unrelated PWA navigation timeout; focused cleanup mode now omits that PWA check and optional screenshot assertion while retaining native cross-container browser/desktop checks.

- Source `a08a529` is published and deployed to development and production. Production replaces only agent-service and retains its existing frontend/UI release, execution desktop and other service identities; no schema migration or manual target closure is needed. Final monitoring/cleanup evidence is owned by Stack v2’s `plans/pal-browser-cold-cleanup-release-plan.md`.
- Final five-minute acceptance passes all 11 health/CPU samples: SF internal CPU 2.94–5.9%, Chromium at most 0.2%. Only the production backend container changes; existing state and dependent containers persist. Temporary operator and isolated-test artifacts are removed.
