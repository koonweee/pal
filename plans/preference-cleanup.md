# Preference Implementation Cleanup

## Status

Done

## Goal

Remove the avoidable machinery and integration glue identified in the first preference implementation while preserving its storage, API, agent, and playground behavior.

## Current Behavior

- The preference model smoke script boots the Nest application and sends Main and Task messages through `MastraAgentRuntime` on the isolated test database.
- `startTestApp` supplies named runtime dependencies through one factory object.
- Reply quotes and preference evidence use one older-message navigation function; preferences receive it as an explicit dependency.
- Preference and MCP dialogs use neutral shared settings styles with feature-specific selectors scoped separately.
- Preference DTO, service, and operation-specific tool schemas share limits and enum values. Service validation remains the trusted write boundary.

## Milestones

### 1. Runtime and test harness cleanup

Implementation tasks:

- [x] Replace the standalone preference agent harness with a small smoke flow through the real Nest application and `MastraAgentRuntime` on the isolated test database.
- [x] Replace positional `startTestApp` runtime dependencies with a named dependency object and update its callers.

Exit criteria:

- [x] The smoke flow reaches the same runtime used by the application without monkey-patching services.
- [x] Runtime test factories name the dependencies they consume.

### 2. Playground integration cleanup

Implementation tasks:

- [x] Use one chat message navigation function for reply quotes and preference evidence.
- [x] Pass navigation into the preference module directly and remove the custom window event.
- [x] Introduce neutral shared settings-dialog classes and leave MCP-specific selectors scoped to MCP behavior.

Exit criteria:

- [x] Reply and evidence links can load older messages and highlight their destination through one code path.
- [x] Preference styling has no dependency on the MCP dialog root class.

### 3. Preference tool contract cleanup

Implementation tasks:

- [x] Define shared preference limits and enum values once for DTO, service, and tool contracts.
- [x] Express read and write operation requirements as discriminated JSON Schema alternatives.
- [x] Retain service validation as the trusted boundary and the existing two-tool surface.

Exit criteria:

- [x] Invalid operation shapes are rejected by tool input schemas without adapter-level required-field checks.
- [x] HTTP and agent contracts use the same limits and enum values.

## Tests

- Run preference service and API tests.
- Run agent runtime tests affected by the test factory change.
- Run the playground preference and reply-navigation flow.
- Run one real-runtime preference smoke flow with the configured model.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
npm run preferences:smoke

cd ../frontend-playground
npm run build
npm test
```

## Overall Exit Criteria

- [x] All five reviewed issues are removed without changing preference behavior or data contracts.
- [x] Backend and playground validation pass.
- [x] Architecture and preference-plan validation notes describe the real runtime smoke boundary.
- [x] The updated local deployment is healthy and preserves existing application data.

## Validation Results

Completed on 2026-10-09:

- Backend build and type-aware lint pass. All 21 integration tests and all 10 API end-to-end tests pass; the focused preference test also covers the provider-compatible object-root schema.
- Playground build/type-check and all 21 Chrome tests pass. Focused preference evidence and reply navigation tests pass after evidence was moved to another task conversation.
- The real-runtime model probe passes Main learning, current Task lookup after a human correction, and one-off exception preservation. An initial cleanup run exposed an invalid root-less union schema; the final object-root contracts pass the provider and have a deterministic regression.
- `git diff --check` passes.
- Local deployment passes rollback, API, desktop, frontend, and record-invariant checks.
