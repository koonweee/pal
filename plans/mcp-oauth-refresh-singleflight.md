# MCP OAuth Refresh Single-Flight

## Status

Done

## Goal

Keep concurrent MCP tool calls connected when an OAuth server rotates refresh tokens by sharing one refresh transaction per loaded server connection.

## Current Behavior

- `McpService` gives Mastra an `MCPOAuthClientProvider` for each OAuth-backed HTTP server.
- The MCP TypeScript client independently refreshes that provider for every concurrent request rejected with HTTP 401.
- Servers that rotate refresh tokens can accept one refresh and reject the overlapping attempts, causing the saved login to be invalidated.

## Milestones

### 1. Serialize Connection Refresh

Implementation tasks:

- Add a small adapter around the supported MCP auth-provider interfaces.
- Share the complete 401 refresh transaction among concurrent requests for one loaded server connection.
- Document the upstream SDK limitation and the condition for removing the adapter.

Exit criteria:

- Concurrent 401 responses cause one token refresh and retry with the resulting access token.
- Interactive OAuth login and callback behavior remain unchanged.

### 2. Regression Coverage and Documentation

Implementation tasks:

- Make the MCP fixture rotate refresh tokens.
- Exercise concurrent authenticated tool calls after access-token expiry.
- Update backend architecture documentation with the connection behavior.

Exit criteria:

- The regression test proves all concurrent calls succeed with exactly one refresh.
- Build, lint, and the targeted MCP test pass.

## Tests

- Extend the MCP integration test with concurrent tool execution against a single-use rotating refresh token.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- --run test/mcp.spec.ts
```

## Overall Exit Criteria

- OAuth-backed MCP connections remain usable during concurrent refresh.
- Persisted replacement tokens are not erased by a losing refresh request.
- The workaround and its upstream removal condition are documented beside the adapter.

## Validation

- `npm run build`
- `npm run lint`
- `npm test -- --run test/mcp.spec.ts` (5 tests passed)
