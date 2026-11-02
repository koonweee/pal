# Exclusive interaction resources: development evaluation

## Status

In Progress. Desktop acceptance and automated checks pass; Android end-to-end acceptance is running.

Scope: the existing `pal-dev-split` stack, synthetic browser pages, isolated test storage and the owned Android fixture. Production is unchanged. Model runs publish only to the test collector.

## Results

| Scenario | Evidence | Result |
| --- | --- | --- |
| Ten scheduled-style desktop turns, then direct request | `interaction-resources:smoke`; actual X11 screenshots | FIFO order 0–9 then direct; no busy rejection. Single screenshot baseline 179 ms; direct request waited 904 ms behind ten short turns. |
| Independent devices and queued phone turns | Final adapter run with execution-local desktop guard | Android progressed while desktop was owned. Two phone turns held 994/591 ms; second waited 994 ms. Desktop burst stayed FIFO; direct request waited 662 ms. Cold single screenshot baseline 730 ms. |
| Delayed browser private entry | Same adapter run | Worker released desktop; another turn changed active tabs; synthetic credentials filled only the retained original target. Existing tab preserved; fixture tabs removed in a cleanup turn. |
| Real desktop Task→Worker contention | Native runs `40e75ba5-43fe-48fa-bfd1-c6e696bb7d47`, `f637283a-b28b-47b2-ab53-2f84d83de7af` | Seven successful computer calls per worker, including cleanup screenshot. First turn held 48,072 ms; second waited 31,080 ms then held 17,970 ms. Both headings verified; zero leftover fixture tabs; existing tab preserved. |
| Cancellation and late calls | Coordinator/native worker lifecycle tests and final real-adapter smoke | Queued cancellation removed; dispatched calls drained before handoff; old executions fenced; resumed sessions receive new execution IDs. Real screenshot cancellation drained for 95 ms before the follower acquired. |
| External private submission racing worker finish | Coordinator regression and private-entry E2E | Submission joins FIFO behind existing waiters, including when its session still owns the device. No session-identity bypass or nested deadlock. |
| Android stale target/readiness | Android adapter/private-entry tests and physical helper proof | Generation and screen validation retained; fresh readiness inspection can retry after connection failure; uncertain fill blocks admission. Physical helper proof passes native/WebView Unicode entry, stale-target rejection and MCP handoff. |
| Activity and reconnect | Backend snapshot tests, frontend policy tests and Playwright activity journey | Running/waiting remain distinct; activity survives reconnect and narrow layout. Multiple workers on one task do not incorrectly label an owning task entirely waiting. |

These are bounded development samples. The screenshot burst measures admission and adapter overhead, not realistic completion time for ten shopping or login workflows.

## Findings and fixes

- An initial real-worker run left three temporary tabs. Its first harness version asserted before exporting tool evidence, so the precise model action sequence was not retained. Harness cleanup removed the fixtures. An unchanged repeat passed; worker guidance now explicitly requires on-screen cleanup verification. The subsequent native run above independently confirmed closure and preservation. Cleanup remains model judgment, not a host guarantee.
- External submissions originally reused any active execution with the same session identity. This could bypass existing waiters and race finalization. Reuse now requires the current asynchronous operation context; external submissions always create fresh bounded FIFO turns. The regression passes.
- A missing phone caused readiness/pause failure. Treating that observation failure as an uncertain mutation unnecessarily blocked later admission. Only uncertain native secret writes require that fence; readiness failure invalidates refs and allows fresh observation. The targeted recovery regression passes.
- The Mac detected the phone while the dev sidecar's ADB device list was empty. Stopping host ADB, reattaching the selected USB phone and refreshing the sidecar mapping restored container access at `001/007`. No wireless-port or production configuration change was needed.
- Removal review found backend-owned desktop deadlines did not survive hard backend death. Desktop commands now inherit a native `flock` and execution-local deadline. A focused adapter regression and detached, non-UI execution probe verify the guard and timeout fencing; this isolates remote settlement rather than adding a second worker queue.
- An Android private-login model continuation timed out before first content after the three synthetic fields had filled. USB remained connected. This partial run is not counted as acceptance; the fixture/database were cleaned before retry. The ordinary Android harness also required a specific launch tool despite an equivalent URL-opening tool; that assertion now accepts either supported navigation path and exports bounded worker evidence before cleanup.

## Recommendations

Keep strict FIFO and lifecycle-based release. The native wait demonstrates the intentional cost of holding a turn through thinking and cleanup. This small sample does not justify priority, preemption, heartbeat/watchdog, explicit release tools or a tab sweeper.

Keep cleanup verification in worker guidance. If recurring omissions appear in actual work, inspect tool evidence and have Task assign a focused cleanup turn. Automatic tab deletion would undermine retained state and is not proposed.

## Validation

- Backend: build, type-aware lint/boundaries, 92 service tests, 42 E2E tests and OpenAPI drift check pass. The additional desktop crash-guard regression passes in the focused adapter suite.
- Frontend: strict type check, generated API drift check, ownership check, unused-code check, 40 unit tests and focused Playwright activity test pass.
- Development backend and execution images rebuilt; persistent profile, home and database volumes preserved.
- Additional physical-phone workflows, final artifact cleanup and local implementation commit remain pending.
