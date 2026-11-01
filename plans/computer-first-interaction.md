# Computer-first interaction

## Status

Implementation verified; production rollout pending (tracked in Stack v2).

## Goal

Remove general browser automation from the interaction worker, retain private filling through host-owned browser sessions, prefer computer use with Android fallback, and deploy all latest local changes. Keep implementation and guidance in one rollbackable commit.

## Current Behavior

- The worker exposes computer, Android and secure-entry tools. General browser commands are absent.
- Private browser filling resolves the active owned computer tab; the host prepares its window.
- Browser infrastructure still owns private field access, persistent profile and cleanup.

## Milestones

### 1. Simplify tools and host setup

- Remove production browser tool registration and browser-action arguments from private-entry schemas.
- Prepare an owned desktop window on first computer use; bind inspection to its active tab, including new tabs and popups.
- Preserve private-fill ownership, continuation and cleanup; keep historical benchmark adapters isolated from production.
- Update shared method guidance and authentication instructions.

Exit criteria: no general browser commands reach the worker; visual navigation and secure filling share the correct owned tab.

### 2. Validate and release

- Run relevant backend/frontend checks and real development navigation/private-fill acceptance.
- Commit the cleanup and guidance together; build the full reviewed release and deploy through Stack v2's existing operator workflow.
- Verify production health, release identity and supported desktop/private-fill paths; remove exact temporary resources.

Exit criteria: validated release deployed with profiles/data preserved and a concrete rollback revision.

## Tests

- Tool inventory and secure-entry schema exclusion.
- Computer ownership, active-tab selection, new tabs/popups and cleanup.
- Existing secure-fill integration coverage plus real desktop acceptance.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
```

## Overall Exit Criteria

- One implementation commit contains the cleanup and computer-first guidance.
- Computer and Android private filling work without model-facing browser automation.
- Production runs the latest validated source; rollout and cleanup evidence is recorded.

## Validation evidence

- Backend service suite: 84/84; final focused ownership/browser regression: 9/9. Build and lint pass.
- E2E: nine unaffected suites pass; updated login suite passes 8/8 after replacing the obsolete browser-action test.
- Frontend: type check, 33 unit tests and 15 PWA tests pass.
- Real development desktop: keyboard navigation, new tab, tab switch, popup, private credentials/code, wrong-tab rejection, continuation and group cleanup pass.
- Normal Pal task `fd9ba6e6-0732-4682-b451-9c86d3f92d3c` exercised native computer navigation and screenshots without general browser tools. It reported page content/tab titles; exact page headings were not verified.
- Extension upgrade required content-versioned worker filenames; manifest version alone retained stale worker code in the persistent profile. Rebuilt-image acceptance passes.

## Remaining release work

Build and deploy the single cleanup revision through Stack v2, verify production, and complete release-artifact cleanup there. Android fallback requires a configured production sidecar/device; this source change does not provision hardware.
