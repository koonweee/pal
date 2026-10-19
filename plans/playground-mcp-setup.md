# Playground MCP Setup

## Status

Done

## Goal

Provide a clear MCP server-list, editor, sign-in, and management flow using Pal's existing API. Give the playground header consistent settings and theme icons.

## Current Behavior

- Connected services opens a server list; Add/Edit, sign-in, and confirmations use separate views.
- Pending OAuth sign-in refreshes automatically. Authentication fields show the selected client identity and preserve saved secrets.
- Settings and theme controls use centered 20px icons with matching strokes.

## Milestones

### 1. Clarify Setup and Header Controls

Implementation tasks:

- [x] Separate the server list from Add/Edit, with concise statuses and grouped management actions.
- [x] Provide a visible sign-in step and refresh pending sign-in automatically using existing server snapshots.
- [x] Simplify authentication fields, preserve saved secrets, and keep global idle-only Apply explicit.
- [x] Use a centered settings gear and consistent header icon sizing.

Exit criteria:

- [x] Saving, signing in, and applying have distinct, understandable UI steps without backend changes.
- [x] Header controls align in light/dark modes and narrow layouts.

### 2. Validate and Document

Implementation tasks:

- [x] Extend the existing browser setup test for the revised flow and relevant failures.
- [x] Run build and focused browser checks; inspect desktop/mobile rendering.
- [x] Update the playground guide and plan status.

Exit criteria:

- [x] OAuth polling, saved-secret retention, Apply errors, and editor navigation work through the existing API.
- [x] UI renders and works on desktop/mobile with keyboard access.

## Tests

- Reuse the existing deterministic MCP browser fixture for setup, sign-in, busy Apply, and connection errors.
- Use bounded visual inspection for header alignment and desktop/mobile settings layouts.

## Validation Commands

```bash
cd frontend-playground
npm run build
npm test
```

Validation: build passed; all 15 browser tests passed using `PLAYWRIGHT_PORT=5186 PLAYWRIGHT_CHANNEL=chrome npm test`. Desktop/light and mobile/dark inspection confirmed icon alignment, visible management actions, and editor navigation without horizontal overflow. Browser fixtures used synthetic data. Backend contracts are unchanged.

## Overall Exit Criteria

- [x] MCP setup follows the defined interaction pattern and preserves Pal's configuration/Apply contracts.
- [x] Header icons are clear and consistent; build and browser validation pass.
- [x] Documentation describes the implemented flow.
