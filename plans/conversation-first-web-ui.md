# Conversation-First Web UI

## Status

Done

## Goal

Make every viewport use one quiet, conversation-first shell: a compact top bar, a centered conversation rail, a bottom composer, an on-demand conversation sidebar, and one tabbed Preferences dialog.

## Current Behavior

- Desktop, tablet, and phone share one shell with a compact top bar, centered message history, and bottom composer.
- The top bar contains a conversation-sidebar action, centered Pal identity with a connection/activity dot, and a Preferences action.
- Task selection, task details, archive controls, and filters live in the on-demand sidebar.
- Memory, connected services, appearance, and application-update settings are tabs in one Preferences dialog.

## Milestones

### 1. Unified Shell and Conversation Rail

Implementation tasks:

- Replace the branded header and responsive navigation variants with one top bar containing a conversation-sidebar action, centered Pal identity and connection dot, and Preferences action.
- Put task selection and task management in the sidebar on every viewport.
- Remove the redundant conversation heading and activity badge.
- Give history and composer one shared 900 px maximum-width rail with narrow responsive gutters.

Exit criteria:

- Desktop, tablet, and phone use the same shell structure.
- No persistent navigation column, playground branding, selected-thread row, or status text remains in the main view.
- Messages and composer align to the same responsive content rail without horizontal overflow.

### 2. Unified Preferences

Implementation tasks:

- Add Memory, Connections, Appearance, and App tabs to the Preferences dialog.
- Embed connected-service management in the Connections tab without nesting dialogs.
- Replace the toolbar theme cycle with an explicit Auto, Light, or Dark preference.
- Keep update behavior in the App tab.

Exit criteria:

- The top-right cog opens the only application preferences modal.
- Every former toolbar setting is available through an accessible tab.
- Existing memory, MCP, theme, and update behavior remains functional.

### 3. Regression Cleanup

Implementation tasks:

- Update focused browser coverage for the unified sidebar, shell, settings entry point, content rail, and all named workbench viewports.
- Remove superseded responsive state, selectors, components, and tests.
- Update current-state documentation and validate architecture, trim, types, browser behavior, and production build.

Exit criteria:

- The smallest relevant test set and full frontend browser suite pass.
- No unused responsive-navigation or split-settings path remains.

## Tests

- Browser coverage for sidebar selection and return focus at wide and narrow widths.
- Browser coverage for all Preferences tabs and existing memory/MCP workflows.
- Responsive geometry assertions for shared history/composer rails and narrow overflow.
- Existing chat, attachment, desktop, workbench, and PWA behavior retained.

## Validation Commands

```bash
cd frontend
npm run check
npm run check:ui
npm run trim
npm test
npm run build
```

## Overall Exit Criteria

- The application is a responsive conversation surface with three top-bar elements, one optional sidebar, and one settings modal.
- Current chat, task, attachment, desktop, memory, connection, appearance, and PWA-update behavior remains available.
- The implementation adds no new application state layer or speculative layout abstraction.

## Validation Evidence

- Strict application/test TypeScript, generated API drift, architecture checks, production trim, unit tests, formatting, and the production build pass.
- The 34-scenario Chromium suite passes chat, task, attachment, memory, connected-service, appearance, desktop, responsive, and named workbench-viewport behavior.
- Desktop and phone captures confirm the shared conversation rail, compact identity bar, on-demand sidebar, narrow gutters, and bottom composer.
