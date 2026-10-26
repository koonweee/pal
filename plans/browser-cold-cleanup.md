# Browser cleanup after backend reconnect

## Status

In Progress — implementation and native acceptance complete; dev/production rollout pending.

## Goal

Expire idle task tabs after backend reconnection even when a renderer is already unresponsive. Keep the existing 15-minute policy and ownership protections.

## Current Behavior

- BrowserService reaches extension group state through Playwright, whose cold attachment waits for every page to initialize.
- A looping renderer prevents that attachment, so cleanup cannot read or close its group after a backend restart.
- The bundled extension already owns session/group/activity records and closes current group members independently of renderer JavaScript.

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
