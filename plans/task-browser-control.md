# Task Browser Control

## Status

Done

## Goal

Give task agents concurrent browser control inside Pal's VM, with shared logins, visible task tab groups, and predictable cleanup. Prefer existing browser tooling and a small Mastra adapter.

## Current Behavior

- Task agents use a shared native Mastra workspace and optional X11 computer tools. Main remains a conversational router; browser tools are task-only.
- BrowserService runs pinned agent-browser sessions against one visible Chromium profile in Pal's execution environment. The bundled extension maintains task groups and activity in Chrome session storage.
- The installed launcher serves both desktop and runtime use. Profiles persist under `/data/home`; browser restart begins fresh task associations. Browser control is disabled with desktop tools in host development.

## Accepted Decisions

- Run one visible Chromium instance with a persistent profile inside Pal's execution environment. Agents and the human use the same profile and logins.
- Use agent-browser for page interaction, a thin Mastra tool adapter for task routing, and a bundled extension for tab groups. Pin a verified CLI version supporting strict tab binding (introduced in v0.34.0).
- Lazily create one pinned CLI session and one named, colored Chromium group per task. Sessions select command targets; groups represent task membership and cleanup boundaries.
- Install the extension with Pal and load it automatically through a common browser launcher used by the runtime and desktop shortcut.
- Automatically close Pal-managed task groups after completion/archive once active operations settle, or after 15 minutes without browser activity, including active agent runs and stalled browser operations. Recheck group activity before idle closure. A final response alone does not mean the task is complete.
- Cleanup queries current group membership. Ungrouped tabs and human-created groups are excluded. Moving a tab out of a Pal group therefore releases it from cleanup, without a separate retained-tab flag.
- Agents handle conversational requests to leave tabs alone. Opening or using VNC does not automatically pause agents. Human activity does not reset the idle timer; move tabs out of task groups to retain them.
- Browser restarts preserve logins and start fresh task groups. Do not restore task-to-tab associations across browser sessions.
- No browser-wide action locks, ownership permission system, takeover UI/detection, or resource-budget infrastructure. Preserve existing shared-computer guidance.

## Agent Guidance

Add brief guidance to task instructions:

> For retrieving information and performing actions, prefer available service tools, then direct API calls, then browser automation, then computer use. This is a flexible preference: skip unsuitable approaches and honor the user's requested method. Direct calls may use documented or site-internal APIs, including authenticated browser sessions and observed network requests. Use your task's browser group by default, close temporary tabs promptly, and leave other agents' and the user's work alone.

Use existing tool search, code execution, and shell capabilities for API work. Introduce no escalation state machine, mandatory attempts, new approval flow, or bespoke API client framework. Browser guidance should briefly explain group cleanup and how moving tabs out preserves them.

## Integration Contracts

- Browser service owns launch/attach, task session identity, group association, activity timestamps, and teardown. Derive session names from task UUIDs using CLI-supported characters.
- Keep browser tools task-only. Execute CLI operations with argument arrays, injecting the local endpoint, session, strict pinning, and structured output. Bound execution and preserve cancellation. Return screenshots as native image content; exclude image-producing tools from JSON-only code mode as appropriate.
- Provide a small browser command surface plus group lifecycle operations. Reuse upstream command documentation rather than duplicating every CLI operation as a custom tool.
- Extension responsibilities are group creation/naming, querying current tabs, grouping explicit task-created tabs and attributable popups, and closing groups. Browser interaction remains in agent-browser.
- Associate Chrome tab IDs with CDP target IDs through supported APIs; never use URL matching or before/after browser-wide tab-list differences for ownership. Validate `chrome.debugger.getTargets()` as the initial mapping option without attaching another debugger to pages.
- Use one bounded local extension bridge, chosen during the compatibility milestone. Validate extension service-worker wake/reconnect behavior. Avoid adding a generic RPC framework or external service.
- Keep the task-to-group association local to the browser session and recover it across extension worker suspension/API reconnection using the smallest native mechanism. No application database migration or public chat API change is expected. Group titles are display labels, not identity.
- Group explicitly created tabs once; do not continually regroup tabs the human moves out. Attribute popups from their opener when available. Handle separate-window popups using supported grouping/movement where it works; document actual limitations instead of guessing ownership.
- A removed selected tab returns a recoverable error. Do not silently navigate an unrelated tab or recreate a user-closed group until a later explicit browser operation needs one.
- Group close removes current member tabs, then disconnects that task's CLI session. It leaves Chromium, the shared profile, other groups, and ungrouped tabs available.
- Reuse task update events and native active-thread/run information for cleanup. Apply the policy to scheduled and directly invoked runs, retries, errors, cancellation, and shutdown. Use a periodic sweep and a last-activity timestamp, with eligibility rechecked before cleanup; do not add a job queue or coordination locks.
- On browser restart, invalidate old group/target IDs and stale CLI bindings. On API-only restart, reconnect to the existing browser without globally closing user tabs or abandoning managed-group cleanup. Do not add cross-browser-session restoration.

## Milestones

### 1. Validate the Browser and Extension Boundary

Implementation tasks:

- [x] Pin and exercise agent-browser on the deployed Linux ARM64 environment against existing Chromium and an isolated fixture profile.
- [x] Prove two named, pinned sessions operate independently with shared cookies, including first connection, explicit tab switching, external tab closure, and daemon reconnect.
- [x] Load a minimal Manifest V3 extension automatically; validate group APIs, target/tab mapping, popup attribution, and a bounded local bridge through worker suspension.
- [x] Verify session disconnect leaves shared Chromium running. Measure idle, two-task active, and post-cleanup resources without creating a monitoring subsystem.
- [x] Resolve any incompatible package/browser version before proceeding; record the verified choices and concrete gaps here. Prefer a supported adjustment over an SDK fork.

Exit criteria:

- [x] A reproducible local fixture demonstrates concurrent interaction, shared authentication, group creation, and independent group cleanup.
- [x] The selected CLI, browser binary, extension loading, and bridge work in the actual deployment architecture; uncertain behavior is resolved or explicitly scoped.

### 2. Package the Shared Browser and Task Tools

Implementation tasks:

- [x] Add extension assets, a common launcher, pinned CLI installation, and container/direct-VM provisioning instructions. Preserve the Chromium sandbox and existing desktop appearance.
- [x] Use the persistent profile and local debugging endpoint consistently from the desktop shortcut and agent runtime. Start on demand; ordinary chat remains usable if browser startup fails.
- [x] Implement the browser service and task-only Mastra tools, including lazy groups, pinned session routing, explicit tab creation, popup grouping, and native screenshots.
- [x] Keep browser-disabled host development working; document introduced configuration in `.env.example`.

Exit criteria:

- [x] Two real task threads act concurrently in distinct, visibly named groups sharing one login state.
- [x] The human opens the same browser from the desktop, with the extension already available.
- [x] Main's tools and routing remain unchanged; browser failures are bounded tool errors.

### 3. Add Cleanup and Escalation Guidance

Implementation tasks:

- [x] Connect completion/archive events and task-run lifecycle to eligible group teardown, plus the 15-minute idle sweep.
- [x] Use current group membership for cleanup; disconnect only the corresponding CLI session and clean up abandoned session processes.
- [x] Handle missing tabs/groups, browser restart, API reconnect, cancellation, and application shutdown without closing unrelated tabs.
- [x] Add the agreed escalation and browser etiquette guidance to task instructions.

Exit criteria:

- [x] Completion/archive cleanup waits for active work; idle cleanup expires Pal groups after 15 minutes even during active runs or stalled operations.
- [x] Moving a tab out excludes it from cleanup without a retained-tab feature or movement history.
- [x] Recurring tasks can recreate browser workspaces on later checks; logins survive browser restarts.
- [x] Agent guidance expresses a flexible tools/API/browser/computer preference and allows both documented and internal APIs.

### 4. Validate the Complete Flow and Document It

Implementation tasks:

- [x] Run focused integration checks and a bounded real-model task against local fixtures.
- [x] Verify concurrent task control and human-visible groups through the existing VNC desktop, including closing one group while another remains in use.
- [x] Validate image rebuild/restart persistence, fresh browser groups, and API-only reconnect using disposable fixtures.
- [x] Update architecture/deployment documentation and relevant README/configuration references to describe implemented contracts. Keep scope and deferred work in this plan.

Exit criteria:

- [x] Required checks pass and actual limitations/resource observations are recorded here.
- [x] Documentation reflects the resulting behavior; implementation status is updated only after validation.

## Tests

- One browser integration fixture covers two task sessions plus human tabs: shared login, independent navigation/actions, pin loss, explicit new tabs/popups, target mapping, grouping, moving a tab out, and closing one group without affecting the others.
- A small service-level set covers idle threshold during active runs/stalled operations, activity refresh before closure, completion/archive cleanup, and repeated cleanup of already-closed groups using controlled time.
- Extend existing task/discovery coverage only for task identity routing, scheduled-run cleanup, and direct screenshot content where the browser fixture cannot cover these.
- Reuse the browser fixture for extension suspension, daemon/API reconnect, and fresh groups with persisted login after browser restart.
- A bounded real-model smoke confirms tool use, screenshot interpretation, and cleanup. Review escalation wording directly; avoid brittle assertions that a model always chooses one route.

## Validation Commands

Run browser checks in the provisioned Linux environment; use targeted existing suites relevant to changed runtime/discovery code.

```bash
cd backend
npm run build
npm run lint
npx vitest run test/browser.spec.ts test/task-agents.spec.ts test/task-tool-discovery.spec.ts
npm run browser:smoke
npm run browser:smoke -- --idle-cleanup
npm run browser:smoke -- --agent
```

## Overall Exit Criteria

- [x] Task agents and the human share one persistent Chromium profile inside Pal's environment.
- [x] Task sessions control their own tabs concurrently, with automatically loaded, visible task groups.
- [x] Group operations and lifecycle cleanup preserve unrelated groups and ungrouped tabs, including tabs moved out by the human.
- [x] Browser/session failures recover without arbitrary tab reassignment; browser restarts retain authentication and start fresh task groups.
- [x] Main remains responsive; guidance prioritizes service tools, direct APIs, browser automation, then computer use without a mandatory ladder.
- [x] Focused tests, deployed-environment smoke checks, and documentation are complete.

## Validation and Simplicity Review

Verified on Linux ARM64 in the rebuilt Pal container with Debian Chromium 154.0.8037.92, agent-browser 0.38.2, and playwright-core 1.63.0. Build/lint pass; the five focused integration files pass 14 tests. The browser fixture covers shared cookies/storage, independent sessions and explicit tab switching, daemon reconnect, popup grouping, native screenshots, cancellation, lifecycle/idle cleanup, moved-tab preservation, API reconnect, worker suspension/cold attachment, and fresh groups after browser restart. Two real native task threads independently read screenshot codes and submit their forms; active native runs are excluded from cleanup. Desktop inspection shows named colored task groups alongside a human group. A disposable profile retains its login cookie across image replacement. Both desktop entries resolve to the shared launcher.

Sampled process-tree RSS: 1,072 MiB idle (one initial tab), 1,619 MiB with two task tabs and two human tabs, and 1,492 MiB after task cleanup (four preserved tabs, including the moved-out tab). Summed RSS includes shared pages counted in multiple processes. The two native task daemons use 22 MiB combined and return to zero after cleanup. These are fixture observations, not resource budgets.

Concrete dependency gaps and limits:

- Mastra's bundled agent-browser 0.19 lacks strict pinning. The task adapter calls the separately pinned current native CLI; Mastra owns tools, task context, media, and run lifecycle.
- Chromium keeps inactive task tabs renderable with background-rendering switches. Playwright's `noDefaults` prevents profile overrides and an extra attach-created tab. CDP wakes the MV3 worker; a cold client reattaches once if the stopped worker was absent from its target inventory. This uses supported APIs without a bridge server or SDK patch.
- The Linux service invokes the packaged native CLI directly so timeout/cancellation cannot orphan the Node wrapper's child. Cancellation stops the caller; an in-flight native daemon operation can continue to its own timeout. Group teardown removes owned targets before disconnecting the session. Idle daemons shut down after 30 minutes.
- Popup attribution requires Chrome's opener relationship. Unattributed tabs remain outside managed cleanup. Batch and window commands are excluded from the wrapper; explicit `tab new` supplies a target to group.
- Human activity does not alter cleanup eligibility. Ordinary graceful API shutdown closes managed groups after agents settle; reconnect to an existing browser recovers any remaining session records. Browser restarts retain login state and begin fresh task associations.

The final review keeps custom logic to launch/attach, task routing, groups, and cleanup. Associations live in Chrome session storage; native group membership releases moved tabs naturally. The implementation uses no additional ownership database, action lock, restoration history, resource scheduler, or generic RPC framework.

## Deferred Work

- Group restoration across browser restarts, takeover detection/UI, retained-group flags, tab movement history, ownership enforcement, cross-task locks, and resource quotas.
- General browser extension UI, recording/streaming features beyond existing VNC, and alternate browser providers.

## References

- [agent-browser shared CDP sessions and pinning](https://agent-browser.dev/cdp-mode)
- [agent-browser tab commands](https://agent-browser.dev/commands)
- [Mastra BrowserViewer](https://mastra.ai/reference/browser/browser-viewer)
- [Chrome tab groups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome debugger target mapping](https://developer.chrome.com/docs/extensions/reference/api/debugger#method-getTargets)
- [Chromium extension loading](https://playwright.dev/docs/chrome-extensions)

## Browser idle cleanup regression

- Scope: expire Pal-managed browser groups after 15 minutes without browser activity, including active task runs and stalled operations. Preserve current group membership and human-preserved tabs; add no watchdog, CPU policy, runtime setting, or automatic action replay.
- Sequence: reproduce the active-run exemption in the existing isolated browser fixture, update the sweep and its final activity check, then rerun the fixture and focused backend checks.
- Validation: `--idle-cleanup` runs the lifecycle fixture independently of native screenshot capture. A real infinite-loop renderer consumes CPU, remains before the idle threshold, and disappears at the threshold while its browser command settles with a recoverable error. Human tabs survive. Check that activity refreshed before closure prevents stale cleanup.
- Rollback: revert this backend change and its policy documentation. No schema or persistent-state changes are required. SF rollout is outside this implementation task.
- [x] Reproduce the failure before the fix and verify the 15-minute cleanup afterward.
- [x] Run backend build/lint and focused browser tests; record outcomes.


Validation on 2026-10-25:

- Before the fix, the real-browser regression failed with an expired looping renderer still in its active task group. Its renderer consumed more than 0.5 CPU-seconds and a simple evaluation could not respond.
- After the fix, the focused lifecycle fixture passed against a disposable Linux desktop (`pal-execution-local:latest`) with an isolated synthetic profile. The test advances the existing sweep clock: the active task/in-flight loop survives at 14:59.999 and closes at 15:00. The renderer process disappears, the command reports failure, operation tracking clears, and the CLI daemon exits. Refreshed activity and human-preserved tabs survive. Completion/archive cleanup, worker isolation, browser restart/login persistence, and extension suspension checks also pass.
- Actual runner: `PAL_EXECUTION_ID=pal-split-stack-idle-repro PAL_BROWSER_ENDPOINT=http://127.0.0.1:32769 DOTENV_CONFIG_PATH=/dev/null node scripts/browser-smoke.mjs --idle-cleanup` from `backend/`, against a credential-free disposable execution container. The desktop exposes its existing CDP proxy only on workstation loopback. No development or SF services are replaced.
- `npm run build`, `npm run lint` (existing test-file warnings only), `vitest run test/browser.spec.ts`, changed-code Prettier checks, and `git diff --check` pass. No model calls are needed for this mechanical lifecycle change; the regression uses the real browser and native command path directly.
- The unfiltered browser smoke timed out twice in its pre-existing screenshot operation before reaching the new regression. Image capture remains unverified in this environment; the normal smoke retains its screenshot assertion. `--idle-cleanup` runs the lifecycle checks without that image-capture step.
- Production rollout is not included.
