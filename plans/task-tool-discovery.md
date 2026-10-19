# Task Tool Discovery and Code Mode

## Status

Done

## Goal

Reduce task prompt overhead with native progressive MCP discovery and provide a general task code runner. Keep Main's acknowledgment and routing path unchanged.

## Current Behavior

- `McpService` loads HTTP connections at startup and idle-only Apply.
- Task agents discover MCP tools through native search and can invoke available text/data tools through the general `execute_typescript` runner.
- Native Mastra provides tool search, context-backed discovery state, code execution, and signature generation. One Pal processor connects discovery to the runner's allowlist and retains direct tools for native media output.

## Milestones

### 1. Compose Native Discovery and Execution

Implementation tasks:

- [x] Use native `ToolSearchProcessor` with automatic loading and context-backed state.
- [x] Generate native code instructions and executors from available core/workspace tools and discovered MCP tools each step.
- [x] Preserve direct calls and native image output. Flag SDK patches or substantial special cases before expanding scope.

Exit criteria:

- [x] Undiscovered MCP signatures and executors are absent; discovered tools work directly and through code mode.
- [x] Core and workspace text tools work through the same runner. Media tools retain native direct output.

### 2. Integrate Task Runtime

Implementation tasks:

- [x] Wire the processor into task agents and retain idle Apply, task reuse, and schedules.
- [x] Keep MCP service instructions and catalog diagnostics; document which costs are potential versus loaded.
- [x] Update architecture and the real-model fixture smoke.

Exit criteria:

- [x] Main receives no discovery or code tools. Tasks pick up current connections without custom discovery persistence.
- [x] Existing HTTP configuration and OAuth contracts remain intact.

### 3. Validate and Deploy

Implementation tasks:

- [x] Run focused and relevant backend checks.
- [x] Measure initial versus full catalog overhead and exercise real-model search, execution, and reuse.
- [x] Deploy locally and verify connected-service health.

Exit criteria:

- [x] Native integration tests and real-model smoke pass; prompt cost and added discovery latency are recorded.
- [x] Local deployment is healthy and supports the new task flow.

## Tests

- Extend the existing MCP fixture suite for native search → execution, refreshed catalogs, reused tasks, and scheduled runs.
- One focused processor test covers contextual restoration/expiry, thread isolation, generic workspace execution, and media preservation.
- Real-model fixture smoke uses synthetic data and isolated task memory.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/mcp.spec.ts test/task-tool-discovery.spec.ts
npm test
npm run test:e2e
npm run mcp:smoke
```

## Overall Exit Criteria

- [x] Task agents use progressive discovery and one general native code runner while retaining direct tools.
- [x] Main stays a fast router; API, OAuth, idle Apply, and native task/schedule behavior remain correct.
- [x] Tests, real-model validation, local deployment, and documentation are complete.

## Validation

- Build and type-aware lint pass. All 16 service tests and 7 API tests pass. The focused media case also passes with a real PNG read through the retained native tool.
- The adapter uses public processor and code-mode APIs. No SDK patches, custom ranking, discovery database, or separate execution transport are needed. Native file reads and computer tools retain direct calls because code mode returns JSON.
- Real `gpt-6.1-sol` fixture validation passes with `search_tools`, a direct MCP read, and parallel MCP reads through `execute_typescript`. The follow-up reuses the loaded catalog without another search. Main acknowledgment is 5,106 ms, first answer 37,685 ms, and both runs finish in 46,101 ms including session setup. An earlier direct-call-only run acknowledged in 8,146 ms and answered in 28,711 ms. These are individual checks, not a controlled latency comparison; discovery adds one task-side model round trip.
- Live-provider validation confirms that progressive discovery materially reduces initial MCP instructions. Measurement invokes no business tools; provider endpoints, scopes, and tool inventory remain private configuration.
- The verified image is deployed locally. The provider reconnects with persisted login, `applyNeeded` is false, and chat history returns 200. The deployed general runner successfully invokes a native workspace command inside the container without changing user files or calling provider write tools.
