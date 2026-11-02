# Exclusive interaction resources: development evaluation

## Status

Done. Automated checks, adapter acceptance, native contention/fallback, physical private-entry journeys and artifact cleanup pass.

Scope: the existing `pal-dev-split` stack, synthetic browser pages, isolated test storage and the owned Android fixture. Production is unchanged. Model runs publish only to the test collector.

## Results

| Scenario | Evidence | Result |
| --- | --- | --- |
| Ten scheduled-style desktop turns, then direct request | Final `interaction-resources:smoke`; actual X11 screenshots and production private-destination adapter | FIFO order 0–9 then direct; no busy rejection. Single screenshot baseline 82 ms; direct request waited 653 ms behind ten short turns. |
| Independent devices and queued phone turns | Same final adapter run | Android progressed while desktop was owned. Two phone turns held 669/554 ms; second waited 669 ms. |
| Delayed browser private entry | Same adapter run | Worker released desktop; another turn changed active tabs; synthetic credentials filled only the retained original target. Existing tab preserved; fixture tabs removed in a cleanup turn. |
| Real desktop Task→Worker contention | Final shortcut-fix runs `09ae5672-68d4-45ce-b743-b31aaac9ab72`, `ec9251c0-3628-4624-b6fb-ba4c6166f1dc` | Seven successful computer calls per worker, including cleanup screenshot. Both lowercase and uppercase Ctrl shortcuts observed. First turn held 17,112 ms; second waited 8,303 ms then held 60,930 ms. Both headings verified; zero leftover fixture tabs; existing tab preserved. An earlier passing sample waited 31,080 ms. |
| Cancellation and late calls | Coordinator/native worker lifecycle tests and final real-adapter smoke | Queued cancellation removed; dispatched calls drained before handoff; old executions fenced; resumed sessions receive new execution IDs. Real screenshot cancellation drained for 95 ms before the follower acquired. |
| External private submission racing worker finish | Coordinator regression and private-entry E2E | Submission joins FIFO behind existing waiters, including when its session still owns the device. No session-identity bypass or nested deadlock. |
| Android stale target/readiness | Android adapter/private-entry tests and physical helper proof | Generation and screen validation retained; fresh readiness inspection can retry after connection failure; uncertain fill blocks admission. Physical helper proof passes native/WebView Unicode entry, stale-target rejection and MCP handoff. |
| Physical Android private-entry continuation | `./scripts/dev-local android-secure-smoke`; entry run `9d00435e-6321-484d-9749-17c62f1fa8bc` through `aaefb3cd-a9a2-48ea-9b77-eb3ec4a4d0bc`; reuse runs `3b3fd77e-cfba-41bc-baeb-17cec2b3b0d3`, `fa472874-729b-463f-a377-6eb4c1b003f5` | New login and saved-account reuse both authenticated. Four private HTTP stages (username, password, code, fresh code); every wait released ownership. Vault merge, secret/OTP exclusion and resumed-worker checks pass. No real accounts touched. |
| Concurrent native phone Tasks | Runs `05e28322-8455-4dda-a047-b076503da04e`, `dda371a3-d319-4025-ad72-e93e34c7070b` | Android Chrome followed example.com to IANA and verified its heading; Settings read model/version without changes. Zero tool errors. Phone turns held 28,590/34,726 ms; second waited 27,256 ms. Both reported real observations and took screenshots. |
| Fresh-worker device fallback | Focused native run `d03cf3e2-e7ae-414d-89c7-e2770d7fbdf5` | Task waited for the desktop worker to return before delegating a fresh phone worker. One successful screenshot per device; distinct worker/execution IDs. Desktop released after 1,907 ms before Android acquired; phone held 2,610 ms. |
| Activity and reconnect | Backend snapshot tests, frontend policy tests and Playwright activity journey | Running/waiting remain distinct; activity survives reconnect and narrow layout. Multiple workers on one task do not incorrectly label an owning task entirely waiting. |

These are bounded development samples. The screenshot burst measures admission and adapter overhead, not realistic completion time for ten shopping or login workflows.

## Findings and fixes

- An initial real-worker run left three temporary tabs. Its first harness version asserted before exporting tool evidence, so the precise model action sequence was not retained. Harness cleanup removed the fixtures. An unchanged repeat passed; worker guidance now explicitly requires on-screen cleanup verification. The subsequent native run above independently confirmed closure and preservation. Cleanup remains model judgment, not a host guarantee.
- A later run (`329e19d9-64be-4de0-90f8-05f013fea9e7`, `47e60176-7c8e-4d2e-b54d-e5b23cffed96`) left four tabs despite successful tool results and cleanup claims. A subsequent bounded transcript audit captured `CTRL,T` and `CTRL,L` in uppercase. A controlled, seeded-tab probe confirmed the old adapter's `CTRL,T` restored the closed fixture instead of opening a new tab: X11 interpreted uppercase `T` as Shift. Chord letters now normalize to lowercase; Shift must be explicit. The regression covers both `CTRL,T` and `CTRL,SHIFT,T`. This is an adapter defect; the exact cause of the initial unrecorded run remains unknown. Native fixture cleanup now closes only pages with that run's unique marker, preserving unexpected restored tabs.
- External submissions originally reused any active execution with the same session identity. This could bypass existing waiters and race finalization. Reuse now requires the current asynchronous operation context; external submissions always create fresh bounded FIFO turns. The regression passes.
- A missing phone caused readiness/pause failure. Treating that observation failure as an uncertain mutation unnecessarily blocked later admission. Only uncertain native secret writes require that fence; readiness failure invalidates refs and allows fresh observation. The targeted recovery regression passes.
- The Mac detected the phone while the dev sidecar's ADB device list was empty. Stopping host ADB, reattaching the selected USB phone and refreshing the sidecar mapping restored container access at `001/007`. No wireless-port or production configuration change was needed.
- Removal review found backend-owned desktop deadlines did not survive hard backend death. Desktop commands now inherit a native `flock` and execution-local deadline. A focused adapter regression and detached, non-UI execution probe verify the guard and timeout fencing; this isolates remote settlement rather than adding a second worker queue.
- Browser private writes also need uncertainty fencing: a write timeout/connection loss was previously classified as stale fields. Dispatch failures now mark desktop unavailable and return an explicit no-replay error; pre-write validation retains ordinary stale-field recovery. A focused lost-response regression exercises the fence.
- Browser inspection/validation can hang on an unresponsive renderer, so private browser operations have a host deadline and fence admission on expiry. The regression verifies an unresolved target lookup releases its execution without admitting a follower.
- An Android private-login model continuation timed out before first content after the three synthetic fields had filled. USB remained connected. This partial run is not counted as acceptance; the fixture/database were cleaned before retry. The ordinary Android harness also required a specific launch tool despite an equivalent URL-opening tool; that assertion now accepts either supported navigation path and exports bounded worker evidence before cleanup.
- The first cross-device fallback sample delegated correctly but its fixture omitted the worker's native Workspace providers, so no computer tool was exposed. Production and the desktop-native fixture already supply those providers. The Android fixture now uses the same wiring, supports a focused fallback rerun, and allows queue waiting in its overall test deadline. The passed phone workflows need no repetition for that fixture-only correction.

## Recommendations

Keep strict FIFO and lifecycle-based release. The native wait demonstrates the intentional cost of holding a turn through thinking and cleanup. This small sample does not justify priority, preemption, heartbeat/watchdog, explicit release tools or a tab sweeper.

Keep cleanup verification in worker guidance. If recurring omissions appear in actual work, inspect tool evidence and have Task assign a focused cleanup turn. Automatic tab deletion would undermine retained state and is not proposed.

## Validation

- Backend: build, type-aware lint/boundaries, 94 service tests, 43 E2E tests and OpenAPI drift check pass. The lost-response regression writes a synthetic value before throwing, then proves further desktop admission is fenced. The hung-renderer regression uses a bounded unresolved lookup.
- Frontend: strict type check, generated API drift check, ownership check, unused-code check, 40 unit tests and focused Playwright activity test pass.
- Development backend and execution images rebuilt; persistent profile, home and database volumes preserved.
- Physical-phone workflows, focused native fallback and final production-path private-target smoke pass. The rewrite is committed locally; production deployment is separate.

## Cleanup

No scratch schemas/databases, browser fixture tabs, fixture APK or copied acceptance scripts remain. One original browser tab remains open. Six synthetic preview images and the Playwright run marker were removed (about 132 KB); the existing Android acceptance record is preserved. The detached-process probe lock was removed; the live desktop command lock remains part of the adapter.

The shared dev stack, phone attachment, current image tags and persistent volumes remain available. No disposable task containers or images remain. Final Docker usage: images 7.086 GB, volumes 3.451 GB, shared build cache 17.24 GB. Existing unrelated resources and shared cache are retained; no global prune or persistent-data deletion was performed.
