# Agent Display Name Context

## Status

Done

## Goal

Make the configured instance agent name available to Main and Task as their user-facing name on every model run.

## Current Behavior

- Instance settings persist `agentName` and expose it to first-party clients.
- Main and Task read the current setting into their dynamically assembled instructions on every model run.
- Shared role guidance describes the assistant generically so it does not conflict with the configured name.

## Milestones

### 1. Add Dynamic Identity Context

Implementation tasks:

- Make instance settings available to the agent runtime.
- Add `Your name is <agentName>.` to Main and Task instructions on every model run.
- Remove conflicting hardcoded user-facing identity wording from shared role guidance.

Exit criteria:

- A name saved after runtime startup appears in the next Main and Task prompts.
- Workers remain unchanged because their output is private to Task.

### 2. Validate and Document

Implementation tasks:

- Add focused prompt assertions to the existing agent integration coverage.
- Update the backend architecture description of instance settings.

Exit criteria:

- Backend build, lint, and targeted agent tests pass.
- Documentation describes the current runtime behavior.

## Tests

- Extend the Task agent integration test to save a custom name after startup and verify it appears in Main and Task prompts.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- task-agents.spec.ts
```

## Overall Exit Criteria

- Main and Task receive the latest configured agent name without a restart.
- Existing agent routing and worker behavior remain unchanged.
- Focused validation passes.
