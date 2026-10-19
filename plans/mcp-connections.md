# MCP Connections

## Status

Done

Implementation, automated checks, and live-provider read/follow-up/restart validation are complete. The configured provider connects through the playground with persistent OAuth and read/write scopes. Task discovery and general code execution are covered by [Task Tool Discovery and Code Mode](task-tool-discovery.md).

## Goal

Connect Pal task agents to general HTTP MCP servers with OAuth and read/write scopes. Provide a client-independent management API and a small playground settings screen. Keep Main responsive and keep configuration changes explicit and infrequent.

## Current Behavior

- `backend/src/agent/main-session.ts` creates Main and one reusable Task Agent with a shared workspace and sandbox. Task threads retain independent context.
- Main exposes task search, inspection, and delegation. Its fast-router role is recorded in `AGENTS.md`.
- `backend/src/agent/mastra-agent-runtime.ts` owns agent startup, task dispatch, publication, and shutdown. Scheduled execution also enters through Mastra's native worker lifecycle.
- `backend/src/mcp/` provides HTTP server management, PostgreSQL configuration/credential persistence, backend-owned native OAuth, idle-only Apply, and task code-mode catalogs. The playground exposes setup through Connected services.
- Installed Mastra core provides `createCodeMode` for workspace execution and `ToolSearchProcessor` for progressive discovery. Their task integration is covered by [Task Tool Discovery and Code Mode](task-tool-discovery.md).

## Decisions

- Support HTTP MCP servers only. Provider-specific semantics do not become separate Pal integrations.
- MCP tools are available only to task agents. Main receives generic delegation guidance, without an MCP catalog or per-server capability descriptions.
- Quick external checks reuse suitable tasks or create ordinary visible tasks. There is no transient-check runtime or hidden-task distinction.
- Use native Mastra code mode and reuse the existing sandbox and SDK execution/validation mechanisms. [Task Tool Discovery and Code Mode](task-tool-discovery.md) defines signature loading.
- Support tools only. Do not advertise MCP Apps support or render App resources. Preserve useful ordinary text and structured results. Add an explicit source comment at the MCP integration boundary documenting this limitation.
- Use supported SDK authentication mechanisms. Request only the scopes required by each provider; include static bearer/custom-header configuration where the native HTTP client supports it directly.
- Login starts from settings. Tasks encountering missing authentication identify the server and direct the user to settings.
- Save configuration at any time. Apply is explicit and requires every agent to be idle. Busy Apply returns 409 and is not queued. Restart loads saved configuration.
- Apply refreshes the task agents' shared MCP connections and tool catalog. Do not maintain multiple connection generations or background configuration rollouts.
- An unavailable or unauthenticated server does not prevent startup, chat, or unrelated task work. Expose per-server failures in settings; explicit Apply retries connection and discovery.
- Granted write scopes expose capabilities; agents still follow the user's requested or standing authorization.

## Target Data Shape

### Configuration and status

- Persist server identity, name, URL, enabled state, and supported authentication configuration. Keep credentials private and return only presence indicators for secret fields.
- Use the native MCP OAuth provider contract for discovery, authorization, code exchange, and refresh. Add only the durable storage and browser callback integration Pal needs; do not implement a separate OAuth protocol stack.
- Keep saved configuration and applied status distinct. A server can have its saved configuration applied and still have a connection error.
- Return per-server connection state, login availability/presence, discovered tool count, and a sanitized error when applicable. Reading status does not invoke business tools.
- Keep pending OAuth state short-lived and validate callback state/PKCE through the SDK. Committed login survives restart; pending login does not need durable recovery.

### Management API

Implemented routes, following Nest service/repository conventions:

- `GET /mcp/servers`: redacted saved definitions, per-server status, and whether Apply is needed.
- `POST /mcp/servers`, `PATCH /mcp/servers/:id`, `DELETE /mcp/servers/:id`: persist configuration without reconnecting active agents.
- `POST /mcp/apply`: require global idleness, refresh enabled connections/catalog, and return individual outcomes. Return 409 while agents or another Apply are active.
- `POST /mcp/servers/:id/login`: start native OAuth and return the authorization URL for the browser.
- A backend-owned OAuth callback completes the native flow; the settings client reads server status afterward.
- `DELETE /mcp/servers/:id/login`: forget local login using the native credential store. Make explicit when Apply is required to discard loaded connections; local removal does not revoke provider consent.

OAuth accepts a pre-registered client ID with an optional write-only secret, or a client metadata URL. `PAL_PUBLIC_URL` determines the registered `/mcp/oauth/callback` URL. Header values are write-only. Omitted secrets retain saved values; null clears them. The concrete API is documented in `architecture/backend.md`.

### Catalog diagnostics

- At startup and Apply, measure the actual generated MCP code-mode instructions and log model ID, tool count, token count, context-window size, and percentage used.
- Add `PAL_MCP_CATALOG_WARN_PERCENT`, default `10`, to configuration validation and `.env.example`. Warn only when the percentage exceeds this value. There is no absolute-token warning threshold.
- Use a supported local tokenizer if already available and suitable for the configured model; otherwise label the count as estimated and record the estimation method.
- Resolve context size from configured-model metadata when straightforward. A documented configured fallback is acceptable if the adapter does not expose it; do not silently attribute one model's limit to another. If unresolved, report the token count and unknown percentage explicitly.
- Include the numeric token count in warnings. Do not log credential values, private tool results, or entire catalogs. No per-turn counting or automatic switch to discovery.
- Ten percent is a configurable Pal heuristic, not a provider guarantee. [Anthropic's guidance](https://www.anthropic.com/engineering/advanced-tool-use) discusses absolute definition size and tool-selection quality; [OpenAI's guidance](https://developers.openai.com/api/docs/guides/tools-tool-search) recommends comparing task performance, token usage, and latency. Neither establishes a universal acceptable percentage.

## Milestones

### 1. Verify Native Integration and Persist Connections

Implementation tasks:

- [x] Verify the pinned Mastra MCP client's HTTP, OAuth, credential storage hooks, error isolation, and code-mode behavior with ordinary text/structured results.
- [x] Verify the configured provider's OAuth metadata, required registration/callback configuration, scopes, and refresh support without copying stored tokens or changing its connection.
- [x] Add the smallest configuration/credential persistence layer and management API. Promote any directly imported transitive dependency to a pinned direct dependency.
- [x] Implement settings-driven OAuth using native SDK helpers and durable private credential storage. Keep setup/status errors useful and sanitized.
- [x] Define Apply-needed behavior for edits, login changes, deletion, and restart.

Exit criteria:

- [x] Configuration survives restart, secrets are write-only, and API clients can manage servers independently of the playground.
- [x] OAuth login and refresh work against an isolated fixture; credential readback and errors do not expose secrets.
- [x] A failing server has a useful status without blocking other connections.

### 2. Expose MCP Through Task Code Mode

Implementation tasks:

- [x] Build shared MCP connections and a native code-mode tool/catalog for Task Agent. Include server instructions needed for correct tool use without adding them to Main.
- [x] Add concise generic Main delegation guidance covering fresh external information and actions. Preserve early acknowledgments and normal task reuse.
- [x] Implement idle-only Apply with one admission boundary that prevents races with user dispatch and scheduled wakes. Verify native busy state; do not rely solely on the UI activity indicator.
- [x] Refresh connections/catalog consistently for reused tasks, new tasks, and scheduled runs. Close replaced connections and shutdown resources through supported SDK methods.
- [x] Handle unavailable servers as recoverable task capability failures. Preserve unrelated tools and ordinary conversation.
- [x] Add the tools-only/MCP Apps compatibility comment in source. Preserve SDK result/error semantics through code-mode execution.
- [x] Add catalog diagnostics and the configurable percentage threshold.

Exit criteria:

- [x] Main has no MCP tools/catalog; task agents can discover the supplied signatures and execute provider-shaped calls through native code mode.
- [x] Busy Apply rejects without changing loaded connections. Successful Apply updates reused and new task executions without altering task history.
- [x] Server failure remains isolated, and catalog warnings report numeric tokens and a correctly sourced or explicitly unknown context limit.

### 3. Playground Settings and Provider Validation

Implementation tasks:

- [x] Add a small settings screen for server configuration, login, local logout, connection errors, pending changes, and Apply. Keep secret fields blank on readback.
- [x] Show Apply's busy response and per-server failures directly; no queued apply, automatic configuration retry, or elaborate setup wizard.
- [x] Configure the provider's public MCP endpoint with read/write scopes and complete login with the owner when consent is required.
- [x] Validate a bounded live read through a task, a related follow-up using the same task, and retained login after restart. Real external mutations require a concrete user-requested change; write plumbing is exercised through fixtures.
- [x] Update `architecture/backend.md`, `.env.example`, and the playground README with implemented API, persistence, Apply, diagnostics, and compatibility contracts.

Exit criteria:

- [x] The owner can configure and authorize a provider, Apply while idle, and receive answers through ordinary task delegation.
- [x] Missing login and server outage are understandable in settings, and the rest of Pal remains usable.
- [x] Actual-model and live-service evidence are distinguished from fixture coverage.

## Tests

- One focused MCP service/API suite covering persistence, secret masking, OAuth callback/refresh, Apply busy admission, reused/scheduled-task catalog refresh, and partial-server failure. Reuse an isolated local HTTP MCP/OAuth fixture.
- Extend agent integration coverage for Main acknowledgment/delegation, Task code-mode execution, structured/text results, and server/tool errors.
- A small diagnostic test covers percentage boundary, configured threshold, and unknown model context handling; no logging snapshot suite.
- One playground flow covers save, OAuth handoff/status, Apply busy/success, and visible connection failure using fixtures.
- One bounded live-provider read after real consent, plus a follow-up/restart check. Do not use private values as committed test fixtures.

## Validation Commands

Use `npx vitest run test/mcp.spec.ts` for focused MCP checks. `npm run mcp:smoke` uses the configured real model, synthetic HTTP MCP data, and an isolated test schema without touching owner chats or connected-service credentials.

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
npm run mcp:smoke
cd ../frontend-playground
npm run build
npm test
```

## Deferred Work

- stdio servers, MCP Apps rendering, and interactive MCP resource hosts.
- Custom tool discovery, automatic catalog optimization, and per-task server configurations.
- Connection versioning, queued Apply, automatic configuration rollouts, and a full administration UI.

## Overall Exit Criteria

- [x] General HTTP MCP configuration and persistent OAuth work through the API and playground.
- [x] Task-only native code mode preserves Main's fast-router role and uses normal visible tasks.
- [x] Explicit idle-only Apply, partial-server failure, and configurable catalog warnings behave as documented.
- [x] Relevant automated checks and authorized live validation pass; documentation and code explicitly state the lack of MCP Apps support.

## Validation and Remaining Work

- Backend build/lint, 15 service tests, 7 API tests, playground build, and 12 browser tests pass. The focused MCP suite also covers malformed catalog isolation, PKCE/state validation, credential refresh, stale refresh protection, sanitized persistence errors, and refreshed catalogs in reused and native scheduled task runs. Apply succeeds after the scheduled run finishes.
- Mastra 2.1.2 unconditionally advertises MCP Apps. A small supported HTTP fetch hook removes that capability from legacy initialization and modern request metadata; the fixture verifies its absence. Server logs are disabled.
- The MCP migration is applied to the local deployment. The playground settings screen connects to the deployed API; server snapshots, idle Apply, and existing chat history return successfully.
- An actual-model fixture smoke passes with the final tools-only integration, including native MCP reads and task finals across a request and follow-up.
- Context diagnostics use an explicit configured limit or a 272,000-token fallback for exact model `gpt-6.1-sol`, sourced from the inspected Codex catalog. Other models have an unknown percentage until configured.
- Authorized live validation confirms consent, restart persistence, task-only execution, and catalog diagnostics. Provider endpoints, scopes, credentials, tool inventories, and account data remain private instance state.
