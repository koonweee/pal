# User Message Markdown

## Status

In Progress

## Goal

Render Markdown in web user message bubbles through the same renderer as agent messages. Keep composer editing unchanged.

## Current Behavior

- `MessageMarkdown` owns Markdown parsing, sanitized markup, and safe external links for both message roles.
- User bubbles retain their accent background and readable Markdown colors in both themes.

## Milestones

### 1. Share rendering and validate message bubbles

Implementation tasks:

- [x] Rename the agent renderer to `MessageMarkdown` and use it for both roles.
- [x] Remove unused plain-text bubble styling and keep user links, quotes, and code readable.
- [x] Validate rendering, sanitization, sends, and frontend checks.

Exit criteria:

- Both roles render Markdown in history; newly sent user messages render before persistence and after reload.
- Composer content and submitted Markdown source remain unchanged.
- Focused renderer/browser tests and frontend checks pass.

### 2. Deploy dev and production

Implementation tasks:

- [ ] Refresh the staged development PWA and production frontend.
- [ ] Verify deployed assets, application health, and update announcements.

Exit criteria:

- Both deployments serve the validated frontend and retain healthy backend services.

## Tests

- Retain renderer coverage for supported Markdown, safe links, and sanitized HTML.
- Browser regression for both roles, user bubble readability, and an optimistic send through reload.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:unit -- test-unit/message-markdown.test.tsx
npm test -- test/message-markdown.spec.ts test/message-quotes.spec.ts
npm run check:ui
npm run trim
npm run build
```

## Overall Exit Criteria

- Shared Markdown rendering works for web user and agent bubbles, including new sends.
- Relevant checks pass and dev/production serve the updated frontend.
